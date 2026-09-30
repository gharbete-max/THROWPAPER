import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { api, forms as formSchemas } from '@tp/shared';
import {
  BuilderSessionResponse,
  BuilderSessionSaved,
  SaveBuilderSession,
} from '@tp/shared/builder';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { resolveFormAccess as resolve } from '../forms/access.js';

/**
 * The guided builder's saved conversation — `GET/PUT /v1/forms/:id/builder-session`
 * (`docs/plan/PREDICTIVE-BUILDER.md`, "The conversation", Autosave; `CAVEATS.md` #45).
 *
 * One per form and person: two people building the same form each have their own conversation,
 * and the draft they share keeps saving through `PUT /v1/forms/:id/draft` as it always has. Only
 * someone who may change the form may have one, since every step writes to its draft.
 *
 * Forms-internal: documented by its Zod schemas in `@tp/shared/builder`, not by `CONTRACT.md`,
 * which is the contract *between* products (`CAVEATS.md` #40). Autosave is not audited, like the
 * draft's: it fires on every answer and would bury the entries that matter.
 */

const IdParam = z.object({ id: z.string().uuid() });

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
} as const;

/**
 * A session holds at most `MAX_LOG_ENTRIES` steps, each with its changes and their inverse; a
 * long one with many options runs to a few megabytes, past Fastify's 1 MiB default.
 */
const BODY_LIMIT = 8 * 1024 * 1024;

export function registerBuilderSessionRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const authenticated = requireAuth(deps.guard);

  /** No conversation yet is not an error: version 0, no session — the builder starts one. */
  app.get('/v1/forms/:id/builder-session', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: BuilderSessionResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);

      const record = await deps.repos.builderSessions.find(auth.organisation.id, id, auth.user.id);
      return reply.send(
        record
          ? { version: record.version, session: record.session }
          : { version: 0, session: null },
      );
    },
  });

  /**
   * Saves over the version the builder read. A different stored version means another tab or
   * window saved in between: 409, and the builder reads again rather than overwrite it.
   */
  app.put('/v1/forms/:id/builder-session', {
    preHandler: authenticated,
    bodyLimit: BODY_LIMIT,
    schema: {
      tags: ['forms'],
      params: IdParam,
      body: SaveBuilderSession,
      response: { 200: BuilderSessionSaved, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = SaveBuilderSession.parse(request.body);
      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);

      const saved = await deps.repos.builderSessions.save({
        organisationId: auth.organisation.id,
        formId: id,
        userId: auth.user.id,
        session: body.session,
        expected: body.version,
      });
      if (!saved) {
        return reply.code(409).send({
          error: {
            code: 'session-conflict',
            message: 'This conversation was saved somewhere else; read it again',
          },
        });
      }
      return reply.send({ version: saved.version });
    },
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Form not found' } });
}

function forbidden(reply: FastifyReply) {
  return reply
    .code(403)
    .send({ error: { code: 'forbidden', message: 'You cannot change this form' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

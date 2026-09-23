import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { api } from '@tp/shared';
import {
  CreateEnvelopeRequest,
  CreateEnvelopeResponse,
  EnvelopeStatusResponse,
} from '@tp/shared/contract';
import { declarations, serviceTokens } from '../db/schema.js';
import { fetchDocument, originAllowed } from '../envelopes/fetch-document.js';
import { signToken } from '../envelopes/links.js';
import { createEnvelope, sha256, withEnvelope, type Definition } from '../envelopes/store.js';
import type { Deps } from '../server.js';

const errors = { 401: api.ErrorResponse, 403: api.ErrorResponse, 404: api.ErrorResponse } as const;

interface Caller {
  organisationId: string;
  allowedOrigins: string[];
}

/**
 * CONTRACT §5.1 and §5.2, for callers holding a service token.
 *
 * The organisation is the token's, full stop. The request body names one too (the contract carries
 * it for the caller's own bookkeeping), and a body naming any other organisation is refused rather
 * than believed — otherwise one customer's token could create envelopes in another's name.
 */
export function registerEnvelopeRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /** Set by `authenticate` for every request that reaches a handler. */
  const callers = new WeakMap<FastifyRequest, Caller>();

  /**
   * Runs on `onRequest`, before the body is parsed or validated: a stranger gets 401 and nothing
   * else — not the schema's list of required fields, which would be a free map of the API.
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token) {
      const [row] = await deps.db
        .select()
        .from(serviceTokens)
        .where(and(eq(serviceTokens.tokenSha256, sha256(token)), isNull(serviceTokens.revokedAt)));
      if (row) {
        callers.set(request, {
          organisationId: row.organisationId,
          allowedOrigins: row.allowedOrigins,
        });
        return;
      }
    }
    return fail(reply, 401, 'unauthorised', 'A valid service token is required');
  }

  typed.post('/v1/envelopes', {
    onRequest: authenticate,
    schema: {
      tags: ['envelopes'],
      body: CreateEnvelopeRequest,
      response: {
        200: CreateEnvelopeResponse,
        201: CreateEnvelopeResponse,
        409: api.ErrorResponse,
        422: api.ErrorResponse,
        ...errors,
      },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;
      const body = request.body;

      if (body.organisationId !== who.organisationId) {
        return fail(reply, 403, 'wrong-organisation', 'This token acts for another organisation');
      }
      if (body.hookUrl && !originAllowed(body.hookUrl, who.allowedOrigins)) {
        return fail(reply, 422, 'origin-not-allowed', 'hookUrl is not on an allowed origin');
      }
      const ids = body.parties.map((party) => party.id);
      if (new Set(ids).size !== ids.length) {
        return fail(reply, 422, 'duplicate-party', 'Two parties share an id');
      }
      const now = deps.now();
      if (Date.parse(body.expiresAt) <= now.getTime()) {
        return fail(reply, 422, 'past-expiry', 'expiresAt is in the past');
      }

      // The latest version of the named declaration is pinned now: what a signer sees cannot
      // change after the envelope is sent, even when a person revises the text tomorrow.
      const [declaration] = await deps.db
        .select()
        .from(declarations)
        .where(eq(declarations.key, body.declarationKey))
        .orderBy(desc(declarations.version))
        .limit(1);
      if (!declaration) {
        return fail(reply, 422, 'unknown-declaration', 'No declaration has that key');
      }
      if (declaration.testOnly && body.environment === 'production') {
        return fail(
          reply,
          422,
          'declaration-not-authored',
          'That declaration is a test-mode placeholder; a person must write the text first',
        );
      }
      const missing = body.parties.find((party) => !declaration.texts[party.locale]);
      if (missing) {
        return fail(
          reply,
          422,
          'declaration-missing-locale',
          `The declaration has no text in ${missing.locale}`,
        );
      }

      const fetched = await fetchDocument(body.documentUrl, who.allowedOrigins, deps.fetch);
      if (!fetched.ok) return fail(reply, 422, fetched.reason, 'The document could not be used');
      if (sha256(fetched.bytes) !== body.documentSha256) {
        return fail(reply, 422, 'wrong-document', 'The document does not match documentSha256');
      }

      const definition: Definition = {
        organisationId: who.organisationId,
        envelope: {
          id: randomUUID(),
          documentName: body.documentName,
          documentSha256: body.documentSha256,
          routing: body.routing,
          parties: body.parties,
          environment: body.environment,
          expiresAt: body.expiresAt,
        },
        declaration: { key: declaration.key, version: declaration.version },
        hookUrl: body.hookUrl ?? null,
      };
      const { id, created } = await createEnvelope(deps.db, {
        definition,
        idempotencyKey: body.idempotencyKey,
        document: fetched.bytes,
        at: now,
      });

      const answer = await withEnvelope(deps.db, id, now, async ({ definition, envelope }) => {
        // A key reused for a different document is a caller bug, not a retry.
        if (!created && definition.envelope.documentSha256 !== body.documentSha256) return null;
        return {
          envelopeId: id,
          status: envelope.status,
          signUrls: Object.fromEntries(
            envelope.parties.map((party) => [
              party.id,
              `${deps.publicUrl}/s/${signToken(deps.linkSecret, id, party.id)}`,
            ]),
          ),
        };
      });
      if (!answer) {
        return fail(reply, 409, 'idempotency-key-reused', 'That key was used for another document');
      }
      return reply.code(created ? 201 : 200).send(answer);
    },
  });

  typed.get('/v1/envelopes/:id', {
    onRequest: authenticate,
    schema: {
      tags: ['envelopes'],
      params: z.object({ id: z.string().uuid() }),
      response: { 200: EnvelopeStatusResponse, ...errors },
    },
    handler: async (request, reply) => {
      const who = callers.get(request)!;

      const status = await withEnvelope(
        deps.db,
        request.params.id,
        deps.now(),
        async ({ organisationId, envelope }) =>
          // Another organisation's envelope does not exist, as far as this caller can tell.
          organisationId !== who.organisationId
            ? null
            : {
                envelopeId: envelope.id,
                status: envelope.status,
                environment: envelope.environment,
                documentSha256: envelope.documentSha256,
                parties: envelope.parties.map((party) => ({
                  ...party,
                  status: envelope.partyStatus[party.id] ?? 'waiting',
                })),
              },
      );
      if (!status) return fail(reply, 404, 'not-found', 'Not found');
      return reply.send(status);
    },
  });
}

export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

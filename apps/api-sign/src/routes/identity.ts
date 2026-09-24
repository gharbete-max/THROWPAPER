import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { api } from '@tp/shared';
import {
  IdentityMethodsResponse,
  IdentityResultResponse,
  IdentitySessionResponse,
  StartIdentityRequest,
} from '@tp/shared/contract';
import { maxLevelFor, type IdentityProvider, type SignatureLevel } from '@tp/signing';
import { serviceTokens } from '../db/schema.js';
import { sha256 } from '../envelopes/store.js';
import type { Db } from '../db/client.js';
import { fail } from './envelopes.js';

const errors = { 401: api.ErrorResponse, 403: api.ErrorResponse, 404: api.ErrorResponse } as const;

interface Started {
  organisationId: string;
  provider: IdentityProvider;
  documentSha256: string;
}

/**
 * CONTRACT §5.6 — confirming who somebody is, through whichever identity provider is configured.
 *
 * Service-token callers only, like §5.1: the organisation is the token's. A session is remembered
 * against that organisation, the provider that holds it and the hash it was asked to confirm, and
 * a result is only ever read back by the same organisation.
 *
 * The level is capped here by `maxLevelFor(method)` whatever a provider says: no response from this
 * route can claim more than the method can carry (`packages/signing/src/model.ts`).
 *
 * Sessions are held in memory. That is enough for the development provider and for the minutes a
 * confirmation takes; keeping the evidence of a real one — the scheme's raw assertion, encrypted —
 * belongs with the first real provider (ROADMAP P2), not with a test double.
 */
export function registerIdentityRoutes(
  app: FastifyInstance,
  deps: { db: Db; identity: readonly IdentityProvider[] },
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const callers = new WeakMap<FastifyRequest, string>();
  const sessions = new Map<string, Started>();

  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token) {
      const [row] = await deps.db
        .select()
        .from(serviceTokens)
        .where(and(eq(serviceTokens.tokenSha256, sha256(token)), isNull(serviceTokens.revokedAt)));
      if (row) {
        callers.set(request, row.organisationId);
        return;
      }
    }
    return fail(reply, 401, 'unauthorised', 'A valid service token is required');
  }

  typed.get('/v1/identity/methods', {
    onRequest: authenticate,
    schema: { tags: ['identity'], response: { 200: IdentityMethodsResponse, ...errors } },
    handler: async () => ({
      methods: deps.identity.flatMap((provider) =>
        provider.methods.map((method) => ({
          method,
          provider: provider.name,
          environment: provider.environment,
        })),
      ),
    }),
  });

  typed.post('/v1/identity/sessions', {
    onRequest: authenticate,
    schema: {
      tags: ['identity'],
      body: StartIdentityRequest,
      response: { 201: IdentitySessionResponse, 422: api.ErrorResponse, ...errors },
    },
    handler: async (request, reply) => {
      const organisationId = callers.get(request)!;
      const body = request.body;
      if (body.organisationId !== organisationId) {
        return fail(reply, 403, 'wrong-organisation', 'This token acts for another organisation');
      }
      const provider = deps.identity.find((candidate) => candidate.methods.includes(body.method));
      if (!provider) {
        return fail(reply, 422, 'method-unavailable', 'No identity provider offers that method');
      }
      const session = await provider.sign({
        method: body.method,
        documentSha256: body.documentSha256,
        // The words shown in the eID app are the caller's document hash; a human-authored
        // declaration joins this with the first real provider (ADR 0012).
        visibleText: '',
        locale: body.locale,
        ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
        // Namespaced by organisation, so two callers' keys can never meet.
        idempotencyKey: `${organisationId}:${body.idempotencyKey}`,
      });
      sessions.set(session.reference, {
        organisationId,
        provider,
        documentSha256: body.documentSha256,
      });
      return reply.code(201).send({
        reference: session.reference,
        status: session.status,
        environment: provider.environment,
        ...(session.launchUrl ? { launchUrl: session.launchUrl } : {}),
      });
    },
  });

  typed.get('/v1/identity/sessions/:reference', {
    onRequest: authenticate,
    schema: {
      tags: ['identity'],
      params: z.object({ reference: z.string().min(1).max(128) }),
      response: { 200: IdentityResultResponse, ...errors },
    },
    handler: async (request, reply) => {
      const organisationId = callers.get(request)!;
      const started = sessions.get(request.params.reference);
      // Another organisation's session reads exactly like one that never existed.
      if (!started || started.organisationId !== organisationId) {
        return fail(reply, 404, 'not-found', 'No such identity session');
      }
      const result = await started.provider.result(request.params.reference);
      const complete = result.status === 'complete' && result.method !== undefined;
      const level: SignatureLevel | undefined = complete
        ? capped(result.level ?? 'simple', maxLevelFor(result.method!))
        : undefined;
      return {
        reference: result.reference,
        status: result.status,
        // The provider's environment, never a result's claim to be anything else.
        environment: started.provider.environment,
        documentSha256: started.documentSha256,
        ...(complete ? { method: result.method, level } : {}),
        ...(complete && result.assertion?.['name']
          ? { name: result.assertion['name'].slice(0, 200) }
          : {}),
      };
    },
  });
}

const RANK: Record<SignatureLevel, number> = { simple: 0, advanced: 1, qualified: 2 };

function capped(claimed: SignatureLevel, ceiling: SignatureLevel): SignatureLevel {
  return RANK[claimed] <= RANK[ceiling] ? claimed : ceiling;
}

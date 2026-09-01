import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { domainOf, verifyDomain, type TxtResolver } from '../mail/domain-verification.js';

const IdParam = z.object({ id: z.string().uuid() });

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
} as const;

const RecordCheckResponse = z.object({
  record: z.enum(['spf', 'dkim', 'dmarc']),
  state: z.enum(['pass', 'missing', 'misconfigured']),
  found: z.string().nullable(),
  detail: z.string(),
});

const SendingDomainResponse = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  fromAddress: z.string(),
  dkimSelectors: z.array(z.string()),
  verified: z.boolean(),
  checks: z.array(RecordCheckResponse),
  lastCheckedAt: z.string().nullable(),
});

const CreateSendingDomain = z.object({
  fromAddress: z.string().email(),
  /** SES issues three selectors; any one verifying is enough. */
  dkimSelectors: z.array(z.string().min(1).max(128)).max(10).default([]),
});

export function registerSendingDomainRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps; resolver?: TxtResolver },
): void {
  // Sending identity is an admin decision, not a day-to-day one.
  const adminOnly = requireAuth(deps.guard, ['admin']);

  app.get('/v1/sending-domains', {
    preHandler: adminOnly,
    schema: {
      tags: ['mail'],
      response: { 200: z.object({ domains: z.array(SendingDomainResponse) }), ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const domains = await deps.repos.sendingDomains.list(auth.organisation.id);
      return reply.send({ domains: domains.map(toResponse) });
    },
  });

  app.post('/v1/sending-domains', {
    preHandler: adminOnly,
    schema: {
      tags: ['mail'],
      body: CreateSendingDomain,
      response: { 201: SendingDomainResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const body = CreateSendingDomain.parse(request.body);
      const domain = domainOf(body.fromAddress);

      const existing = await deps.repos.sendingDomains.findByDomain(auth.organisation.id, domain);
      if (existing) {
        return reply
          .code(409)
          .send({ error: { code: 'domain-exists', message: 'That domain is already configured' } });
      }

      const created = await deps.repos.sendingDomains.create({
        organisationId: auth.organisation.id,
        domain,
        fromAddress: body.fromAddress,
        dkimSelectors: body.dkimSelectors,
      });

      await recordAudit(deps.repos, request, {
        action: 'sending_domain.created',
        entityType: 'sending_domain',
        entityId: created.id,
        after: { domain },
      });

      return reply.code(201).send(toResponse(created));
    },
  });

  /**
   * Live check — `SPEC-mailer.md` §6 wants status, not a stored claim. Each record comes back with
   * what was found and what to paste, because when mail does not arrive the problem is
   * configuration and the operator is the one who has to fix it in DNS.
   */
  app.post('/v1/sending-domains/:id/verify', {
    preHandler: adminOnly,
    schema: {
      tags: ['mail'],
      params: IdParam,
      response: { 200: SendingDomainResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      const domain = await deps.repos.sendingDomains.findById(auth.organisation.id, id);
      if (!domain) return notFound(reply);

      const verification = await verifyDomain({
        domain: domain.domain,
        dkimSelectors: domain.dkimSelectors,
        resolver: deps.resolver,
      });

      const saved = await deps.repos.sendingDomains.saveVerification(id, {
        verified: verification.verified,
        checks: verification.checks,
        lastCheckedAt: new Date(),
      });
      if (!saved) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: verification.verified ? 'sending_domain.verified' : 'sending_domain.check_failed',
        entityType: 'sending_domain',
        entityId: id,
        after: { verified: verification.verified },
      });

      return reply.send(toResponse(saved));
    },
  });
}

function toResponse(domain: {
  id: string;
  domain: string;
  fromAddress: string;
  dkimSelectors: string[];
  verified: boolean;
  checks: unknown[];
  lastCheckedAt: Date | null;
}) {
  return {
    id: domain.id,
    domain: domain.domain,
    fromAddress: domain.fromAddress,
    dkimSelectors: domain.dkimSelectors,
    verified: domain.verified,
    checks: domain.checks as z.infer<typeof RecordCheckResponse>[],
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
  };
}

function notFound(reply: FastifyReply) {
  return reply
    .code(404)
    .send({ error: { code: 'not-found', message: 'Sending domain not found' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

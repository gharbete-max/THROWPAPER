import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { queueCampaign } from '../send/campaign.js';
import { sendModeOf } from '../send/service.js';
import { unsubscribePage, verifyUnsubscribeToken } from '../send/unsubscribe.js';

/**
 * Campaigns, inside Send (`send/campaign.ts`): the press, the audience check, the organisation's
 * suppression list, and the public page an unsubscribe link opens.
 *
 * Like every send route, the press queues mail and sends none, refuses a request that does not
 * carry its confirmation, and is idempotent on `key`.
 */
const errors = {
  400: api.ErrorResponse,
  401: api.ErrorResponse,
  413: api.ErrorResponse,
  422: api.ErrorResponse,
} as const;

const fail = (reply: FastifyReply, status: 400 | 413, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function registerCampaignRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    providerName: string;
    unsubscribeKey: Buffer;
    publicApiUrl: string;
  },
): void {
  const authenticated = requireAuth(deps.guard);
  const mode = sendModeOf(deps.providerName);

  app.post('/v1/send/campaign', {
    preHandler: authenticated,
    bodyLimit: 4 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['send'], response: { 200: api.CampaignQueued, ...errors } },
    handler: async (request, reply) => {
      if ((request.body as { confirmed?: unknown } | null)?.confirmed !== true) {
        return fail(reply, 400, 'not-confirmed', 'Nothing is sent before the confirmation');
      }
      const parsed = api.SendCampaignRequest.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'bad-request', 'The request cannot be read');
      const body = parsed.data;
      if (body.rows.length > api.SEND_LIMITS.campaign) {
        return fail(
          reply,
          413,
          'too-many',
          `At most ${api.SEND_LIMITS.campaign} people in one campaign`,
        );
      }
      const problems = api.checkCampaign(body.subject, body.body, body.footer, body.rows);
      if (problems.length > 0) {
        const fields: Record<string, string[]> = {};
        for (const problem of problems.slice(0, 50)) {
          const where = problem.row < 0 ? 'campaign' : `row ${problem.row + 1}`;
          (fields[where] ??= []).push(`${problem.field}:${problem.code}`);
        }
        return reply.code(422).send({
          error: { code: 'bad-rows', message: 'Some rows or the campaign cannot be used', fields },
        });
      }
      const organisationId = request.auth!.organisation.id;
      const result = await queueCampaign(deps, organisationId, body);
      await recordAudit(deps.repos, request, {
        action: 'send.queued',
        entityType: 'send',
        entityId: body.key,
        after: {
          kind: 'campaign',
          recipients: result.items.length,
          skipped: result.skipped.length,
          mode,
          test: Boolean(body.testTo),
        },
      });
      return reply.send(result);
    },
  });

  /** Which of these addresses a campaign would skip, for the number on the confirmation. */
  app.post('/v1/send/campaign/audience', {
    preHandler: authenticated,
    bodyLimit: 1024 * 1024,
    schema: {
      tags: ['send'],
      body: api.CampaignAudienceRequest,
      response: { 200: api.CampaignAudienceResponse, 401: api.ErrorResponse },
    },
    handler: async (request) => {
      const { emails } = api.CampaignAudienceRequest.parse(request.body);
      return {
        suppressed: await deps.repos.campaignSuppressions.among(
          request.auth!.organisation.id,
          emails,
        ),
      };
    },
  });

  app.get('/v1/send/suppressions', {
    preHandler: authenticated,
    schema: { tags: ['send'], response: { 200: api.SuppressionList, 401: api.ErrorResponse } },
    handler: async (request) => ({
      items: (await deps.repos.campaignSuppressions.list(request.auth!.organisation.id)).map(
        (entry) => ({
          email: entry.email,
          reason: entry.reason,
          createdAt: entry.createdAt.toISOString(),
        }),
      ),
    }),
  });

  /** Addresses that bounced, or that someone asked by other means not to be written to. */
  app.post('/v1/send/suppressions', {
    preHandler: authenticated,
    schema: {
      tags: ['send'],
      body: api.AddSuppression,
    },
    handler: async (request, reply) => {
      const body = api.AddSuppression.parse(request.body);
      await deps.repos.campaignSuppressions.add(
        request.auth!.organisation.id,
        body.email,
        body.reason,
      );
      await recordAudit(deps.repos, request, {
        action: 'suppression.added',
        entityType: 'suppression',
        entityId: null,
        after: { reason: body.reason },
      });
      return reply.code(204).send();
    },
  });

  app.delete('/v1/send/suppressions', {
    preHandler: authenticated,
    schema: {
      tags: ['send'],
      querystring: z.object({ email: api.Email }),
    },
    handler: async (request, reply) => {
      const { email } = request.query as { email: string };
      const removed = await deps.repos.campaignSuppressions.remove(
        request.auth!.organisation.id,
        email,
      );
      if (removed) {
        await recordAudit(deps.repos, request, {
          action: 'suppression.removed',
          entityType: 'suppression',
          entityId: null,
        });
      }
      return reply.code(204).send();
    },
  });

  // ---- Public: what an unsubscribe link opens. Signed link, no sign-in. ---------------------

  const resolve = async (token: string) => {
    const verified = verifyUnsubscribeToken(token, deps.unsubscribeKey);
    const organisation = verified
      ? await deps.repos.organisations.findById(verified.organisationId)
      : null;
    return verified && organisation ? { ...verified, organisation } : null;
  };
  const html = (reply: FastifyReply, status: 200 | 400, page: string) =>
    reply
      .code(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(page);

  /** Asks. It records nothing: a mail scanner that follows the link must not unsubscribe anyone. */
  app.get('/v1/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['public'], querystring: z.object({ t: z.string().max(1024) }) },
    handler: async (request, reply) => {
      const token = (request.query as { t: string }).t;
      const found = await resolve(token);
      if (!found) return html(reply, 400, unsubscribePage('en-GB', { kind: 'invalid' }));
      return html(
        reply,
        200,
        unsubscribePage(found.organisation.defaultLocale, {
          kind: 'ask',
          email: found.email,
          organisation: found.organisation.name,
        }),
      );
    },
  });

  /** Records it. Also the target of the mail program's own one-click button (RFC 8058). */
  app.post('/v1/unsubscribe', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['public'], querystring: z.object({ t: z.string().max(1024) }) },
    handler: async (request, reply) => {
      const token = (request.query as { t: string }).t;
      const found = await resolve(token);
      if (!found) return html(reply, 400, unsubscribePage('en-GB', { kind: 'invalid' }));
      await deps.repos.campaignSuppressions.add(found.organisationId, found.email, 'unsubscribed');
      return html(
        reply,
        200,
        unsubscribePage(found.organisation.defaultLocale, {
          kind: 'done',
          email: found.email,
          organisation: found.organisation.name,
        }),
      );
    },
  });
}

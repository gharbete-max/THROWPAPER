import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { contentDisposition } from '../documents/filename.js';
import { DraftUnavailable, type MailDrafter } from '../mail/draft.js';
import type { OutgoingStore } from '../mail/queue.js';

/**
 * The To send screen's API — the desktop's mail, waiting for its person (`mail/queue.ts`).
 *
 * Registered only where there is a queue, which is the desktop edition; a server answers 404.
 * Nothing here sends. **Open** puts one message in front of the person as a draft in their own
 * mail program — addressed, with its attachment — and they press Send there; for a program that
 * cannot be driven, the page uses a `mailto:` link and offers the attachment to save, and tells
 * this API it was opened.
 */
const IdParam = z.object({ id: z.string().uuid() });
const AttachmentParam = IdParam.extend({ index: z.coerce.number().int().min(0).max(50) });

const errorResponses = {
  401: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
} as const;

export function registerOutgoingRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    store: OutgoingStore;
    /** The program a draft opens in; `null` when the person chose "my default email app". */
    drafter: MailDrafter | null;
  },
): void {
  const authenticated = requireAuth(deps.guard);
  const notFound = { error: { code: 'not-found', message: 'That message is not waiting here' } };

  app.get('/v1/outgoing', {
    preHandler: authenticated,
    schema: { tags: ['outgoing'], response: { 401: api.ErrorResponse } },
    handler: async () => ({
      program: deps.drafter?.label ?? null,
      messages: await deps.store.list(),
    }),
  });

  app.post('/v1/outgoing/:id/open', {
    preHandler: authenticated,
    schema: { tags: ['outgoing'], params: IdParam, response: errorResponses },
    handler: async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const message = await deps.store.get(id);
      if (!message) return reply.code(404).send(notFound);
      if (!deps.drafter) {
        return reply.code(409).send({
          error: { code: 'no-program', message: 'Open it with the email link instead' },
        });
      }
      const attachments = [];
      for (const [index] of message.attachments.entries()) {
        const file = await deps.store.attachment(id, index);
        if (file) attachments.push({ filename: file.meta.filename, content: file.content });
      }
      try {
        await deps.drafter.open({
          to: message.to,
          subject: message.subject,
          text: message.text,
          attachments,
        });
      } catch (error) {
        request.log.error({ err: error }, 'a draft did not open');
        return reply.code(409).send({
          error: {
            code: error instanceof DraftUnavailable ? 'program-unavailable' : 'draft-failed',
            message: `${deps.drafter.label} did not open the message`,
          },
        });
      }
      return reply.send(await deps.store.markOpened(id));
    },
  });

  /** For the `mailto:` path, where the page opened it and this API could not see it happen. */
  app.post('/v1/outgoing/:id/opened', {
    preHandler: authenticated,
    schema: { tags: ['outgoing'], params: IdParam, response: errorResponses },
    handler: async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const message = await deps.store.markOpened(id);
      return message ? reply.send(message) : reply.code(404).send(notFound);
    },
  });

  app.get('/v1/outgoing/:id/attachments/:index', {
    preHandler: authenticated,
    schema: { tags: ['outgoing'], params: AttachmentParam, response: errorResponses },
    handler: async (request, reply) => {
      const { id, index } = AttachmentParam.parse(request.params);
      const file = await deps.store.attachment(id, index);
      if (!file) return reply.code(404).send(notFound);
      return reply
        .header('content-type', file.meta.contentType)
        .header('content-disposition', contentDisposition(file.meta.filename))
        .header('cache-control', 'private, no-store')
        .send(file.content);
    },
  });

  /** Asked for on the screen first (rule 7): a removed message is gone, with its attachment. */
  app.delete('/v1/outgoing/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['outgoing'],
      params: IdParam,
      response: { 204: z.null(), ...errorResponses },
    },
    handler: async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const message = await deps.store.get(id);
      if (!message || !(await deps.store.remove(id))) return reply.code(404).send(notFound);
      await recordAudit(deps.repos, request, {
        action: 'outgoing.removed',
        entityType: 'outgoing',
        entityId: id,
        before: { to: message.to, subject: message.subject, opened: message.openedAt !== null },
      });
      return reply.code(204).send();
    },
  });
}

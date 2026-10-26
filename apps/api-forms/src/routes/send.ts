import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import type { DocumentStore } from '../documents/store.js';
import type { PdfRenderer } from '../documents/render.js';
import { recordAudit } from '../audit.js';
import { renderBatchPdf } from '../send/render.js';
import {
  asTest,
  batchPayloads,
  fileNameOf,
  queueSends,
  sendModeOf,
  type SendPayload,
} from '../send/service.js';

/**
 * Send this document / send a batch (`send/service.ts`).
 *
 * A request queues mail; it does not send any. Both queueing routes refuse a request that does not
 * carry its confirmation (`confirmed: true`, the answer to the screen's confirmation step), and
 * both are idempotent on `key`.
 */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const errors = {
  400: api.ErrorResponse,
  401: api.ErrorResponse,
  413: api.ErrorResponse,
  422: api.ErrorResponse,
} as const;

const jsonOf = (text: string | undefined): unknown => {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
};

const fail = (reply: FastifyReply, status: 400 | 413 | 422, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** `422` with the first few problems, counted from 1 the way a person counts rows. */
function badRows(reply: FastifyReply, problems: api.RowProblem[]) {
  const fields: Record<string, string[]> = {};
  for (const problem of problems.slice(0, 50)) {
    const where = problem.row < 0 ? 'template' : `row ${problem.row + 1}`;
    (fields[where] ??= []).push(`${problem.field}:${problem.code}`);
  }
  return reply.code(422).send({
    error: { code: 'bad-rows', message: 'Some rows or the template cannot be used', fields },
  });
}

export function registerSendRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    store: DocumentStore;
    renderer: PdfRenderer;
    /** The provider's name: what decides whether a send is to-send, a test, or live. */
    providerName: string;
  },
): void {
  const authenticated = requireAuth(deps.guard);
  const mode = sendModeOf(deps.providerName);

  app.get('/v1/send/mode', {
    preHandler: authenticated,
    schema: { tags: ['send'], response: { 200: api.SendModeResponse, 401: api.ErrorResponse } },
    handler: async () => ({
      mode,
      batch: api.SEND_LIMITS.batch,
      recipients: api.SEND_LIMITS.recipients,
    }),
  });

  /**
   * One document to some people. Multipart: one `file` (a PDF, or a Word file sent as brought in),
   * `to` (a JSON list of addresses), `subject`, `message`, `key` (a UUID made when the
   * confirmation opened), `confirmed` = `true`, and optionally `testTo`.
   */
  app.post('/v1/send/document', {
    preHandler: authenticated,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['send'], response: { 200: api.SendQueued, ...errors } },
    handler: async (request, reply) => {
      let file: { name: string; content: Buffer } | null = null;
      const fields = new Map<string, string>();
      try {
        for await (const part of request.parts({
          limits: {
            files: 1,
            fileSize: api.SEND_LIMITS.attachmentBytes,
            fields: 10,
            fieldSize: 64 * 1024,
          },
        })) {
          if (part.type === 'file') {
            const content = await part.toBuffer();
            if (part.file.truncated) {
              return fail(reply, 413, 'too-large', 'The document is too large to send');
            }
            file = { name: part.filename, content };
          } else if (typeof part.value === 'string') fields.set(part.fieldname, part.value);
        }
      } catch (error) {
        if (((error as { code?: string }).code ?? '').startsWith('FST_')) {
          return fail(reply, 413, 'too-large', 'The request is too large');
        }
        throw error;
      }

      if (fields.get('confirmed') !== 'true') {
        return fail(reply, 400, 'not-confirmed', 'Nothing is sent before the confirmation');
      }
      const key = z.guid().safeParse(fields.get('key'));
      const recipients = z
        .array(api.Email)
        .min(1)
        .safeParse(jsonOf(fields.get('to')));
      const testTo = fields.get('testTo') ? api.Email.safeParse(fields.get('testTo')) : null;
      const subject = (fields.get('subject') ?? '').replace(/[\r\n]+/g, ' ').trim();
      if (!key.success || !recipients.success || (testTo && !testTo.success) || !subject) {
        return fail(reply, 400, 'bad-request', 'Send a key, recipients and a subject');
      }
      const to = [...new Set(recipients.data.map((address) => address.trim().toLowerCase()))];
      if (to.length > api.SEND_LIMITS.recipients) {
        return fail(reply, 413, 'too-many', `At most ${api.SEND_LIMITS.recipients} people at once`);
      }
      if (!file || file.content.length === 0) {
        return fail(reply, 400, 'no-file', 'Send the document as a file');
      }
      const isPdf = file.content.subarray(0, 5).toString('latin1') === '%PDF-';
      const isDocx =
        /\.docx$/i.test(file.name) &&
        file.content.subarray(0, 4).toString('latin1') === 'PK\x03\x04';
      if (!isPdf && !isDocx) {
        return fail(reply, 400, 'not-a-document', 'Only a PDF or a Word file can be sent');
      }

      const auth = request.auth!;
      const filename = isPdf
        ? fileNameOf(file.name.replace(/\.pdf$/i, ''), 'pdf')
        : fileNameOf(file.name.replace(/\.docx$/i, ''), 'docx');
      const stored = await deps.store.put(isPdf ? 'document.pdf' : 'document.docx', file.content);
      const text = fields.get('message') ?? '';
      const payloads = to.map((address): SendPayload => {
        const payload: SendPayload = {
          to: address,
          subject,
          text,
          attachmentKey: stored.key,
          filename,
          contentType: isPdf ? 'application/pdf' : DOCX,
        };
        return testTo?.success ? asTest(payload, testTo.data) : payload;
      });
      const items = await queueSends(deps.repos, auth.organisation.id, key.data, payloads);
      await recordAudit(deps.repos, request, {
        action: 'send.queued',
        entityType: 'send',
        entityId: key.data,
        after: { kind: 'document', recipients: items.length, mode, test: Boolean(testTo) },
      });
      return reply.send({ items });
    },
  });

  /** One recipient's PDF, to look at before anything is sent. Nothing is queued or stored. */
  app.post('/v1/send/batch/preview', {
    preHandler: authenticated,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { tags: ['send'], body: api.BatchPreviewRequest, response: errors },
    handler: async (request, reply) => {
      const { template, row } = api.BatchPreviewRequest.parse(request.body);
      const problems = api.checkBatch(template, '', '', [row]);
      if (problems.length > 0) return badRows(reply, problems);
      const pdf = await renderBatchPdf(
        deps.renderer,
        template,
        row,
        request.auth!.organisation.name,
      );
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'inline; filename="preview.pdf"')
        .header('cache-control', 'no-store')
        .send(pdf);
    },
  });

  /** One personalised PDF per row. Same rules as above, plus the hard cap. */
  app.post('/v1/send/batch', {
    preHandler: authenticated,
    bodyLimit: 4 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['send'], response: { 200: api.SendQueued, ...errors } },
    handler: async (request, reply) => {
      if ((request.body as { confirmed?: unknown } | null)?.confirmed !== true) {
        return fail(reply, 400, 'not-confirmed', 'Nothing is sent before the confirmation');
      }
      const parsed = api.SendBatchRequest.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'bad-request', 'The request cannot be read');
      const body = parsed.data;
      if (body.rows.length > api.SEND_LIMITS.batch) {
        return fail(
          reply,
          413,
          'too-many',
          `At most ${api.SEND_LIMITS.batch} documents in one batch`,
        );
      }
      const problems = api.checkBatch(body.template, body.subject, body.message, body.rows);
      if (problems.length > 0) return badRows(reply, problems);

      const payloads = batchPayloads(body).map((payload) =>
        body.testTo ? asTest(payload, body.testTo) : payload,
      );
      const items = await queueSends(deps.repos, request.auth!.organisation.id, body.key, payloads);
      await recordAudit(deps.repos, request, {
        action: 'send.queued',
        entityType: 'send',
        entityId: body.key,
        after: { kind: 'batch', recipients: items.length, mode, test: Boolean(body.testTo) },
      });
      return reply.send({ items });
    },
  });

  /** Per-recipient status, by the ids a queueing route returned. */
  app.get('/v1/send/status', {
    preHandler: authenticated,
    schema: {
      tags: ['send'],
      querystring: z.object({ ids: z.string().max(10_000) }),
      response: { 200: api.SendStatusResponse, 401: api.ErrorResponse },
    },
    handler: async (request) => {
      const ids = z
        .array(z.guid())
        .max(api.SEND_LIMITS.batch)
        .catch([])
        .parse((request.query as { ids: string }).ids.split(',').filter(Boolean));
      const items = [];
      for (const id of ids) {
        const job = await deps.repos.jobs.findById(request.auth!.organisation.id, id);
        if (!job || (job.kind !== 'send.document' && job.kind !== 'send.campaign')) continue;
        items.push({
          id,
          state:
            job.status === 'done'
              ? job.result?.['skipped']
                ? ('skipped' as const)
                : ('sent' as const)
              : job.status === 'failed'
                ? ('failed' as const)
                : ('queued' as const),
          provider: typeof job.result?.['provider'] === 'string' ? job.result['provider'] : null,
        });
      }
      return { items };
    },
  });
}

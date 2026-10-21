import { api } from '@tp/shared';
import type { Repositories } from '../db/repositories/index.js';
import type { DocumentStore } from '../documents/store.js';
import type { PdfRenderer } from '../documents/render.js';
import type { JobHandler } from '../jobs/worker.js';
import type { MailProvider } from '../mail/provider.js';
import { senderFor } from '../signing/invitations.js';
import { renderBatchPdf, valuesOf } from './render.js';

/**
 * Sending documents by mail: one document to some people, or one personalised PDF each.
 *
 * Nothing is sent by a request. A request that carries its confirmation queues one job per
 * recipient (`send.document`) and the worker hands each message to the mail provider — on the
 * desktop that provider is To send, which waits for the person's own press; on a server it is the
 * configured one, and a test provider (console, `.eml` outbox) writes the message somewhere
 * harmless. `idempotencyKey` is `key:index`, so a double press, a retry of the request or a
 * second tab is the same press and queues nothing twice.
 */
export const SEND_JOB = 'send.document';

export interface SendPayload {
  to: string;
  subject: string;
  text: string;
  /** A single document, stored once for all of its recipients. */
  attachmentKey?: string;
  filename?: string;
  contentType?: string;
  /** Or a batch's personalised one, printed when the job runs. */
  template?: api.BatchTemplate;
  row?: api.BatchRow;
}

/** What a provider's name means to the person: waiting for them, a harmless test, or the real thing. */
export function sendModeOf(providerName: string): api.SendMode {
  if (providerName === 'queue') return 'to-send';
  if (['console', 'memory', 'outbox'].includes(providerName)) return 'test';
  return 'live';
}

/** A file name from words: letters, numbers and a few marks; what the mail program will show. */
export function fileNameOf(text: string, extension: string): string {
  const stem = text
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .slice(0, 80);
  return `${stem || 'document'}.${extension}`;
}

export const TEST_MARK = '[TEST]';

/** Test mode: everything to one address, marked, with the real recipient named in the text. */
export function asTest(payload: SendPayload, testTo: string): SendPayload {
  return {
    ...payload,
    to: testTo,
    subject: `${TEST_MARK} ${payload.subject}`,
    text: `${TEST_MARK} ${payload.to}${payload.text ? `\n\n${payload.text}` : ''}`,
  };
}

/**
 * A confirmation's key was used again for a different message. The queue would hand back the
 * first press's job (that is what makes a double press safe), so the second list's recipient
 * would be told "queued" with another recipient's job id and no mail would go to them.
 */
export class KeyReused extends Error {
  readonly statusCode = 409;
  readonly code = 'key-reused';
  constructor() {
    super('This confirmation was already used for different messages');
  }
}

/** Whether a job already queued under a key is the message this press would have queued. */
export function sameMessage(
  queued: Record<string, unknown>,
  wanted: { to: string; subject: string; text: string; filename?: string },
): boolean {
  // Not the attachment's key: every press stores its own copy of the file, so the key of a
  // repeated press differs. The file's name is what a person would call "the same document".
  return (
    queued['to'] === wanted.to &&
    queued['subject'] === wanted.subject &&
    queued['text'] === wanted.text &&
    queued['filename'] === wanted.filename
  );
}

export async function queueSends(
  repos: Repositories,
  organisationId: string,
  key: string,
  payloads: readonly SendPayload[],
): Promise<api.SendQueued['items']> {
  const items: api.SendQueued['items'] = [];
  for (const [index, payload] of payloads.entries()) {
    const job = await repos.jobs.enqueue({
      organisationId,
      kind: SEND_JOB,
      idempotencyKey: `${SEND_JOB}:${key}:${index}`,
      payload: { ...payload },
      progressTotal: 1,
      maxAttempts: 3,
    });
    if (!sameMessage(job.payload, payload)) throw new KeyReused();
    items.push({ index, to: payload.to, id: job.id });
  }
  return items;
}

/** The batch's messages: the subject and text merged per row. */
export function batchPayloads(request: api.SendBatchRequest): SendPayload[] {
  return request.rows.map((row) => {
    const values = valuesOf(request.template, row);
    return {
      to: row.email.trim(),
      subject: api.oneLine(api.mergeText(request.subject, values)),
      text: api.mergeText(request.message, values),
      template: request.template,
      row,
    };
  });
}

export function createSendHandler(deps: {
  repos: Repositories;
  provider: MailProvider;
  store: DocumentStore;
  renderer: PdfRenderer;
}): JobHandler {
  return async ({ job }) => {
    const payload = job.payload as unknown as SendPayload;
    const organisation = await deps.repos.organisations.findById(job.organisationId);
    if (!organisation) throw new Error('organisation missing');

    let content: Buffer | null;
    let filename: string;
    let contentType: string;
    if (payload.template && payload.row) {
      content = await renderBatchPdf(
        deps.renderer,
        payload.template,
        payload.row,
        organisation.name,
      );
      filename = fileNameOf(
        api.mergeText(payload.template.title, valuesOf(payload.template, payload.row)),
        'pdf',
      );
      contentType = 'application/pdf';
    } else {
      content = payload.attachmentKey ? await deps.store.get(payload.attachmentKey) : null;
      if (!content) throw new Error('the document to send is no longer stored');
      filename = payload.filename ?? 'document.pdf';
      contentType = payload.contentType ?? 'application/pdf';
    }

    const from = await senderFor(deps.repos, deps.provider, job.organisationId);
    const sent = await deps.provider.send({
      to: payload.to,
      ...(from ? { from } : {}),
      subject: payload.subject,
      text: payload.text,
      attachments: [{ filename, contentType, content }],
      idempotencyKey: job.idempotencyKey,
    });
    return {
      provider: deps.provider.name,
      messageId: sent.messageId,
      filename,
      bytes: content.length,
    };
  };
}

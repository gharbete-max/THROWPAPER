import { api } from '@tp/shared';
import type { Repositories } from '../db/repositories/index.js';
import type { JobHandler } from '../jobs/worker.js';
import type { MailProvider } from '../mail/provider.js';
import { senderFor } from '../signing/invitations.js';
import { TEST_MARK } from './service.js';
import { signUnsubscribeToken, unsubscribeHeaders } from './unsubscribe.js';

/**
 * A campaign: one plain-text email each to a list (`packages/shared/src/api/campaign.ts`).
 *
 * It rides the same machinery as a batch of documents: a request that carries its confirmation
 * queues one job per recipient, `key:address` is the job's idempotency key (so a double press, a
 * retry or a second tab queues nothing twice, and a repeated address in the list is one message),
 * and the worker hands each message to the configured provider, which on a test setup writes it
 * somewhere harmless.
 *
 * ## Suppression belongs here and nowhere else
 *
 * The list is read when the campaign is queued (an address on it is skipped and said so) and again
 * when the job runs (somebody who unsubscribed in between gets nothing). `send.document`, the
 * signing invitation and the registration confirmation never read it: those are one person's own
 * business with the recipient, and a campaign unsubscribe must not stop them. A test send goes
 * only to the sender and ignores the list.
 *
 * ## Nothing tracks
 *
 * The message is `text` and nothing else: no HTML part, so no pixel, and the sender's links are
 * left exactly as written, so none is rewritten through a redirect. The one link this code adds is
 * the recipient's own unsubscribe link.
 */
export const CAMPAIGN_JOB = 'send.campaign';

export interface CampaignPayload {
  /** Where it goes: the recipient, or the sender's own address in a test. */
  to: string;
  /** Who it is for. */
  recipient: string;
  subject: string;
  text: string;
  unsubscribe: string;
  test: boolean;
}

export interface CampaignDeps {
  repos: Repositories;
  unsubscribeKey: Buffer;
  /** The app's origin and `/api`: where an unsubscribe link points. */
  publicApiUrl: string;
}

export async function queueCampaign(
  deps: CampaignDeps,
  organisationId: string,
  request: api.SendCampaignRequest,
): Promise<api.CampaignQueued> {
  const audience = api.uniqueRecipients(request.rows);
  const suppressed = new Set(
    request.testTo
      ? []
      : await deps.repos.campaignSuppressions.among(
          organisationId,
          audience.map((row) => row.email),
        ),
  );
  const items: api.CampaignQueued['items'] = [];
  const skipped: string[] = [];
  for (const [index, row] of audience.entries()) {
    const address = api.normaliseAddress(row.email);
    if (suppressed.has(address)) {
      skipped.push(address);
      continue;
    }
    // In a test the link is the sender's own, so trying it out never stops a real recipient.
    const url = `${deps.publicApiUrl}/v1/unsubscribe?t=${signUnsubscribeToken(
      organisationId,
      request.testTo ?? address,
      deps.unsubscribeKey,
    )}`;
    const message = api.renderCampaign(request, row, url);
    const payload: CampaignPayload = request.testTo
      ? {
          to: request.testTo,
          recipient: address,
          subject: `${TEST_MARK} ${message.subject}`,
          text: `${TEST_MARK} ${address}\n\n${message.text}`,
          unsubscribe: url,
          test: true,
        }
      : { to: address, recipient: address, ...message, unsubscribe: url, test: false };
    const job = await deps.repos.jobs.enqueue({
      organisationId,
      kind: CAMPAIGN_JOB,
      idempotencyKey: `${CAMPAIGN_JOB}:${request.key}:${address}`,
      payload: { ...payload },
      progressTotal: 1,
      maxAttempts: 3,
    });
    items.push({ index, to: payload.to, id: job.id });
  }
  return { items, skipped };
}

export function createCampaignHandler(deps: {
  repos: Repositories;
  provider: MailProvider;
}): JobHandler {
  return async ({ job }) => {
    const payload = job.payload as unknown as CampaignPayload;
    if (!payload.test) {
      const stopped = await deps.repos.campaignSuppressions.among(job.organisationId, [
        payload.recipient,
      ]);
      if (stopped.length > 0) return { skipped: 'suppressed' };
    }
    const from = await senderFor(deps.repos, deps.provider, job.organisationId);
    const sent = await deps.provider.send({
      to: payload.to,
      ...(from ? { from } : {}),
      subject: payload.subject,
      text: payload.text,
      headers: unsubscribeHeaders(payload.unsubscribe),
      idempotencyKey: job.idempotencyKey,
    });
    return { provider: deps.provider.name, messageId: sent.messageId };
  };
}

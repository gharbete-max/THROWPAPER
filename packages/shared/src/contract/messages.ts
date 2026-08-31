import { z } from 'zod';
import {
  Attachment,
  ContactRef,
  IdempotencyKey,
  Locale,
  MergeData,
  OrganisationId,
  Recipient,
} from './common.js';

/** CONTRACT §1.1 — Formwork → Sendwork. One transactional email. */
export const SendMessageRequest = z.object({
  organisationId: OrganisationId,
  templateKey: z.string().min(1),
  locale: Locale,
  to: Recipient,
  mergeData: MergeData,
  attachments: z.array(Attachment).optional(),
  /** Required. A retry must never double-send. */
  idempotencyKey: IdempotencyKey,
  category: z.literal('transactional'),
});

export const SendMessageResponse = z.object({
  messageId: z.string().min(1),
  status: z.literal('queued'),
});

/** CONTRACT §2.2 — Sendwork → Formwork webhook. */
export const DeliveryEvent = z.object({
  messageId: z.string().min(1),
  contactRef: ContactRef,
  event: z.enum(['delivered', 'bounced', 'complained', 'opened', 'clicked']),
  at: z.string().datetime(),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequest>;
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;
export type DeliveryEvent = z.infer<typeof DeliveryEvent>;

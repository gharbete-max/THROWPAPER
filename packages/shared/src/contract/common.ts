import { z } from 'zod';

/** Bumped only by joint decision — docs/CONTRACT.md. Sent as `X-Contract-Version`. */
export const CONTRACT_VERSION = 1;
export const CONTRACT_VERSION_HEADER = 'x-contract-version';

export const OrganisationId = z.string().uuid();
export const ContactRef = z.string().min(1).max(128);
/** BCP-47. Validated loosely here; packages/i18n owns the org's allowed set. */
export const Locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export const IdempotencyKey = z.string().min(8).max(255);

export const MergeData = z.record(z.unknown());

export const Recipient = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  contactRef: ContactRef.optional(),
});

export const Attachment = z
  .object({
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    url: z.string().url().optional(),
    base64: z.string().optional(),
  })
  .refine((a) => Boolean(a.url) !== Boolean(a.base64), {
    message: 'Provide exactly one of url or base64',
  });

export const Page = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type Recipient = z.infer<typeof Recipient>;
export type Attachment = z.infer<typeof Attachment>;

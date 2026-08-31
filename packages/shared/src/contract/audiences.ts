import { z } from 'zod';
import { ContactRef, Locale, MergeData, OrganisationId } from './common.js';

export const AudienceMember = z.object({
  contactRef: ContactRef,
  email: z.string().email(),
  locale: Locale.optional(),
  mergeData: MergeData.optional(),
});

/** CONTRACT §1.3 — Formwork pushes a computed audience; Sendwork stores it as a snapshot. */
export const PushAudienceRequest = z.object({
  organisationId: OrganisationId,
  members: z.array(AudienceMember),
  computedAt: z.string().datetime(),
});

export const PushAudienceResponse = z.object({
  audienceKey: z.string().min(1),
  memberCount: z.number().int().nonnegative(),
  snapshotAt: z.string().datetime(),
});

/** CONTRACT §2.1 — Sendwork pulls a live audience at send time. Paginated. */
export const PullAudienceResponse = z.object({
  members: z.array(AudienceMember),
  nextCursor: z.string().optional(),
});

export type AudienceMember = z.infer<typeof AudienceMember>;

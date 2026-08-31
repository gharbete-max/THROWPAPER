import { z } from 'zod';
import { ContactRef, Locale, OrganisationId } from './common.js';

export const CustomFieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * CONTRACT §1.2 — idempotent on contactRef.
 * Consent is Sendwork's record. Formwork never sends it, so it is not in this schema.
 */
export const UpsertContact = z.object({
  contactRef: ContactRef,
  email: z.string().email(),
  name: z.string().optional(),
  preferredLocale: Locale.optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(CustomFieldValue).optional(),
});

export const UpsertContactsRequest = z.object({
  organisationId: OrganisationId,
  contacts: z.array(UpsertContact).min(1).max(1000),
});

export const UpsertContactsResponse = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

export type UpsertContact = z.infer<typeof UpsertContact>;

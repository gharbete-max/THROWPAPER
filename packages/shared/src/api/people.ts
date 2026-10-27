import { z } from 'zod';

/** A person kept by hand and registered for events without a public form. */
export const PersonInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320).nullable().default(null),
  phone: z.string().trim().max(60).nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
  eventIds: z.array(z.guid()).max(500).default([]),
});
export type PersonInput = z.infer<typeof PersonInput>;

export const PersonResponse = PersonInput.extend({ id: z.guid(), createdAt: z.string() });
export type PersonResponse = z.infer<typeof PersonResponse>;

export const PersonListResponse = z.object({ people: z.array(PersonResponse) });
export type PersonListResponse = z.infer<typeof PersonListResponse>;

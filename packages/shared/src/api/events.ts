import { z } from 'zod';
import { LocalisedText, Uuid } from './common.js';

export const EventStatus = z.enum(['draft', 'open', 'closed', 'archived']);
export type EventStatus = z.infer<typeof EventStatus>;

const IsoDateTime = z.string().datetime({ offset: true });

const EventFields = z.object({
  name: LocalisedText,
  description: LocalisedText.optional(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  venueName: z.string().max(200).optional(),
  venueAddress: z.string().max(500).optional(),
  /** Null means uncapped. */
  capacity: z.number().int().positive().nullable().optional(),
  registrationClosesAt: IsoDateTime.nullable().optional(),
  status: EventStatus.exclude(['archived']).optional(),
});

export const EventInput = EventFields.refine(
  (event) => new Date(event.endsAt) >= new Date(event.startsAt),
  {
    message: 'endsAt must not be before startsAt',
    path: ['endsAt'],
  },
).refine(
  (event) =>
    !event.registrationClosesAt || new Date(event.registrationClosesAt) <= new Date(event.startsAt),
  { message: 'Registration cannot close after the event starts', path: ['registrationClosesAt'] },
);

export const EventPatch = EventFields.partial();

export const EventResponse = z.object({
  id: Uuid,
  name: LocalisedText,
  description: LocalisedText,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  capacity: z.number().int().nullable(),
  registrationClosesAt: IsoDateTime.nullable(),
  status: EventStatus,
  registeredCount: z.number().int().nonnegative(),
  /** Computed, never stored — capacity and the closing date can both move. */
  registrationOpen: z.boolean(),
  /** Supported locales with no name yet. Drives the completeness indicator. */
  missingLocales: z.array(z.string()),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EventListResponse = z.object({ events: z.array(EventResponse) });

export type EventInput = z.infer<typeof EventInput>;
export type EventPatch = z.infer<typeof EventPatch>;
export type EventResponse = z.infer<typeof EventResponse>;

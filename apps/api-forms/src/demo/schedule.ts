/**
 * When the demo event happens.
 *
 * Computed relative to now, never hard-coded. The seed originally pinned `2026-05-14`, which meant
 * that from `2026-05-08` onwards registration was closed and the whole v0.1 loop — register, PDF,
 * email, check in — could not be demonstrated at all. It failed silently: `pnpm db:seed` still
 * reported success, and the product simply refused to accept anybody.
 *
 * A demo that expires on a calendar date is worse than no demo, because it breaks months later in
 * front of whoever is being shown the product.
 */
export interface DemoSchedule {
  startsAt: Date;
  endsAt: Date;
  registrationClosesAt: Date;
  /** For naming the event, so the title does not go stale either. */
  year: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Far enough out to look real, near enough that the date is plausible on screen. */
export const DAYS_UNTIL_EVENT = 60;
export const DAYS_REGISTRATION_OPEN_BEFORE_EVENT = 7;

export function demoSchedule(now: Date = new Date()): DemoSchedule {
  const start = new Date(now.getTime() + DAYS_UNTIL_EVENT * DAY_MS);
  start.setUTCHours(9, 0, 0, 0);

  const end = new Date(start.getTime());
  end.setUTCHours(16, 0, 0, 0);

  const closes = new Date(start.getTime() - DAYS_REGISTRATION_OPEN_BEFORE_EVENT * DAY_MS);
  closes.setUTCHours(23, 59, 59, 0);

  return {
    startsAt: start,
    endsAt: end,
    registrationClosesAt: closes,
    year: start.getUTCFullYear(),
  };
}

/** Names the demo event for the year it actually falls in. */
export function demoEventName(schedule: DemoSchedule): Record<string, string> {
  return {
    'sv-SE': `Vårmötet ${schedule.year}`,
    'en-GB': `Spring meeting ${schedule.year}`,
  };
}

import { missingLocales, type LocaleConfig } from '@tp/i18n';
import type { EventResponse } from '@tp/shared/api';
import type { EventRecord } from '../db/repositories/index.js';

/**
 * `registrationOpen` is computed, never stored. Capacity and the closing date both move, and a
 * stored flag would quietly go stale the moment either did.
 */
export function registrationOpen(
  event: EventRecord,
  registeredCount: number,
  now: Date = new Date(),
): boolean {
  if (event.status !== 'open') return false;
  if (event.registrationClosesAt && event.registrationClosesAt.getTime() <= now.getTime()) {
    return false;
  }
  if (event.capacity !== null && registeredCount >= event.capacity) return false;
  return true;
}

export function toEventResponse(
  event: EventRecord,
  registeredCount: number,
  locales: LocaleConfig,
  now: Date = new Date(),
): EventResponse {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    capacity: event.capacity,
    registrationClosesAt: event.registrationClosesAt?.toISOString() ?? null,
    status: event.status,
    registeredCount,
    registrationOpen: registrationOpen(event, registeredCount, now),
    missingLocales: missingLocales(locales, event.name),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/** The org's locale configuration, in the shape packages/i18n expects. */
export function localeConfigFor(organisation: {
  defaultLocale: string;
  supportedLocales: string[];
}): LocaleConfig {
  return { supported: organisation.supportedLocales, default: organisation.defaultLocale };
}

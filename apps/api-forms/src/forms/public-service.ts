import { randomBytes } from 'node:crypto';
import type { EventRecord, FormRecord } from '../db/repositories/index.js';

/**
 * Why a public form is or is not accepting answers.
 *
 * Scheduling lives on the form; capacity lives on the linked event. Both are evaluated fresh on
 * every request rather than stored, so a form closes the moment its deadline passes without
 * anything having to sweep it.
 */
export type ClosedReason = 'not-open-yet' | 'closed' | 'full' | 'unpublished';

export function formAvailability(
  form: FormRecord,
  event: EventRecord | null,
  completedCount: number,
  now: Date = new Date(),
): { open: boolean; reason: ClosedReason | null } {
  if (!form.publishedVersionId || form.status === 'draft') {
    return { open: false, reason: 'unpublished' };
  }
  if (form.status === 'closed' || form.status === 'archived') {
    return { open: false, reason: 'closed' };
  }
  if (form.opensAt && form.opensAt.getTime() > now.getTime()) {
    return { open: false, reason: 'not-open-yet' };
  }
  if (form.closesAt && form.closesAt.getTime() <= now.getTime()) {
    return { open: false, reason: 'closed' };
  }

  if (event) {
    if (event.registrationClosesAt && event.registrationClosesAt.getTime() <= now.getTime()) {
      return { open: false, reason: 'closed' };
    }
    if (event.capacity !== null && completedCount >= event.capacity) {
      return { open: false, reason: 'full' };
    }
  }

  return { open: true, reason: null };
}

/** Capacity that applies to this form, or null when nothing caps it. */
export function capacityFor(event: EventRecord | null): number | null {
  return event?.capacity ?? null;
}

/**
 * Human-quotable reference. Crockford-style alphabet with I, L, O and U removed, so nobody has to
 * decide whether that was a one or an I while reading it out at a door.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

/**
 * The email answer, used for duplicate control.
 *
 * Takes the first email-typed field, so an operator does not have to nominate one. A form with no
 * email field simply has no duplicate control, which is the honest behaviour.
 */
export function emailAnswer(
  fields: readonly { key: string; type: string }[],
  values: Record<string, unknown>,
): string | null {
  const field = fields.find((candidate) => candidate.type === 'email');
  if (!field) return null;
  const value = values[field.key];
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

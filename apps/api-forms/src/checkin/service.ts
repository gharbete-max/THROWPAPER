import { forms as formSchemas } from '@tp/shared';
import type { Repositories, SubmissionRecord } from '../db/repositories/index.js';
import { deriveQrKey, verifyAdmissionToken } from '../documents/qr-token.js';
import { guestsOf } from './party.js';

const { parseEntryReference, REGISTRANT_ENTRY } = formSchemas;

/**
 * The decision made at a door.
 *
 * Every outcome carries the attendee where one is known, because the person on the door needs to
 * see who this is even when the answer is no. `already` is not a failure — a scanner that retries
 * after a dropped response must not turn one attendee into an error in front of a queue.
 *
 * `no-such-guest` is the outcome a guest card gets when the registration no longer says that guest
 * is coming — somebody edited the answers down after the cards were printed. It is deliberately
 * distinct from `not-found`: the registration is real and the person on the door can see whose it
 * is, which is the difference between "I can help you" and "this code means nothing".
 */
export type CheckInOutcome =
  | 'admitted'
  | 'already'
  | 'revoked'
  | 'wrong-event'
  | 'not-found'
  | 'no-such-guest'
  | 'bad-signature';

export interface CheckInResult {
  outcome: CheckInOutcome;
  submission: SubmissionRecord | null;
  checkedInAt: Date | null;
  /** 0 for the registrant, 1-based for a guest — whose card this was. */
  entryIndex: number;
  /**
   * The guest's own name, where the card was a guest's and the form says which answer names them.
   *
   * Null for the registrant, whose name the caller already reads off the submission.
   */
  guestName: string | null;
}

export interface CheckInInput {
  organisationId: string;
  eventId: string;
  /** A scanned `<reference>.<signature>`, or a reference typed by hand. */
  code: string;
  byUserId: string | null;
  jwtSecret: string;
}

export async function checkIn(repos: Repositories, input: CheckInInput): Promise<CheckInResult> {
  const code = input.code.trim();
  const looksSigned = code.includes('.');

  let scanned = code.toUpperCase();

  if (looksSigned) {
    // Verified before any query runs: a forged card costs nothing to refuse.
    const verified = verifyAdmissionToken(code, input.eventId, deriveQrKey(input.jwtSecret));
    if (!verified.ok) {
      /*
       * A correctly-signed card for a different event fails here too, and the reference alone
       * cannot tell us which — so check whether it exists before blaming the signature.
       *
       * The lookup uses the submission's own reference, not the scanned one: a guest card reads
       * `ABCD-EFGH:2`, and no row is stored under that.
       */
      const guess = parseEntryReference(code.split('.')[0] ?? '');
      const candidate = guess
        ? await repos.submissions.findByReference(input.organisationId, guess.reference)
        : null;
      if (candidate && candidate.eventId !== input.eventId) {
        return refuse('wrong-event', candidate, guess?.entryNumber ?? REGISTRANT_ENTRY);
      }
      return refuse('bad-signature', null);
    }
    scanned = verified.reference;
  }

  /**
   * `ABCD-EFGH` or `ABCD-EFGH:2` — the same grammar whether it was scanned or typed at the door.
   *
   * A signed token has already proved the ordinal is the one this product issued; a typed one has
   * not, which is exactly why the entry is checked against the answers further down rather than
   * being believed.
   */
  const parsed = parseEntryReference(scanned);
  if (!parsed) return refuse('not-found', null);

  const submission = await repos.submissions.findByReference(
    input.organisationId,
    parsed.reference,
  );
  if (!submission || submission.status !== 'complete') return refuse('not-found', null);

  if (submission.eventId !== input.eventId) {
    return refuse('wrong-event', submission, parsed.entryNumber);
  }

  if (submission.revokedAt) {
    /*
     * Refused, but the record is shown: the door needs to say why, not just no.
     *
     * A guest's card is refused by the same check. They have no registration of their own to
     * survive — they are here because somebody registered and said they were bringing them — so
     * withdrawing that registration withdraws the party. See ADR 0003.
     */
    return refuse('revoked', submission, parsed.entryNumber);
  }

  /**
   * A guest's card is checked against what the registration actually says.
   *
   * The signature proves the card was issued; it does not prove the answers still say so. Somebody
   * who registered three guests, was sent three cards and then edited down to one has two cards in
   * circulation that no longer correspond to anybody, and the door should say so rather than admit
   * a guest who is not on the list.
   *
   * The definition read is **the version the answers were given against**, not the form's current
   * one. A card is a promise made at a moment, and re-reading it against a form that has since been
   * republished would invalidate cards nobody did anything wrong with.
   */
  let guestName: string | null = null;

  if (parsed.entryNumber !== REGISTRANT_ENTRY) {
    const guest = await findGuest(repos, submission, parsed.entryNumber);
    if (!guest) return refuse('no-such-guest', submission, parsed.entryNumber);
    guestName = guest.name;
  }

  const { created, checkIn: record } = await repos.checkIns.admit({
    organisationId: input.organisationId,
    submissionId: submission.id,
    eventId: input.eventId,
    checkedInByUserId: input.byUserId,
    method: looksSigned ? 'scan' : 'manual',
    entryIndex: parsed.entryNumber,
  });

  return {
    outcome: created ? 'admitted' : 'already',
    submission,
    checkedInAt: record.checkedInAt,
    entryIndex: parsed.entryNumber,
    guestName,
  };
}

function refuse(
  outcome: CheckInOutcome,
  submission: SubmissionRecord | null,
  entryIndex: number = REGISTRANT_ENTRY,
): CheckInResult {
  return { outcome, submission, checkedInAt: null, entryIndex, guestName: null };
}

/**
 * The guest a 1-based ordinal refers to, or null if the registration no longer has one.
 *
 * Costs a version lookup, and only on a card that carries an ordinal — the registrant's own scan,
 * which is the overwhelming majority, still touches nothing but the submission. That matters at a
 * door on a venue's network.
 */
async function findGuest(
  repos: Repositories,
  submission: SubmissionRecord,
  entryNumber: number,
): Promise<{ name: string | null } | null> {
  const versions = await repos.forms.listVersions(submission.formId);
  const version = versions.find((candidate) => candidate.id === submission.formVersionId);
  if (!version) return null;

  const guest = guestsOf(version.definition, submission).find(
    (member) => member.entryIndex === entryNumber,
  );
  return guest ? { name: guest.guestName } : null;
}

export interface EventAttendance {
  /**
   * **People**, not rows.
   *
   * An event with 80 registrations each bringing a guest expects 160 at the door, and an
   * attendance figure that says 80 is wrong in the direction that matters: it is the number a
   * capacity is read against and the number a fire officer is given.
   */
  registered: number;
  /** Rows. Kept beside `registered` because "80 registrations, 160 people" is two useful facts. */
  registrations: number;
  checkedIn: number;
  noShow: number;
  revoked: number;
  /** Arrivals bucketed by hour, for spotting the rush. */
  byHour: Array<{ hour: string; count: number }>;
}

/**
 * How the door is doing.
 *
 * `partySize` says how many people one registration brings — the registrant plus however many
 * entries their admitting group holds. It is passed in rather than worked out here because a
 * submission alone cannot answer it: the group's key lives in the form definition, and this
 * function is given submissions from however many forms feed the event.
 *
 * It defaults to one, which is what every event without an admitting group is and what every
 * caller written before guests existed meant.
 */
export function attendanceOf(
  submissions: readonly SubmissionRecord[],
  checkIns: readonly { submissionId: string; checkedInAt: Date }[],
  partySize: (submission: SubmissionRecord) => number = () => 1,
): EventAttendance {
  const complete = submissions.filter((submission) => submission.status === 'complete');
  const people = (rows: readonly SubmissionRecord[]) =>
    rows.reduce((total, submission) => total + Math.max(1, partySize(submission)), 0);

  // A withdrawn registration withdraws the people it brought: a guest has no registration of
  // their own to survive. Counted as people for the same reason `registered` is.
  const revoked = people(complete.filter((submission) => submission.revokedAt));
  const registered = people(complete);
  const checkedIn = checkIns.length;

  const buckets = new Map<string, number>();
  for (const entry of checkIns) {
    const hour = entry.checkedInAt.toISOString().slice(0, 13) + ':00';
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }

  return {
    registered,
    registrations: complete.length,
    checkedIn,
    // Revoked registrations are not no-shows — nobody was expecting them.
    noShow: registered - revoked - checkedIn,
    revoked,
    byHour: [...buckets.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
  };
}

/**
 * How many people one registration brings, against the definition its answers were given under.
 *
 * One, plus the guests. Reads the same list the door screen and the card printer read, so the
 * count and the cards cannot disagree about who is expected.
 */
export function partySizeOf(
  definition: unknown,
  submission: Pick<SubmissionRecord, 'data'>,
): number {
  return 1 + guestsOf(definition, submission).length;
}

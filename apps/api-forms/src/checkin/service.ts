import type { Repositories, SubmissionRecord } from '../db/repositories/index.js';
import { deriveQrKey, verifyAdmissionToken } from '../documents/qr-token.js';

/**
 * The decision made at a door.
 *
 * Every outcome carries the attendee where one is known, because the person on the door needs to
 * see who this is even when the answer is no. `already` is not a failure — a scanner that retries
 * after a dropped response must not turn one attendee into an error in front of a queue.
 */
export type CheckInOutcome =
  'admitted' | 'already' | 'revoked' | 'wrong-event' | 'not-found' | 'bad-signature';

export interface CheckInResult {
  outcome: CheckInOutcome;
  submission: SubmissionRecord | null;
  checkedInAt: Date | null;
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

  let reference = code.toUpperCase();

  if (looksSigned) {
    // Verified before any query runs: a forged card costs nothing to refuse.
    const verified = verifyAdmissionToken(code, input.eventId, deriveQrKey(input.jwtSecret));
    if (!verified.ok) {
      // A correctly-signed card for a different event fails here too, and the reference alone
      // cannot tell us which — so check whether it exists before blaming the signature.
      const candidate = await repos.submissions.findByReference(
        input.organisationId,
        code.split('.')[0] ?? '',
      );
      if (candidate && candidate.eventId !== input.eventId) {
        return { outcome: 'wrong-event', submission: candidate, checkedInAt: null };
      }
      return { outcome: 'bad-signature', submission: null, checkedInAt: null };
    }
    reference = verified.reference;
  }

  const submission = await repos.submissions.findByReference(input.organisationId, reference);
  if (!submission || submission.status !== 'complete') {
    return { outcome: 'not-found', submission: null, checkedInAt: null };
  }

  if (submission.eventId !== input.eventId) {
    return { outcome: 'wrong-event', submission, checkedInAt: null };
  }

  if (submission.revokedAt) {
    // Refused, but the record is shown: the door needs to say why, not just no.
    return { outcome: 'revoked', submission, checkedInAt: null };
  }

  const { created, checkIn: record } = await repos.checkIns.admit({
    organisationId: input.organisationId,
    submissionId: submission.id,
    eventId: input.eventId,
    checkedInByUserId: input.byUserId,
    method: looksSigned ? 'scan' : 'manual',
  });

  return {
    outcome: created ? 'admitted' : 'already',
    submission,
    checkedInAt: record.checkedInAt,
  };
}

export interface EventAttendance {
  registered: number;
  checkedIn: number;
  noShow: number;
  revoked: number;
  /** Arrivals bucketed by hour, for spotting the rush. */
  byHour: Array<{ hour: string; count: number }>;
}

export function attendanceOf(
  submissions: readonly SubmissionRecord[],
  checkIns: readonly { submissionId: string; checkedInAt: Date }[],
): EventAttendance {
  const complete = submissions.filter((submission) => submission.status === 'complete');
  const revoked = complete.filter((submission) => submission.revokedAt).length;
  const checkedIn = checkIns.length;

  const buckets = new Map<string, number>();
  for (const entry of checkIns) {
    const hour = entry.checkedInAt.toISOString().slice(0, 13) + ':00';
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }

  return {
    registered: complete.length,
    checkedIn,
    // Revoked registrations are not no-shows — nobody was expecting them.
    noShow: complete.length - revoked - checkedIn,
    revoked,
    byHour: [...buckets.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
  };
}

import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, forms as formSchemas } from '@tp/shared';

const { entryReference, MAX_GROUP_ENTRIES, REGISTRANT_ENTRY } = formSchemas;
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { attendanceOf, checkIn } from '../checkin/service.js';
import { guestsForAll } from '../checkin/party.js';
import { attendeeName } from '../documents/admission.js';

const EventParam = z.object({ id: z.string().uuid() });
const SubmissionParam = z.object({ id: z.string().uuid() });
const UndoParam = z.object({ id: z.string().uuid(), submissionId: z.string().uuid() });

/**
 * Which card to take back, defaulting to the registrant's.
 *
 * A query parameter rather than a second path segment, so every existing caller keeps working and
 * keeps meaning what it meant: before guests, a submission had exactly one arrival.
 */
const UndoQuery = z.object({
  entry: z.coerce.number().int().min(0).max(MAX_GROUP_ENTRIES).default(REGISTRANT_ENTRY),
});

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
} as const;

const CheckInRequest = z.object({
  /** A scanned token or a typed reference — the endpoint works out which. */
  code: z.string().min(3).max(512),
});

const AttendeeSummary = z.object({
  submissionId: z.string().uuid(),
  /** The card's own reference: `ABCD-EFGH` for the registrant, `ABCD-EFGH:2` for their guest. */
  reference: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  locale: z.string(),
  revoked: z.boolean(),
  checkedInAt: z.string().nullable(),
  /**
   * 0 for the registrant, 1-based for a guest.
   *
   * Defaulted so a response written before guests existed still parses as the registrant, which is
   * what it was.
   */
  entryIndex: z.number().int().nonnegative().default(0),
  /** Who brought them, for a guest. Null for a registrant, who brought themselves. */
  broughtBy: z.string().nullable().default(null),
});

const CheckInResponse = z.object({
  outcome: z.enum([
    'admitted',
    'already',
    'revoked',
    'wrong-event',
    'not-found',
    'no-such-guest',
    'bad-signature',
  ]),
  attendee: AttendeeSummary.nullable(),
  checkedInAt: z.string().nullable(),
});

const AttendanceResponse = z.object({
  /** People expected, counting guests. `registrations` is the number of rows behind them. */
  registered: z.number().int(),
  registrations: z.number().int(),
  checkedIn: z.number().int(),
  noShow: z.number().int(),
  revoked: z.number().int(),
  byHour: z.array(z.object({ hour: z.string(), count: z.number().int() })),
  attendees: z.array(AttendeeSummary),
  /**
   * The caller's own latest arrivals, newest first — the door's undo list.
   *
   * Server-side so a reload, a dropped tab or a swapped phone keeps it. Only the caller's: an
   * arrival made at the other door is not this operator's mis-scan to take back.
   */
  recent: z.array(AttendeeSummary),
});

/** How many arrivals the door keeps within reach of an undo. */
const RECENT_ARRIVALS = 5;

export function registerCheckInRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps; jwtSecret: string },
): void {
  // Operators run the door. This is the one thing the Operator role exists for.
  const authenticated = requireAuth(deps.guard);
  const adminOnly = requireAuth(deps.guard, ['admin']);

  /**
   * Admit somebody.
   *
   * Always 200 with a decision, never a bare error: the person on the door needs to know why as
   * much as yes-or-no, and an HTTP status is a poor way to say "already arrived at 09:14".
   */
  app.post('/v1/events/:id/check-ins', {
    preHandler: authenticated,
    schema: {
      tags: ['check-in'],
      params: EventParam,
      body: CheckInRequest,
      response: { 200: CheckInResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = EventParam.parse(request.params);
      const body = CheckInRequest.parse(request.body);

      const event = await deps.repos.events.findById(auth.organisation.id, id);
      if (!event) return notFound(reply);

      const result = await checkIn(deps.repos, {
        organisationId: auth.organisation.id,
        eventId: id,
        code: body.code,
        byUserId: auth.user.id,
        jwtSecret: deps.jwtSecret,
      });

      // Only a first admission is worth an audit row; a repeated scan is noise.
      if (result.outcome === 'admitted' && result.submission) {
        await recordAudit(deps.repos, request, {
          action: 'checkin.admitted',
          entityType: 'submission',
          entityId: result.submission.id,
          after: { eventId: id },
        });
      }

      return reply.send({
        outcome: result.outcome,
        attendee: result.submission
          ? toAttendee(result.submission, result.checkedInAt, {
              entryIndex: result.entryIndex,
              guestName: result.guestName,
            })
          : null,
        checkedInAt: result.checkedInAt?.toISOString() ?? null,
      });
    },
  });

  /**
   * Undo a check-in.
   *
   * The door's mistake is a mis-scan — the wrong card, or a card for the person behind — and the
   * remedy is a button next to the arrival that was just made, not a support ticket. Same access
   * as checking in: whoever can admit can un-admit. 204 whether or not there was anything to
   * undo, because the state the caller wanted is the state they have.
   */
  app.delete('/v1/events/:id/check-ins/:submissionId', {
    preHandler: authenticated,
    schema: {
      tags: ['check-in'],
      params: UndoParam,
      querystring: UndoQuery,
      response: { 204: z.null(), ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id, submissionId } = UndoParam.parse(request.params);
      const { entry } = UndoQuery.parse(request.query);

      const event = await deps.repos.events.findById(auth.organisation.id, id);
      if (!event) return notFound(reply);

      // One card. Taking the registrant's arrival back must not silently take their guests'
      // arrivals back with it — those people are still standing in the room.
      const undone = await deps.repos.checkIns.withdraw(auth.organisation.id, submissionId, entry);
      if (undone) {
        await recordAudit(deps.repos, request, {
          action: 'checkin.undone',
          entityType: 'submission',
          entityId: submissionId,
          after: { eventId: id, entryIndex: entry },
        });
      }
      return reply.code(204).send();
    },
  });

  /** Attendee list, check-in status and no-show counts for one event. */
  app.get('/v1/events/:id/attendance', {
    preHandler: authenticated,
    schema: {
      tags: ['check-in'],
      params: EventParam,
      response: { 200: AttendanceResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = EventParam.parse(request.params);

      const event = await deps.repos.events.findById(auth.organisation.id, id);
      if (!event) return notFound(reply);

      // One query, on the event, rather than one per form that happens to point at it.
      const submissions = await deps.repos.submissions.listForEvent(auth.organisation.id, id);

      const checkIns = await deps.repos.checkIns.listForEvent(auth.organisation.id, id);
      /**
       * Keyed by card, not by submission: a registration and each of its guests arrive separately.
       */
      const arrivals = new Map(
        checkIns.map((entry) => [`${entry.submissionId}:${entry.entryIndex}`, entry.checkedInAt]),
      );

      const parties = await guestsForAll(deps.repos, submissions);
      const attendance = attendanceOf(
        submissions,
        checkIns,
        (submission) => 1 + (parties.get(submission.id)?.length ?? 0),
      );

      const complete = submissions.filter((submission) => submission.status === 'complete');

      /**
       * One row per person, guests immediately after whoever brought them.
       *
       * Grouped rather than sorted by name, because the door screen is read by somebody with a
       * queue in front of them: "this is the member, these two are theirs" is the question being
       * asked, and a flat alphabetical list separates a party across the page.
       */
      const attendees = complete.flatMap((submission) => [
        toAttendee(submission, arrivals.get(`${submission.id}:${REGISTRANT_ENTRY}`) ?? null),
        ...(parties.get(submission.id) ?? []).map((guest) =>
          toAttendee(
            submission,
            arrivals.get(`${submission.id}:${guest.entryIndex}`) ?? null,
            guest,
          ),
        ),
      ]);
      const byCard = new Map(
        attendees.map((row) => [`${row.submissionId}:${row.entryIndex}`, row]),
      );

      return reply.send({
        ...attendance,
        attendees,
        recent: checkIns
          .filter((entry) => entry.checkedInByUserId === auth.user.id)
          .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())
          .flatMap((entry) => byCard.get(`${entry.submissionId}:${entry.entryIndex}`) ?? [])
          .slice(0, RECENT_ARRIVALS),
      });
    },
  });

  /** Withdraw a registration. Not a delete — the record and its audit trail stay. */
  app.post('/v1/submissions/:id/revoke', {
    preHandler: adminOnly,
    schema: {
      tags: ['check-in'],
      params: SubmissionParam,
      response: { 200: AttendeeSummary, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = SubmissionParam.parse(request.params);

      const revoked = await deps.repos.submissions.revoke(auth.organisation.id, id, new Date());
      if (!revoked) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'submission.revoked',
        entityType: 'submission',
        entityId: id,
      });

      // Revoking after arrival does not erase the arrival — that happened.
      const existing = await deps.repos.checkIns.findBySubmission(id);
      return reply.send(toAttendee(revoked, existing?.checkedInAt ?? null));
    },
  });
}

/**
 * One row on the door screen: a registrant, or one of the guests they brought.
 *
 * A guest borrows almost everything from the registration — the same email, the same language, the
 * same revoked state — because they have none of their own. What is theirs is the reference on
 * their card, their own name where the form names it, and the fact that somebody brought them.
 */
function toAttendee(
  submission: {
    id: string;
    reference: string;
    email: string | null;
    locale: string;
    revokedAt: Date | null;
    data: Record<string, unknown>;
  },
  checkedInAt: Date | null,
  guest: { entryIndex: number; guestName: string | null } = {
    entryIndex: REGISTRANT_ENTRY,
    guestName: null,
  },
) {
  const registrant = attendeeName(submission.data);
  const isGuest = guest.entryIndex !== REGISTRANT_ENTRY;

  return {
    submissionId: submission.id,
    reference: entryReference(submission.reference, guest.entryIndex),
    /**
     * A guest with no name answer shows as empty rather than borrowing the registrant's.
     *
     * Two rows reading "Alva Öberg" on a door screen is worse than one reading "Alva Öberg" and
     * one blank: the second is obviously a guest whose name was not asked for, and the first is a
     * duplicate somebody will try to resolve.
     */
    name: isGuest ? (guest.guestName ?? '') : registrant,
    email: submission.email,
    locale: submission.locale,
    revoked: submission.revokedAt !== null,
    checkedInAt: checkedInAt?.toISOString() ?? null,
    entryIndex: guest.entryIndex,
    broughtBy: isGuest ? registrant || submission.reference : null,
  };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

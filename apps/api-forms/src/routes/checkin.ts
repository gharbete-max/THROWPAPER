import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { attendanceOf, checkIn } from '../checkin/service.js';
import { attendeeName } from '../documents/admission.js';

const EventParam = z.object({ id: z.string().uuid() });
const SubmissionParam = z.object({ id: z.string().uuid() });

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
  reference: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  locale: z.string(),
  revoked: z.boolean(),
  checkedInAt: z.string().nullable(),
});

const CheckInResponse = z.object({
  outcome: z.enum(['admitted', 'already', 'revoked', 'wrong-event', 'not-found', 'bad-signature']),
  attendee: AttendeeSummary.nullable(),
  checkedInAt: z.string().nullable(),
});

const AttendanceResponse = z.object({
  registered: z.number().int(),
  checkedIn: z.number().int(),
  noShow: z.number().int(),
  revoked: z.number().int(),
  byHour: z.array(z.object({ hour: z.string(), count: z.number().int() })),
  attendees: z.array(AttendeeSummary),
});

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
        attendee: result.submission ? toAttendee(result.submission, result.checkedInAt) : null,
        checkedInAt: result.checkedInAt?.toISOString() ?? null,
      });
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
      const byId = new Map(checkIns.map((entry) => [entry.submissionId, entry.checkedInAt]));
      const attendance = attendanceOf(submissions, checkIns);

      return reply.send({
        ...attendance,
        attendees: submissions
          .filter((submission) => submission.status === 'complete')
          .map((submission) => toAttendee(submission, byId.get(submission.id) ?? null)),
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
) {
  return {
    submissionId: submission.id,
    reference: submission.reference,
    name: attendeeName(submission.data),
    email: submission.email,
    locale: submission.locale,
    revoked: submission.revokedAt !== null,
    checkedInAt: checkedInAt?.toISOString() ?? null,
  };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

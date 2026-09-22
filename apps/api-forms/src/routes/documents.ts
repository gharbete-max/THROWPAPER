import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { resolveFormAccess } from '../forms/access.js';
import { definitionsByVersion, partyOf } from '../checkin/party.js';
import type { AdmissionDeps } from '../documents/admission-service.js';
import { ADMISSION_BULK_JOB, renderAdmissionPdf } from '../documents/admission-service.js';
import type { DocumentStore } from '../documents/store.js';
import { fillPaper } from '../documents/paper.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import { forms as formSchemas } from '@tp/shared';

const IdParam = z.object({ id: z.string().uuid() });

const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
} as const;

const JobResponse = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  progressDone: z.number().int(),
  progressTotal: z.number().int(),
  error: z.string().nullable(),
  result: z.record(z.unknown()).nullable(),
});

const DownloadQuery = z.object({
  key: z.string().min(1).max(300),
  expires: z.string().min(1).max(20),
  signature: z.string().min(16).max(128),
});

export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    admission: AdmissionDeps;
    store: DocumentStore;
    uploadStore: PrivateUploadStore;
  },
): void {
  const authenticated = requireAuth(deps.guard);

  /**
   * The submission written back onto the paper its form was made from — `documents/paper.ts`.
   *
   * Access is the admission card's, for the same reason: the page carries everything the person
   * wrote. The definition is the **version they filled in**, not the draft, so an author who
   * later redraws a box does not move an answer on paper that was already returned.
   */
  app.get('/v1/submissions/:id/paper.pdf', {
    preHandler: authenticated,
    schema: { tags: ['documents'], params: IdParam, response: { ...errorResponses } },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      const submission = await findSubmission(deps.repos, auth.organisation.id, id);
      if (!submission) return notFound(reply);
      if (!(await resolveFormAccess(deps.repos, auth, submission.formId))) return notFound(reply);

      const version = (await deps.repos.forms.listVersions(submission.formId)).find(
        (candidate) => candidate.id === submission.formVersionId,
      );
      const definition = formSchemas.FormDefinition.safeParse(version?.definition);
      if (!definition.success || !definition.data.paper) {
        return reply.code(409).send({
          error: { code: 'no-paper', message: 'This form was not made from paper' },
        });
      }

      const filled = await fillPaper(
        { uploadStore: deps.uploadStore, renderer: deps.admission.renderer },
        submission,
        definition.data,
        { supported: auth.organisation.supportedLocales, default: auth.organisation.defaultLocale },
      );
      if (!filled) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'paper.filled',
        entityType: 'submission',
        entityId: submission.id,
      });

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filled.filename}"`)
        .send(filled.pdf);
    },
  });

  /** One admission PDF, streamed straight back — no job needed for a single document. */
  app.get('/v1/submissions/:id/admission.pdf', {
    preHandler: authenticated,
    schema: { tags: ['documents'], params: IdParam, response: { ...errorResponses } },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      // Submissions are listed per form, so find it via its form rather than adding a lookup that
      // only this route would use.
      const submission = await findSubmission(deps.repos, auth.organisation.id, id);
      if (!submission) return notFound(reply);

      /*
       * And then the form's rules, because a submission inherits them.
       *
       * The organisation lookup above is necessary and was not sufficient: an admission card
       * carries the attendee's name and email, so reaching one is reaching a registrant of
       * whichever form collected it. A submission id is a UUID rather than a guess, but "hard to
       * guess" is not access control — and an operator who was once shared a form has seen plenty
       * of them.
       */
      if (!(await resolveFormAccess(deps.repos, auth, submission.formId))) return notFound(reply);
      if (!submission.eventId) {
        return reply.code(409).send({
          error: {
            code: 'no-event',
            message: 'This submission is not attached to an event, so it has no admission document',
          },
        });
      }

      const rendered = await renderAdmissionPdf(deps.admission, auth.organisation.id, submission);
      if (!rendered) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'admission.generated',
        entityType: 'submission',
        entityId: submission.id,
      });

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${rendered.filename}"`)
        .send(rendered.pdf);
    },
  });

  /**
   * Bulk generation. Enqueues rather than rendering inline: 200 PDFs is minutes of Chromium, and
   * `SPEC-forms.md` §5 wants progress and a download when ready.
   */
  app.post('/v1/forms/:id/admission-documents', {
    preHandler: authenticated,
    schema: {
      tags: ['documents'],
      params: IdParam,
      response: { 202: JobResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      /*
       * The form's own access rules, not merely "same organisation".
       *
       * This route bulk-exports an admission card — name, email, reference — for every registrant
       * of a form. It checked `forms.findById`, which answers "is this in your company", while
       * every route in `forms.ts` asks `resolveFormAccess`, which answers "is this yours". So any
       * signed-in operator could export the entire registrant list of a colleague's private form
       * by knowing its id. Same helper as the listing routes now, so the export cannot outlive the
       * access that shows the form.
       */
      const found = await resolveFormAccess(deps.repos, auth, id);
      if (!found) return notFound(reply);
      const form = found.form;

      const submissions = await deps.repos.submissions.list(auth.organisation.id, id);
      const eligible = submissions.filter((s) => s.status === 'complete' && s.eventId);

      /*
       * The total is **cards**, not registrations.
       *
       * A form whose registrations bring guests produces more documents than it has rows, and the
       * job counts what it writes. Counting rows here would leave an operator watching a progress
       * figure that runs past its own total and never reports finishing.
       */
      const definitions = await definitionsByVersion(
        deps.repos,
        eligible.map((submission) => submission.formId),
      );
      const cardCount = eligible.reduce(
        (total, submission) =>
          total + partyOf(definitions.get(submission.formVersionId), submission).length,
        0,
      );

      // Keyed on the form and its published version: re-asking for the same documents returns the
      // job already running rather than starting a second Chromium marathon.
      const queued = await deps.repos.jobs.enqueue({
        organisationId: auth.organisation.id,
        kind: ADMISSION_BULK_JOB,
        idempotencyKey: `${ADMISSION_BULK_JOB}:${id}:${form.publishedVersion ?? 0}`,
        payload: { formId: id },
        progressTotal: cardCount,
      });
      /*
       * Joining a run in progress is the point of the key; joining a run that finished last week
       * is not. `enqueue` is idempotent across time too, so a finished job came back forever —
       * its link an hour from expiry, its ZIP missing everyone who registered since. A finished
       * job is started again: same row, same key, so the next click during the new run joins it.
       */
      const job =
        queued.status === 'done' || queued.status === 'failed'
          ? ((await deps.repos.jobs.restart(queued.id)) ?? queued)
          : queued;

      await recordAudit(deps.repos, request, {
        action: 'admission.bulk_requested',
        entityType: 'form',
        entityId: id,
        after: { jobId: job.id, registrations: eligible.length, cards: cardCount },
      });

      return reply.code(202).send(toJobResponse(job));
    },
  });

  app.get('/v1/jobs/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['documents'],
      params: IdParam,
      response: { 200: JobResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const job = await deps.repos.jobs.findById(auth.organisation.id, id);
      if (!job) return notFound(reply);
      /*
       * A bulk job's result is a signed link to a ZIP of every registrant's card, so reading the
       * job is reading the form. Jobs that name a form answer to that form's access rules; a job
       * without one (mail.send) carries no link and stays organisation-scoped. Audit item 13.
       */
      const formId = job.payload['formId'];
      if (typeof formId === 'string' && !(await resolveFormAccess(deps.repos, auth, formId))) {
        return notFound(reply);
      }
      return reply.send(toJobResponse(job));
    },
  });

  /**
   * Signed download. Deliberately **not** behind the bearer guard: the browser follows this link
   * directly and cannot attach an Authorization header. The signature and expiry are what protect
   * it — a bulk export of 200 registrations is personal data, and an unguessable URL is not
   * access control on its own.
   */
  app.get('/v1/documents/download', {
    schema: { tags: ['documents'], querystring: DownloadQuery, response: { ...errorResponses } },
    handler: async (request, reply) => {
      const query = DownloadQuery.parse(request.query);
      if (!deps.store.verifySignedPath(query.key, query.expires, query.signature)) {
        return reply.code(403).send({
          error: { code: 'link-expired', message: 'This download link is no longer valid' },
        });
      }

      const content = await deps.store.get(query.key);
      if (!content) return notFound(reply);

      const filename = query.key.split('/').pop() ?? 'download.zip';
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(content);
    },
  });
}

/**
 * One submission, in one query.
 *
 * This used to walk every form in the organisation and read every submission of each to find one
 * by id — ten thousand rows for a single admission document, on a form with any history. Kept as
 * a named function rather than inlined so the call sites still read the same.
 */
function findSubmission(repos: Repositories, organisationId: string, submissionId: string) {
  return repos.submissions.findById(organisationId, submissionId);
}

function toJobResponse(job: {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progressDone: number;
  progressTotal: number;
  error: string | null;
  result: Record<string, unknown> | null;
}) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progressDone: job.progressDone,
    progressTotal: job.progressTotal,
    error: job.error,
    result: job.result,
  };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

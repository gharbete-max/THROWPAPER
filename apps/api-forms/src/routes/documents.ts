import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import type { AdmissionDeps } from '../documents/admission-service.js';
import { ADMISSION_BULK_JOB, renderAdmissionPdf } from '../documents/admission-service.js';
import type { DocumentStore } from '../documents/store.js';

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
  },
): void {
  const authenticated = requireAuth(deps.guard);

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

      const form = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!form) return notFound(reply);

      const submissions = await deps.repos.submissions.list(auth.organisation.id, id);
      const eligible = submissions.filter((s) => s.status === 'complete' && s.eventId);

      // Keyed on the form and its published version: re-asking for the same documents returns the
      // job already running rather than starting a second Chromium marathon.
      const job = await deps.repos.jobs.enqueue({
        organisationId: auth.organisation.id,
        kind: ADMISSION_BULK_JOB,
        idempotencyKey: `${ADMISSION_BULK_JOB}:${id}:${form.publishedVersion ?? 0}`,
        payload: { formId: id },
        progressTotal: eligible.length,
      });

      await recordAudit(deps.repos, request, {
        action: 'admission.bulk_requested',
        entityType: 'form',
        entityId: id,
        after: { jobId: job.id, count: eligible.length },
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

async function findSubmission(repos: Repositories, organisationId: string, submissionId: string) {
  for (const form of await repos.forms.list(organisationId)) {
    const found = (await repos.submissions.list(organisationId, form.id)).find(
      (submission) => submission.id === submissionId,
    );
    if (found) return found;
  }
  return null;
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

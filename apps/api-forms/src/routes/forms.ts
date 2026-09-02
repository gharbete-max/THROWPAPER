import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, forms as formSchemas } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { FormRecord, Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { toFormResponse } from '../forms/service.js';

/** Declared once: the type provider narrows reply.code() to whatever a route lists. */
const errorResponses = {
  401: api.ErrorResponse,
  403: api.ErrorResponse,
  404: api.ErrorResponse,
  409: api.ErrorResponse,
  422: api.ErrorResponse,
} as const;

const IdParam = z.object({ id: z.string().uuid() });
const VersionParam = IdParam.extend({ version: z.coerce.number().int().positive() });

export function registerFormRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const authenticated = requireAuth(deps.guard);
  // Building forms is an Editor/Admin job (SPEC-forms.md §2); v0.1 has only admin above operator.
  const adminOnly = requireAuth(deps.guard, ['admin']);

  app.get('/v1/forms', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      response: { 200: formSchemas.FormListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const records = await deps.repos.forms.list(auth.organisation.id);
      // One query for every row's count, not one per row.
      const counts = await deps.repos.submissions.countCompleteByForm(
        auth.organisation.id,
        records.map((record) => record.id),
      );
      return reply.send({
        forms: records.map((record) =>
          toFormResponse(record, auth.organisation.supportedLocales, counts[record.id] ?? 0),
        ),
      });
    },
  });

  app.get('/v1/forms/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const record = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!record) return notFound(reply);
      return reply.send(
        toFormResponse(
          record,
          auth.organisation.supportedLocales,
          await deps.repos.submissions.countComplete(record.id),
        ),
      );
    },
  });

  /**
   * The template catalogue. Static content that ships with the product, so it is served from code
   * rather than the database — see `packages/shared/src/forms/templates.ts`.
   */
  app.get('/v1/form-templates', {
    preHandler: requireAuth(deps.guard, ['admin', 'operator']),
    schema: {
      tags: ['forms'],
      response: {
        200: z.object({ templates: z.array(formSchemas.FormTemplate) }),
        401: api.ErrorResponse,
        403: api.ErrorResponse,
      },
    },
    handler: async () => ({ templates: formSchemas.FORM_TEMPLATES }),
  });

  app.post('/v1/forms', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      body: formSchemas.CreateForm,
      response: { 201: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const body = formSchemas.CreateForm.parse(request.body);

      const clash = await deps.repos.forms.findBySlug(auth.organisation.id, body.slug);
      if (clash) {
        return reply
          .code(409)
          .send({ error: { code: 'slug-taken', message: 'That link is already in use' } });
      }

      /**
       * An unknown template id is refused rather than quietly ignored. Silently handing back an
       * empty form when somebody asked for "Customer feedback" is the kind of failure people
       * discover ten minutes into rebuilding it by hand.
       */
      let draftDefinition = formSchemas.emptyDefinition;
      if (body.templateId) {
        const template = formSchemas.findTemplate(body.templateId);
        if (!template) {
          return reply.code(422).send({
            error: { code: 'unknown-template', message: 'That template does not exist' },
          });
        }
        // Deep-copied, so editing this form can never reach the shipped catalogue.
        draftDefinition = structuredClone(template.definition);
      }

      const record = await deps.repos.forms.create({
        organisationId: auth.organisation.id,
        eventId: body.eventId ?? null,
        slug: body.slug,
        title: body.title,
        draftDefinition,
        opensAt: null,
        closesAt: null,
      });

      await recordAudit(deps.repos, request, {
        action: 'form.created',
        entityType: 'form',
        entityId: record.id,
        after: record,
      });

      // A form created a moment ago has no responses; that is arithmetic, not an assumption.
      return reply.code(201).send(toFormResponse(record, auth.organisation.supportedLocales, 0));
    },
  });

  app.patch('/v1/forms/:id', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      params: IdParam,
      body: formSchemas.UpdateForm,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = formSchemas.UpdateForm.parse(request.body);

      const before = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!before) return notFound(reply);

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.eventId !== undefined && { eventId: body.eventId }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.opensAt !== undefined && {
          opensAt: body.opensAt ? new Date(body.opensAt) : null,
        }),
        ...(body.closesAt !== undefined && {
          closesAt: body.closesAt ? new Date(body.closesAt) : null,
        }),
      });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'form.updated',
        entityType: 'form',
        entityId: id,
        before,
        after: updated,
      });

      return reply.send(
        toFormResponse(
          updated,
          auth.organisation.supportedLocales,
          await deps.repos.submissions.countComplete(updated.id),
        ),
      );
    },
  });

  /**
   * Autosave. Saving the draft never creates a version — publishing does. A definition that fails
   * to parse is rejected here rather than being stored and blowing up at render time.
   */
  app.put('/v1/forms/:id/draft', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      params: IdParam,
      body: formSchemas.SaveDraft,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = formSchemas.SaveDraft.parse(request.body);

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        draftDefinition: body.definition,
      });
      if (!updated) return notFound(reply);
      // Autosave is deliberately not audited: it fires on every keystroke burst and would bury
      // the entries that matter. Publishing is the auditable act.
      return reply.send(
        toFormResponse(
          updated,
          auth.organisation.supportedLocales,
          await deps.repos.submissions.countComplete(updated.id),
        ),
      );
    },
  });

  app.get('/v1/forms/:id/versions', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: formSchemas.FormVersionListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const form = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!form) return notFound(reply);

      const versions = await deps.repos.forms.listVersions(id);
      return reply.send({
        versions: versions.map((version) => ({
          id: version.id,
          version: version.version,
          publishedAt: version.publishedAt?.toISOString() ?? null,
          createdAt: version.createdAt.toISOString(),
        })),
      });
    },
  });

  /**
   * Publish: snapshot the draft as an immutable version.
   *
   * Blocked when the definition is structurally broken, and blocked on missing required
   * translations unless the operator explicitly overrides — SPEC-shared.md §packages/i18n. The
   * override is recorded on the version and in the audit log, so "who shipped it half-translated"
   * is answerable later.
   */
  app.post('/v1/forms/:id/publish', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      params: IdParam,
      body: formSchemas.PublishForm,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = formSchemas.PublishForm.parse(request.body);

      const form = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!form) return notFound(reply);

      const parsed = formSchemas.FormDefinition.safeParse(form.draftDefinition);
      if (!parsed.success) {
        return reply.code(422).send({
          error: { code: 'definition-invalid', message: 'The saved draft is not a valid form' },
        });
      }

      const problems = formSchemas.definitionProblems(parsed.data);
      if (problems.length > 0) {
        return reply.code(422).send({
          error: {
            code: 'definition-problems',
            message: problems.map((problem) => problem.message).join('; '),
          },
        });
      }

      const completeness = formSchemas.definitionCompleteness(
        parsed.data,
        auth.organisation.supportedLocales,
      );
      const incomplete = completeness.filter((entry) => !entry.complete);
      if (incomplete.length > 0 && !body.overrideIncompleteTranslations) {
        return reply.code(422).send({
          error: {
            code: 'translations-incomplete',
            message: `Missing translations for ${incomplete.map((entry) => entry.locale).join(', ')}`,
            fields: Object.fromEntries(incomplete.map((entry) => [entry.locale, entry.missing])),
          },
        });
      }

      const version = await deps.repos.forms.createVersion({
        formId: id,
        definition: parsed.data,
        translationOverride: incomplete.length > 0,
      });

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        publishedVersionId: version.id,
        publishedVersion: version.version,
        status: 'published',
      });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: incomplete.length > 0 ? 'form.published_with_override' : 'form.published',
        entityType: 'form',
        entityId: id,
        after: { version: version.version, missingLocales: incomplete.map((e) => e.locale) },
      });

      return reply.send(
        toFormResponse(
          updated,
          auth.organisation.supportedLocales,
          await deps.repos.submissions.countComplete(updated.id),
        ),
      );
    },
  });

  /**
   * Submissions for a form, with the published definition so the caller can label the answers.
   *
   * v0.1 returns them all: START-HERE caps the demo at ~200 rows and says to use a library rather
   * than build the grid from SPEC-shared.md. Server-side paging arrives with the real grid in A4.
   */
  app.get('/v1/forms/:id/submissions', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: formSchemas.SubmissionListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      const form = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!form) return notFound(reply);

      const versions = await deps.repos.forms.listVersions(id);
      const published = versions.find((version) => version.id === form.publishedVersionId);
      const parsed = formSchemas.FormDefinition.safeParse(
        published?.definition ?? form.draftDefinition,
      );

      const rows = await deps.repos.submissions.list(auth.organisation.id, id);
      const versionNumber = new Map(versions.map((version) => [version.id, version.version]));

      return reply.send({
        definition: parsed.success ? parsed.data : formSchemas.emptyDefinition,
        submissions: rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          status: row.status,
          locale: row.locale,
          formVersion: versionNumber.get(row.formVersionId) ?? 1,
          data: row.data,
          submittedAt: row.submittedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    },
  });

  /** Restore an old version into the draft. One click, and it does not publish by itself. */
  app.post('/v1/forms/:id/versions/:version/restore', {
    preHandler: adminOnly,
    schema: {
      tags: ['forms'],
      params: VersionParam,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id, version } = VersionParam.parse(request.params);

      const form = await deps.repos.forms.findById(auth.organisation.id, id);
      if (!form) return notFound(reply);
      const snapshot = await deps.repos.forms.findVersion(id, version);
      if (!snapshot) return notFound(reply);

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        draftDefinition: snapshot.definition,
      });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'form.version_restored',
        entityType: 'form',
        entityId: id,
        before: form.draftDefinition,
        after: { restoredVersion: version },
      });

      return reply.send(
        toFormResponse(
          updated,
          auth.organisation.supportedLocales,
          await deps.repos.submissions.countComplete(updated.id),
        ),
      );
    },
  });
}

export type { FormRecord };

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Form not found' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

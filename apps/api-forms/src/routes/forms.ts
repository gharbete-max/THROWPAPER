import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, forms as formSchemas } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type {
  FormRecord,
  OrganisationRecord,
  Repositories,
  UserRecord,
} from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { toFormResponse } from '../forms/service.js';

type Auth = { user: UserRecord; organisation: OrganisationRecord };

/**
 * A form, plus what this person may do with it.
 *
 * The one place a route learns about permission. Every handler below asks this and then asks a
 * predicate from `@tp/shared` — nothing here compares roles by hand, because six handlers doing
 * that independently is how the Edit button and the endpoint behind it come to disagree.
 *
 * `null` covers both "no such form" and "not yours", deliberately: a 403 on somebody else's
 * private form confirms it exists, which is a fact the asker did not have. Both answer 404.
 */
async function resolve(
  repos: Repositories,
  auth: Auth,
  id: string,
): Promise<{ form: FormRecord; access: formSchemas.FormAccess; shareCount: number } | null> {
  const form = await repos.forms.findById(auth.organisation.id, id);
  if (!form) return null;
  const shares = await repos.forms.listShares(auth.organisation.id, id);
  const access = formSchemas.accessFor({
    userId: auth.user.id,
    userRole: auth.user.role,
    ownerUserId: form.ownerUserId,
    shareRole: shares.find((share) => share.userId === auth.user.id)?.role ?? null,
  });
  if (!access) return null;
  return { form, access, shareCount: shares.length };
}

/**
 * The response for a single form, with the owner's name filled in.
 *
 * One user lookup rather than the list's bulk one: a single-form response is not worth reading
 * the whole directory for, and the owner is usually the person asking.
 */
async function single(
  repos: Repositories,
  auth: Auth,
  form: FormRecord,
  access: formSchemas.FormAccess,
  shareCount: number,
): Promise<formSchemas.FormResponse> {
  const owner = form.ownerUserId ? await repos.users.findById(form.ownerUserId) : null;
  return toFormResponse(form, auth.organisation.supportedLocales, await countFor(repos, form.id), {
    access,
    ownerName: owner?.name ?? null,
    shareCount,
  });
}

function countFor(repos: Repositories, formId: string): Promise<number> {
  return repos.submissions.countComplete(formId);
}

/**
 * A page of forms, fully labelled, in four queries however many rows there are.
 *
 * Response counts, share counts, the reader's own shares and the directory of names are each
 * fetched once in bulk. Done per row instead — which is the shape this naturally wants to take —
 * a list of forty forms would issue a hundred and sixty queries to draw one screen.
 */
async function listResponse(
  repos: Repositories,
  auth: Auth,
  records: readonly FormRecord[],
): Promise<formSchemas.FormResponse[]> {
  const ids = records.map((record) => record.id);
  const [counts, shareCounts, mine, people] = await Promise.all([
    repos.submissions.countCompleteByForm(auth.organisation.id, ids),
    repos.forms.shareCounts(auth.organisation.id, ids),
    repos.forms.sharesForUser(auth.organisation.id, auth.user.id),
    repos.users.list(auth.organisation.id),
  ]);

  const shareRole = new Map(mine.map((share) => [share.formId, share.role]));
  const names = new Map(people.map((person) => [person.id, person.name]));

  return records.flatMap((record) => {
    const access = formSchemas.accessFor({
      userId: auth.user.id,
      userRole: auth.user.role,
      ownerUserId: record.ownerUserId,
      shareRole: shareRole.get(record.id) ?? null,
    });
    // Belt and braces: the repository already filtered by scope, but a form the reader has no
    // access to must never survive into a response merely because a filter was written wrongly.
    if (!access) return [];
    return [
      toFormResponse(record, auth.organisation.supportedLocales, counts[record.id] ?? 0, {
        access,
        ownerName: record.ownerUserId ? (names.get(record.ownerUserId) ?? null) : null,
        shareCount: shareCounts[record.id] ?? 0,
      }),
    ];
  });
}

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

  /**
   * The forms you can see, in whichever pile you asked for.
   *
   * `scope=all` is refused to anybody but an administrator. Without that check the scope parameter
   * would be a way for any signed-in person to read every form in the organisation by typing a
   * different word in the query string — the classic shape of this bug.
   */
  app.get('/v1/forms', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      querystring: formSchemas.FormListQuery,
      response: { 200: formSchemas.FormListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { scope } = formSchemas.FormListQuery.parse(request.query);
      if (scope === 'all' && auth.user.role !== 'admin') return forbidden(reply);

      const records = await deps.repos.forms.list(auth.organisation.id, {
        scope,
        // An administrator asking for `all` asks as the organisation; every other scope is
        // still personal, including theirs — an admin's own bin is their own bin.
        ...(scope === 'all' ? {} : { userId: auth.user.id }),
      });
      return reply.send({ forms: await listResponse(deps.repos, auth, records) });
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
      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      return reply.send(await single(deps.repos, auth, found.form, found.access, found.shareCount));
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

  /**
   * Make a form. **Any signed-in person may**, which is a deliberate widening.
   *
   * This was administrator-only, a rule inherited from the single-purpose version of the product
   * where one person built the one form everybody else filled in. In a product where each person
   * has "my forms", a role that cannot make one has an empty workspace and no way to fill it.
   * Ownership, not role, is now what protects a form: you can always make your own, and what you
   * may do with somebody else's depends on what they shared with you.
   */
  app.post('/v1/forms', {
    preHandler: authenticated,
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
        // Yours, from the moment it exists. Nothing else in the product assigns ownership.
        ownerUserId: auth.user.id,
      });

      await recordAudit(deps.repos, request, {
        action: 'form.created',
        entityType: 'form',
        entityId: record.id,
        after: record,
      });

      // A form created a moment ago has no responses and no shares; that is arithmetic, not an
      // assumption — and its maker owns it, so the access is known without asking.
      return reply.code(201).send(
        toFormResponse(record, auth.organisation.supportedLocales, 0, {
          access: 'owner',
          ownerName: auth.user.name,
          shareCount: 0,
        }),
      );
    },
  });

  app.patch('/v1/forms/:id', {
    preHandler: authenticated,
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);
      const before = found.form;

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

      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
    },
  });

  /**
   * Autosave. Saving the draft never creates a version — publishing does. A definition that fails
   * to parse is rejected here rather than being stored and blowing up at render time.
   */
  app.put('/v1/forms/:id/draft', {
    preHandler: authenticated,
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        draftDefinition: body.definition,
      });
      if (!updated) return notFound(reply);
      // Autosave is deliberately not audited: it fires on every keystroke burst and would bury
      // the entries that matter. Publishing is the auditable act.
      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
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
      if (!(await resolve(deps.repos, auth, id))) return notFound(reply);

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
    preHandler: authenticated,
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);
      const form = found.form;

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

      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      const form = found.form;

      const versions = await deps.repos.forms.listVersions(id);
      const published = versions.find((version) => version.id === form.publishedVersionId);
      const parsed = formSchemas.FormDefinition.safeParse(
        published?.definition ?? form.draftDefinition,
      );

      const rows = await deps.repos.submissions.list(auth.organisation.id, id);
      const versionNumber = new Map(versions.map((version) => [version.id, version.version]));

      /**
       * Filenames for the whole page in one query, then matched back to their rows.
       *
       * Which field an upload belongs to is worked out here rather than stored: the answer already
       * says so, and a second copy of that relationship is a second thing to keep in step.
       */
      const uploads = await deps.repos.uploads.listForSubmissions(
        auth.organisation.id,
        rows.map((row) => row.id),
      );
      const uploadsBySubmission = new Map<string, typeof uploads>();
      for (const upload of uploads) {
        if (!upload.submissionId) continue;
        const list = uploadsBySubmission.get(upload.submissionId) ?? [];
        list.push(upload);
        uploadsBySubmission.set(upload.submissionId, list);
      }

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
          uploads: (uploadsBySubmission.get(row.id) ?? []).map((upload) => ({
            fieldKey:
              Object.entries(row.data).find(([, value]) => value === upload.storageKey)?.[0] ?? '',
            key: upload.storageKey,
            filename: upload.filename,
            contentType: upload.contentType,
            bytes: upload.bytes,
          })),
        })),
      });
    },
  });

  /** Restore an old version into the draft. One click, and it does not publish by itself. */
  app.post('/v1/forms/:id/versions/:version/restore', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: VersionParam,
      response: { 200: formSchemas.FormResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id, version } = VersionParam.parse(request.params);

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canEdit(found.access)) return forbidden(reply);
      const form = found.form;
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

      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
    },
  });

  /**
   * Move a form to the bin.
   *
   * A published form goes with it, link and all, which is the point — "stop this collecting
   * responses now" is the most urgent reason anybody deletes one. The public route already refuses
   * a form it cannot find, and a binned form is not found.
   *
   * Nothing is destroyed here. That takes a second, different request from inside the bin.
   */
  app.post('/v1/forms/:id/trash', {
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canDelete(found.access)) return forbidden(reply);
      // Already binned. Answering 200 with the row rather than an error keeps two clicks on a
      // slow connection from looking like a failure.
      if (found.form.deletedAt) {
        return reply.send(await single(deps.repos, auth, found.form, found.access, 0));
      }

      const updated = await deps.repos.forms.update(auth.organisation.id, id, {
        deletedAt: new Date(),
      });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'form.trashed',
        entityType: 'form',
        entityId: id,
        before: found.form,
        after: updated,
      });

      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
    },
  });

  /** Out of the bin, back where it was — including its status, which trashing never changed. */
  app.post('/v1/forms/:id/restore', {
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

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canDelete(found.access)) return forbidden(reply);

      const updated = await deps.repos.forms.update(auth.organisation.id, id, { deletedAt: null });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'form.restored',
        entityType: 'form',
        entityId: id,
        before: found.form,
        after: updated,
      });

      return reply.send(await single(deps.repos, auth, updated, found.access, found.shareCount));
    },
  });

  /**
   * Destroy it, and every response ever given to it.
   *
   * **Only from the bin.** A form that has not been trashed answers 409 rather than being
   * destroyed, so there is no single request anywhere in this API that turns a live form with a
   * thousand responses into nothing. Two steps, and the first one is reversible.
   *
   * The responses are the reason this is guarded so heavily: they are other people's answers, and
   * the person deleting the form is rarely the person who gave them.
   */
  app.delete('/v1/forms/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 204: z.null(), ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canDelete(found.access)) return forbidden(reply);
      if (!found.form.deletedAt) {
        return reply.code(409).send({
          error: { code: 'not-in-bin', message: 'Move the form to the bin before deleting it' },
        });
      }

      // Audited before the row goes, with the whole form in `before`: after this the audit entry
      // is the only record that it ever existed.
      await recordAudit(deps.repos, request, {
        action: 'form.purged',
        entityType: 'form',
        entityId: id,
        before: found.form,
      });
      await deps.repos.forms.purge(auth.organisation.id, id);
      return reply.code(204).send();
    },
  });

  app.get('/v1/forms/:id/shares', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      response: { 200: formSchemas.FormShareListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canShare(found.access)) return forbidden(reply);

      const [shares, people] = await Promise.all([
        deps.repos.forms.listShares(auth.organisation.id, id),
        deps.repos.users.list(auth.organisation.id),
      ]);
      const byId = new Map(people.map((person) => [person.id, person]));

      return reply.send({
        shares: shares.flatMap((share) => {
          const person = byId.get(share.userId);
          // A share whose user has been removed from the organisation: the cascade should have
          // taken it, so skip rather than invent a name for somebody who is not there.
          if (!person) return [];
          return [
            {
              userId: share.userId,
              name: person.name,
              email: person.email,
              role: share.role,
              createdAt: share.createdAt.toISOString(),
            },
          ];
        }),
      });
    },
  });

  /**
   * Share it with a colleague, by email.
   *
   * Only somebody already in the organisation: this endpoint does not invite, create accounts or
   * send anything. Sharing with an address that is not a colleague answers 404 for that person
   * rather than silently creating a share nobody can use.
   */
  app.put('/v1/forms/:id/shares', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam,
      body: formSchemas.CreateFormShare,
      response: { 200: formSchemas.FormShareListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = IdParam.parse(request.params);
      const body = formSchemas.CreateFormShare.parse(request.body);

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canShare(found.access)) return forbidden(reply);

      const person = await deps.repos.users.findByEmail(auth.organisation.id, body.email);
      if (!person) {
        return reply.code(404).send({
          error: { code: 'no-such-user', message: 'Nobody in this organisation has that address' },
        });
      }
      // Sharing a form with its own owner would create a row that grants less than they already
      // have, and then show them on their own share list as a guest.
      if (person.id === found.form.ownerUserId) {
        return reply
          .code(409)
          .send({ error: { code: 'already-owner', message: 'They already own this form' } });
      }

      await deps.repos.forms.share({
        organisationId: auth.organisation.id,
        formId: id,
        userId: person.id,
        role: body.role,
      });

      await recordAudit(deps.repos, request, {
        action: 'form.shared',
        entityType: 'form',
        entityId: id,
        after: { userId: person.id, role: body.role },
      });

      const shares = await deps.repos.forms.listShares(auth.organisation.id, id);
      const people = await deps.repos.users.list(auth.organisation.id);
      const byId = new Map(people.map((entry) => [entry.id, entry]));
      return reply.send({
        shares: shares.flatMap((share) => {
          const entry = byId.get(share.userId);
          if (!entry) return [];
          return [
            {
              userId: share.userId,
              name: entry.name,
              email: entry.email,
              role: share.role,
              createdAt: share.createdAt.toISOString(),
            },
          ];
        }),
      });
    },
  });

  app.delete('/v1/forms/:id/shares/:userId', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      params: IdParam.extend({ userId: z.string().uuid() }),
      response: { 204: z.null(), ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id, userId } = IdParam.extend({ userId: z.string().uuid() }).parse(request.params);

      const found = await resolve(deps.repos, auth, id);
      if (!found) return notFound(reply);
      if (!formSchemas.canShare(found.access)) return forbidden(reply);

      const removed = await deps.repos.forms.unshare(auth.organisation.id, id, userId);
      if (removed) {
        await recordAudit(deps.repos, request, {
          action: 'form.unshared',
          entityType: 'form',
          entityId: id,
          before: { userId },
        });
      }
      return reply.code(204).send();
    },
  });

  /**
   * Every recent response across the forms you can see: the cross-form inbox.
   *
   * "My submissions" in a form builder cannot mean "forms I filled in" — respondents are anonymous
   * and have no account here, so there is nobody for a submission to belong to. It means the
   * answers arriving on your forms, which is the thing a form's author actually checks daily.
   */
  app.get('/v1/submissions', {
    preHandler: authenticated,
    schema: {
      tags: ['forms'],
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      response: { 200: formSchemas.InboxResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .parse(request.query);

      // Scoped to what the reader can see, not to the organisation: the inbox must never be a
      // way round the access rules that the forms list itself enforces.
      const visible = await deps.repos.forms.list(auth.organisation.id, {
        scope: 'active',
        userId: auth.user.id,
      });
      const byId = new Map(visible.map((form) => [form.id, form]));

      const rows = await deps.repos.submissions.listForForms(
        auth.organisation.id,
        [...byId.keys()],
        limit,
      );

      return reply.send({
        submissions: rows.flatMap((row) => {
          const form = byId.get(row.formId);
          if (!form) return [];
          return [
            {
              id: row.id,
              formId: form.id,
              formTitle: form.title,
              formSlug: form.slug,
              reference: row.reference,
              status: row.status,
              locale: row.locale,
              submittedAt: row.submittedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
            },
          ];
        }),
      });
    },
  });
}

export type { FormRecord };

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Form not found' } });
}

/**
 * Signed in, but not allowed to do *this*.
 *
 * Distinct from the 404 a form you cannot see gets: by the time a request reaches a 403 the
 * person has already been told the form exists — they can read it — so the only new fact is that
 * reading is as far as it goes.
 */
function forbidden(reply: FastifyReply) {
  return reply
    .code(403)
    .send({ error: { code: 'forbidden', message: 'You cannot change this form' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

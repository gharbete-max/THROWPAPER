import { z } from 'zod';
import { resolveTokens } from './brand-kit.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { pickText } from '@tp/i18n';
import { api, forms as formSchemas } from '@tp/shared';
import type { Repositories } from '../db/repositories/index.js';
import type { MailProvider } from '../auth/mail.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import { checkAttachment } from '../uploads/attachment.js';
import { expiryFrom, generateSecret, hashSecret } from '../auth/tokens.js';
import {
  capacityFor,
  emailAnswer,
  formAvailability,
  generateReference,
} from '../forms/public-service.js';

const SlugParam = z.object({ slug: z.string().min(1).max(64) });

const RESUME_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A signature this app drew is small. Anything larger is not a signature. */
const SIGNATURE_MAX_BYTES = 512 * 1024;

/**
 * The public form surface. **No bearer token** — anyone with the link can reach these.
 *
 * That makes them the first endpoints where the caller is untrusted, so: rate limits on every
 * route, a honeypot on submit, the published definition only (never the draft), and validation
 * re-run server-side regardless of what the browser claims it checked.
 */
export function registerPublicFormRoutes(
  app: FastifyInstance,
  deps: {
    repos: Repositories;
    mail: MailProvider;
    appUrl: string;
    uploadStore: PrivateUploadStore;
    onSubmitted?: (submissionId: string) => Promise<void>;
  },
): void {
  async function loadPublished(slug: string) {
    const organisation = await deps.repos.organisations.first();
    if (!organisation) return null;

    const form = await deps.repos.forms.findBySlug(organisation.id, slug);
    if (!form) return null;

    const event = form.eventId
      ? await deps.repos.events.findById(organisation.id, form.eventId)
      : null;
    const completed = await deps.repos.submissions.countComplete(form.id);

    const versions = await deps.repos.forms.listVersions(form.id);
    const published = versions.find((version) => version.id === form.publishedVersionId) ?? null;
    const definition = published
      ? formSchemas.FormDefinition.safeParse(published.definition)
      : null;

    return {
      organisation,
      form,
      event,
      completed,
      published,
      definition: definition?.success ? definition.data : null,
      availability: formAvailability(form, event, completed),
    };
  }

  app.get('/public/forms/:slug', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      response: { 200: formSchemas.PublicFormResponse, 404: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const loaded = await loadPublished(slug);
      // An unpublished form is a 404 to the public: whether a draft exists is not their business.
      if (!loaded || !loaded.definition || !loaded.published) return notFound(reply);

      const { tokens } = await resolveTokens(deps.repos, loaded.organisation.id);

      return reply.send({
        slug: loaded.form.slug,
        definition: loaded.definition,
        formVersion: loaded.published.version,
        organisationName: loaded.organisation.name,
        brand: tokens,
        // The languages **this form** offers, not the whole organisation's. An author who
        // wrote a form in two of twelve should not show a switcher to ten untranslated ones.
        supportedLocales: formSchemas.formLocales(
          loaded.definition.settings,
          loaded.organisation.supportedLocales,
        ),
        defaultLocale: loaded.organisation.defaultLocale,
        open: loaded.availability.open,
        closedReason: loaded.availability.reason,
        closesAt: loaded.form.closesAt?.toISOString() ?? null,
      });
    },
  });

  /** Save-and-resume. Partial answers are kept without demanding the required ones. */
  app.post('/public/forms/:slug/draft', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      body: formSchemas.SaveDraftRequest,
      response: {
        200: formSchemas.SaveDraftResponse,
        404: api.ErrorResponse,
        409: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const body = formSchemas.SaveDraftRequest.parse(request.body);
      const loaded = await loadPublished(slug);
      if (!loaded || !loaded.definition || !loaded.published) return notFound(reply);

      if (!loaded.definition.settings.allowSaveAndResume) {
        return reply
          .code(409)
          .send({ error: { code: 'resume-disabled', message: 'This form cannot be saved' } });
      }

      const existing = body.resumeToken
        ? await deps.repos.submissions.findByResumeTokenHash(hashSecret(body.resumeToken))
        : null;

      // Validated as partial: nothing is required yet, but a malformed answer is still refused
      // rather than stored and rediscovered at submit time.
      const validated = formSchemas.validateSubmission(loaded.definition, body.values, {
        partial: true,
      });

      const secret = generateSecret();
      const expiresAt = expiryFrom(new Date(), RESUME_TTL_SECONDS);

      await deps.repos.submissions.saveDraft({
        ...(existing?.status === 'partial' && { id: existing.id }),
        organisationId: loaded.organisation.id,
        formId: loaded.form.id,
        formVersionId: loaded.published.id,
        eventId: loaded.form.eventId,
        reference: existing?.reference ?? generateReference(),
        locale: body.locale,
        data: validated.values as Record<string, unknown>,
        resumeTokenHash: hashSecret(secret),
        resumeExpiresAt: expiresAt,
      });

      // Sent through the transport built in phase 2 — console today, a real provider in phase 4.
      // The link is also returned so the page can show it with a copy button.
      const email = emailAnswer(loaded.definition.fields, body.values);
      if (email) {
        const link = `${deps.appUrl.replace(/\/$/, '')}/f/${slug}?resume=${secret}`;
        await deps.mail.send({
          to: email,
          subject: 'Fortsätt din anmälan / Continue your registration',
          text: link,
        });
      }

      return reply.send({ resumeToken: secret, expiresAt: expiresAt.toISOString() });
    },
  });

  app.get('/public/forms/:slug/resume/:token', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam.extend({ token: z.string().min(16).max(512) }),
      response: { 200: formSchemas.ResumeResponse, 404: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const params = SlugParam.extend({ token: z.string().min(16).max(512) }).parse(request.params);
      const loaded = await loadPublished(params.slug);
      if (!loaded || !loaded.published) return notFound(reply);

      const draft = await deps.repos.submissions.findByResumeTokenHash(hashSecret(params.token));
      if (
        !draft ||
        draft.status !== 'partial' ||
        draft.formId !== loaded.form.id ||
        (draft.resumeExpiresAt && draft.resumeExpiresAt.getTime() <= Date.now())
      ) {
        return notFound(reply);
      }

      return reply.send({
        locale: draft.locale,
        values: draft.data as Record<string, never>,
        formVersion: loaded.published.version,
      });
    },
  });

  /**
   * Attach a file, before the form is submitted.
   *
   * Unauthenticated, like everything else on this surface, which makes it the only route in the
   * product where a stranger can cause bytes to be written to disk. What keeps that safe:
   *
   * - the form must be **published and open**, and must actually contain a `file` field, so this
   *   is not a general-purpose drop box attached to every form that ever existed;
   * - the size cap is enforced while streaming, so an enormous upload is never buffered;
   * - the format is read out of the bytes, never believed from the filename or the declared type;
   * - the stored name is the hash of the content, so nothing the uploader chose reaches a path;
   * - a row is written with no submission, which is both how the answer is later checked and how
   *   an abandoned upload stays findable.
   */
  app.post('/public/forms/:slug/uploads', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      response: {
        201: formSchemas.UploadAttachmentResponse,
        400: api.ErrorResponse,
        404: api.ErrorResponse,
        409: api.ErrorResponse,
        413: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const loaded = await loadPublished(slug);
      if (!loaded || !loaded.definition || !loaded.published) return notFound(reply);

      if (!loaded.availability.open) {
        return reply
          .code(409)
          .send({ error: { code: 'closed', message: 'This form is not accepting answers' } });
      }

      // Which question this is for, so its own `accept` and `maxBytes` apply. A form with no
      // file field accepts no files at all, whatever is posted.
      const key =
        typeof request.query === 'object' && request.query
          ? String((request.query as Record<string, unknown>)['field'] ?? '')
          : '';
      const field = loaded.definition.fields.find(
        (candidate) =>
          (candidate.type === 'file' || candidate.type === 'signature') && candidate.key === key,
      );
      if (!field || (field.type !== 'file' && field.type !== 'signature')) {
        return reply.code(400).send({
          error: { code: 'no-such-field', message: 'That question does not take a file' },
        });
      }

      /**
       * A signature is a small PNG this app drew, not a file somebody chose.
       *
       * So it accepts images only and gets a much tighter cap: half a megabyte is a generous
       * signature and a poor place to hide something else. Sharing the route rather than adding a
       * second one is deliberate — every check on this surface then applies to both without
       * anybody having to remember to copy it across.
       */
      const limits =
        field.type === 'signature'
          ? { accept: 'image' as const, maxBytes: SIGNATURE_MAX_BYTES }
          : { accept: field.accept, maxBytes: field.maxBytes };

      const file = await request.file({ limits: { fileSize: limits.maxBytes } });
      if (!file) {
        return reply
          .code(400)
          .send({ error: { code: 'no-file', message: 'Send one file as multipart form data' } });
      }

      const content = await file.toBuffer();
      /**
       * The stream cap and this check are not redundant. The cap stops a very large upload being
       * buffered at all; `truncated` says it *was* cut off, so a file that hit the limit is
       * refused rather than stored as a corrupt fragment.
       */
      if (file.file.truncated) {
        return reply
          .code(413)
          .send({ error: { code: 'too-large', message: 'That file is too large' } });
      }

      const checked = checkAttachment(content, limits.accept, limits.maxBytes);
      if (!checked.ok) {
        return reply
          .code(checked.code === 'too-large' ? 413 : 400)
          .send({ error: { code: checked.code, message: uploadRejection(checked.code) } });
      }

      const stored = await deps.uploadStore.put(content, checked.extension);
      const record = await deps.repos.uploads.create({
        organisationId: loaded.organisation.id,
        formId: loaded.form.id,
        storageKey: stored.key,
        // Kept for display only, and capped: a filename is a string somebody typed.
        filename: (file.filename || 'attachment').slice(0, 200),
        contentType: checked.contentType,
        bytes: stored.bytes,
      });

      return reply.code(201).send({
        key: record.storageKey,
        filename: record.filename,
        contentType: record.contentType,
        bytes: record.bytes,
      });
    },
  });

  app.post('/public/forms/:slug', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      body: formSchemas.SubmitRequest,
      response: {
        201: formSchemas.SubmitResponse,
        409: formSchemas.SubmitRejected,
        422: formSchemas.SubmitRejected,
        404: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const body = formSchemas.SubmitRequest.parse(request.body);
      const loaded = await loadPublished(slug);
      if (!loaded || !loaded.definition || !loaded.published) return notFound(reply);

      // Honeypot: a real person never sees this field. Answer as though it worked — telling a bot
      // it was detected only teaches whoever wrote it to try something else.
      if (body.website && body.website.trim() !== '') {
        return reply.code(201).send({
          status: 'received' as const,
          reference: generateReference(),
          confirmationMessage: '',
        });
      }

      if (!loaded.availability.open) {
        return reply.code(409).send({
          status: 'rejected' as const,
          reason: loaded.availability.reason === 'full' ? ('full' as const) : ('closed' as const),
          issues: [],
        });
      }

      // Re-validated here regardless of what the browser checked. The client copy of this call is
      // for feedback; this one decides.
      const validated = formSchemas.validateSubmission(loaded.definition, body.values);
      if (!validated.ok) {
        return reply.code(422).send({
          status: 'rejected' as const,
          reason: 'invalid' as const,
          issues: validated.issues,
        });
      }

      /**
       * Every attached file must be one *this form* received and nothing has claimed.
       *
       * A storage key is the SHA-256 of the content, so anybody holding the same file can work
       * one out — "the answer names a real upload" is therefore not a check at all. What makes it
       * one is that the upload arrived through this form and no submission has taken it, which is
       * exactly what the unclaimed row records.
       */
      const attachedKeys = attachedUploadKeys(loaded.definition, validated.values);
      const claimable = attachedKeys.length
        ? await deps.repos.uploads.findUnclaimed(loaded.form.id, attachedKeys)
        : [];

      if (claimable.length !== attachedKeys.length) {
        const known = new Set(claimable.map((upload) => upload.storageKey));
        return reply.code(422).send({
          status: 'rejected' as const,
          reason: 'invalid' as const,
          issues: fileKeysFor(loaded.definition, validated.values)
            .filter(([, value]) => !known.has(value))
            .map(([key]) => ({ key, code: 'validation.file' })),
        });
      }

      const draft = body.resumeToken
        ? await deps.repos.submissions.findByResumeTokenHash(hashSecret(body.resumeToken))
        : null;

      const result = await deps.repos.submissions.complete({
        ...(draft?.status === 'partial' && { id: draft.id }),
        organisationId: loaded.organisation.id,
        formId: loaded.form.id,
        formVersionId: loaded.published.id,
        eventId: loaded.form.eventId,
        reference: draft?.reference ?? generateReference(),
        locale: body.locale,
        email: emailAnswer(loaded.definition.fields, validated.values),
        data: validated.values as Record<string, unknown>,
        capacity: capacityFor(loaded.event),
        duplicateControl: loaded.definition.settings.duplicateControl,
      });

      if (!result.ok) {
        return reply
          .code(409)
          .send({ status: 'rejected' as const, reason: result.reason, issues: [] });
      }

      // Claimed only once the submission exists, so a rejected attempt leaves the files sweepable
      // rather than tied to a row that was never created.
      if (claimable.length > 0) {
        await deps.repos.uploads.claim(
          claimable.map((upload) => upload.id),
          result.submission.id,
        );
      }

      const confirmation = pickText(
        {
          supported: loaded.organisation.supportedLocales,
          default: loaded.organisation.defaultLocale,
        },
        loaded.definition.settings.confirmationMessage,
        body.locale,
      );

      // Enqueued, never sent inline — SPEC-mailer.md §8. A registration must not fail because a
      // provider was slow.
      await deps.onSubmitted?.(result.submission.id);

      return reply.code(201).send({
        status: 'received' as const,
        reference: result.submission.reference,
        confirmationMessage: confirmation.value,
      });
    },
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Form not found' } });
}

/** The `file` answers in a submission, as [fieldKey, storageKey] pairs. */
function fileKeysFor(
  definition: formSchemas.FormDefinition,
  values: formSchemas.SubmissionValues,
): Array<[string, string]> {
  return definition.fields
    .filter((field) => field.type === 'file' || field.type === 'signature')
    .map((field) => [field.key, values[field.key]] as const)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => [key, value]);
}

/** Just the storage keys, for the unclaimed lookup. */
function attachedUploadKeys(
  definition: formSchemas.FormDefinition,
  values: formSchemas.SubmissionValues,
): string[] {
  return fileKeysFor(definition, values).map(([, storageKey]) => storageKey);
}

/** Why an attachment was refused. Rendered by the app from the code; this is for API clients. */
function uploadRejection(code: string): string {
  switch (code) {
    case 'empty':
      return 'The file is empty';
    case 'too-large':
      return 'That file is too large';
    case 'svg-not-supported':
      return 'SVG files are not accepted. Send a PNG or a JPEG.';
    case 'not-accepted-here':
      return 'That question does not take this kind of file';
    default:
      return 'That file type is not accepted';
  }
}

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
import { UPLOAD_CLAIM_WINDOW_SECONDS } from '../uploads/lifecycle.js';
import type { PdfRenderer } from '../documents/render.js';
import { buildFinishedDocument } from '../documents/finished-service.js';
import { signFinishedToken, verifyFinishedToken } from '../documents/finished-token.js';
import { contentDisposition, documentFilename } from '../documents/filename.js';
import { DraftUnavailable, type MailDrafter } from '../mail/draft.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IdentityMethod } from '@tp/shared/contract';
import type { SignClient } from '../signing/client.js';
import type { SubmissionIdentity } from '../db/schema.js';

const SlugParam = z.object({ slug: z.string().min(1).max(64) });

/** One window for drafts and for unclaimed uploads — see `uploads/lifecycle.ts` for why. */
const RESUME_TTL_SECONDS = UPLOAD_CLAIM_WINDOW_SECONDS;

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
    /**
     * The finished document (`documents/finished.ts`). Absent in tests that do not render PDFs;
     * then the submit response offers no document rather than a link that cannot work.
     */
    finished?: { renderer: PdfRenderer; key: Buffer };
    /**
     * The desktop edition's mail program, for "Email document" as a draft with the PDF attached
     * (`mail/draft.ts`). Absent on a server: a server has no mail program of the visitor's to open.
     */
    mailDraft?: MailDrafter | null;
    /**
     * Sign, for the optional e-ID step (CONTRACT §5.6). Null where no Sign is connected: a form
     * that offers the step then says it is not available, and is finished without it.
     */
    sign?: SignClient | null;
  },
): void {
  /**
   * What §5.6 offers, asked at most once a minute. Sign answering nothing, or not answering at
   * all, both mean the same thing to a person finishing a form: the step is not available.
   */
  let methodsCache: { at: number; methods: IdentityMethod[] } | null = null;
  async function identityMethods(): Promise<IdentityMethod[]> {
    if (!deps.sign) return [];
    if (methodsCache && Date.now() - methodsCache.at < 60_000) return methodsCache.methods;
    let methods: IdentityMethod[] = [];
    try {
      methods = (await deps.sign.identityMethods()).methods;
    } catch {
      methods = [];
    }
    methodsCache = { at: Date.now(), methods };
    return methods;
  }

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

      // The languages **this form** offers, not the whole organisation's. An author who
      // wrote a form in two of twelve should not show a switcher to ten untranslated ones.
      const offered = formSchemas.formLocales(
        loaded.definition.settings,
        loaded.organisation.supportedLocales,
      );

      /*
       * The default has to be one of the languages actually offered.
       *
       * `resolveChain` only ever returns locales from `supported`, so a default outside that list
       * terminates nothing: a visitor whose browser language matches none of the offered ones
       * gets an empty chain, and `resolveLocale` hands back the organisation's default — a
       * language this form does not publish and the switcher does not list. The page then renders
       * with a current locale that has no option beside it and no ticked row.
       */
      const defaultLocale = offered.includes(loaded.organisation.defaultLocale)
        ? loaded.organisation.defaultLocale
        : (offered[0] ?? loaded.organisation.defaultLocale);

      return reply.send({
        slug: loaded.form.slug,
        title: loaded.form.title,
        definition: loaded.definition,
        formVersion: loaded.published.version,
        organisationName: loaded.organisation.name,
        brand: tokens,
        supportedLocales: offered,
        defaultLocale,
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

      /*
       * The two guards the submit route has, which this one shipped without.
       *
       * Saving a draft sends mail — from the customer's verified sending domain, to whatever
       * address the answers contain, with no account and no review. That is the more attractive
       * half of the pair for anyone abusing it, because a draft leaves no row an operator reads.
       * It was missing both the honeypot and the "is this form still open" check.
       *
       * A bot is answered 200 with a token that resumes nothing, exactly as the submit route
       * pretends to accept: telling a script it was detected is telling it what to change.
       */
      if (body.website && body.website.trim() !== '') {
        return reply.send({
          resumeToken: generateSecret(),
          expiresAt: expiryFrom(new Date(), RESUME_TTL_SECONDS).toISOString(),
        });
      }

      if (!loaded.availability.open) {
        return reply.code(409).send({
          error: { code: 'closed', message: 'This form is no longer accepting answers' },
        });
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

      /**
       * The strokes a signature carries inside its PNG (`signature-vector.ts`) are read back into
       * sealed documents as SVG, so they are held to the pad's grammar here, at the door, rather
       * than trusted later. A PNG with no strokes is still a signature — a typed one before this
       * existed, or a client that never sent them.
       */
      if (field.type === 'signature' && checked.extension === 'png') {
        const vector = formSchemas.readSignatureVector(content);
        if (!vector.ok) {
          return reply
            .code(400)
            .send({ error: { code: 'bad-signature', message: uploadRejection('bad-signature') } });
        }
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
          confirmationTo: null,
          admissionCard: false,
          document: null,
          identity: null,
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
        ? await deps.repos.uploads.findUnclaimed(
            loaded.form.id,
            attachedKeys,
            new Date(Date.now() - UPLOAD_CLAIM_WINDOW_SECONDS * 1000),
          )
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

      const email = emailAnswer(loaded.definition.fields, validated.values);
      const result = await deps.repos.submissions.complete({
        ...(draft?.status === 'partial' && { id: draft.id }),
        organisationId: loaded.organisation.id,
        formId: loaded.form.id,
        formVersionId: loaded.published.id,
        eventId: loaded.form.eventId,
        reference: draft?.reference ?? generateReference(),
        locale: body.locale,
        email,
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
        // The mail job sends to this address and attaches the card when there is an event
        // (`mail/send-job.ts`); the screen may say so because this is where it was decided.
        confirmationTo: email,
        admissionCard: loaded.event !== null,
        document: deps.finished
          ? {
              token: signFinishedToken(result.submission.id, deps.finished.key),
              filename: documentFilename(
                pickText(
                  {
                    supported: loaded.organisation.supportedLocales,
                    default: loaded.organisation.defaultLocale,
                  },
                  loaded.form.title,
                  body.locale,
                ).value,
                result.submission.reference,
              ),
              draftProgram: deps.mailDraft?.label ?? null,
            }
          : null,
        identity:
          loaded.definition.settings.identity === 'optional'
            ? identityOffer(await identityMethods())
            : null,
      });
    },
  });

  /**
   * The finished document, for the person who just sent the form.
   *
   * **POST with the token in the body**, not a GET with it in the URL: a URL is kept in browser
   * history, in proxy and server logs, and in the Referer of whatever the PDF viewer opens next —
   * every one of them a place a credential for somebody's answers should not be.
   *
   * The token names the submission; the slug must agree with it, so a token cannot be replayed
   * through another form's address. Every refusal is the same 404 — expired, forged, withdrawn and
   * never-existed are nobody's business to tell apart. Rate limited like the invoice PDF: each one
   * is about a second of Chromium.
   */
  /** The document a valid token names, through this form's address only. Null for any refusal. */
  /** The submission a valid token names, through this form's address only. Null for any refusal. */
  async function holderOf(slug: string, token: string) {
    if (!deps.finished) return null;
    const verified = verifyFinishedToken(token, deps.finished.key);
    if (!verified.ok) return null;

    const organisation = await deps.repos.organisations.first();
    if (!organisation) return null;
    const form = await deps.repos.forms.findBySlug(organisation.id, slug);
    const submission = await deps.repos.submissions.findById(
      organisation.id,
      verified.submissionId,
    );
    if (!form || !submission || submission.formId !== form.id) return null;
    if (submission.status !== 'complete' || submission.revokedAt) return null;
    return { organisation, form, submission };
  }

  async function finishedFor(slug: string, token: string) {
    const held = await holderOf(slug, token);
    if (!held || !deps.finished) return null;
    return buildFinishedDocument(
      { repos: deps.repos, renderer: deps.finished.renderer, uploadStore: deps.uploadStore },
      held.organisation,
      held.submission,
    );
  }

  app.post('/public/forms/:slug/document', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      body: formSchemas.FinishedDocumentRequest,
      response: { 404: api.ErrorResponse, 503: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const { token } = formSchemas.FinishedDocumentRequest.parse(request.body);
      if (!deps.finished) {
        return reply.code(503).send({
          error: { code: 'documents-unavailable', message: 'Documents are not available here' },
        });
      }

      const finished = await finishedFor(slug, token);
      if (!finished) return notFound(reply);

      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', contentDisposition(finished.filename))
        .header('cache-control', 'no-store, private')
        .header('x-robots-tag', 'noindex, nofollow')
        .send(finished.pdf);
    },
  });

  /**
   * "Email document" on the desktop: a draft in this computer's mail program, PDF attached.
   *
   * Registered only where there is such a program (`deps.mailDraft`), so a server answers 404 and
   * the page never offers it. It opens a window on this computer and sends nothing — the person
   * addresses and sends it themselves. Same token, same refusals, as the download.
   */
  if (deps.mailDraft) {
    const drafter = deps.mailDraft;
    app.post('/public/forms/:slug/document/email-draft', {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['public'],
        params: SlugParam,
        body: formSchemas.EmailDraftRequest,
        response: { 204: z.null(), 404: api.ErrorResponse, 503: api.ErrorResponse },
      },
      handler: async (request, reply) => {
        const { slug } = SlugParam.parse(request.params);
        const body = formSchemas.EmailDraftRequest.parse(request.body);
        const finished = await finishedFor(slug, body.token);
        if (!finished) return notFound(reply);

        try {
          await drafter.open({
            subject: body.subject,
            text: body.text,
            attachment: { filename: finished.filename, content: finished.pdf },
          });
        } catch (error) {
          request.log.warn({ err: error }, 'email draft failed');
          return reply.code(503).send({
            error: {
              code: error instanceof DraftUnavailable ? 'mail-program-unavailable' : 'draft-failed',
              message: `${drafter.label} could not open a draft`,
            },
          });
        }
        return reply.code(204).send();
      },
    });
  }

  /**
   * The optional e-ID step, started (CONTRACT §5.6).
   *
   * The same token as the document — this is the person who just sent the form. What they confirm
   * is the finished document as it stands now: its SHA-256 goes to the provider. The reference that
   * comes back is bound to this submission with an HMAC, so a reference from somebody else's
   * confirmation can never be recorded against this one.
   */
  app.post('/public/forms/:slug/identity', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      body: formSchemas.StartIdentityCheck,
      response: {
        200: formSchemas.IdentityCheckStarted,
        404: api.ErrorResponse,
        409: api.ErrorResponse,
        503: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const { token } = formSchemas.StartIdentityCheck.parse(request.body);
      const held = await holderOf(slug, token);
      if (!held || !deps.finished) return notFound(reply);
      const definition = await definitionOf(held.submission);
      if (definition?.settings.identity !== 'optional') return notFound(reply);
      if (held.submission.identity) {
        return reply.code(409).send({
          error: { code: 'already-confirmed', message: 'This form is already confirmed' },
        });
      }
      const method = (await identityMethods())[0];
      if (!deps.sign || !method) {
        return reply.code(503).send({
          error: { code: 'identity-unavailable', message: 'No e-ID is available here' },
        });
      }
      const finished = await buildFinishedDocument(
        { repos: deps.repos, renderer: deps.finished.renderer, uploadStore: deps.uploadStore },
        held.organisation,
        held.submission,
      );
      if (!finished) return notFound(reply);
      try {
        const started = await deps.sign.startIdentity({
          organisationId: held.organisation.id,
          method: method.method,
          documentSha256: createHash('sha256').update(finished.pdf).digest('hex'),
          locale: held.submission.locale,
          idempotencyKey: `finished:${held.submission.id}:${Date.now()}`,
        });
        return reply.send({
          reference: bindReference(started.reference, held.submission.id, deps.finished.key),
          status: started.status,
          ...(started.launchUrl ? { launchUrl: started.launchUrl } : {}),
        });
      } catch (error) {
        request.log.warn({ err: error }, 'identity start failed');
        return reply.code(503).send({
          error: { code: 'identity-unavailable', message: 'The e-ID service did not answer' },
        });
      }
    },
  });

  /** Where the e-ID step stands; recorded on the submission once the provider has answered. */
  app.post('/public/forms/:slug/identity/check', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['public'],
      params: SlugParam,
      body: formSchemas.IdentityCheckRequest,
      response: {
        200: formSchemas.IdentityCheckResponse,
        404: api.ErrorResponse,
        503: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const { slug } = SlugParam.parse(request.params);
      const body = formSchemas.IdentityCheckRequest.parse(request.body);
      const held = await holderOf(slug, body.token);
      if (!held || !deps.finished || !deps.sign) return notFound(reply);
      const reference = unbindReference(body.reference, held.submission.id, deps.finished.key);
      if (!reference) return notFound(reply);

      if (held.submission.identity) {
        return reply.send({
          status: 'complete' as const,
          confirmed: confirmedView(held.submission.identity),
        });
      }

      let result;
      try {
        result = await deps.sign.identityResult(reference);
      } catch (error) {
        request.log.warn({ err: error }, 'identity result failed');
        return reply.code(503).send({
          error: { code: 'identity-unavailable', message: 'The e-ID service did not answer' },
        });
      }
      if (result.status !== 'complete' || !result.method) {
        return reply.send({ status: result.status, confirmed: null });
      }
      const provider =
        (await identityMethods()).find((m) => m.method === result.method)?.provider ?? 'unknown';
      const identity: SubmissionIdentity = {
        method: result.method,
        provider,
        name: result.name ?? null,
        test: result.environment === 'test',
        documentSha256: result.documentSha256,
        confirmedAt: new Date().toISOString(),
      };
      await deps.repos.submissions.saveIdentity(held.organisation.id, held.submission.id, identity);
      return reply.send({ status: 'complete' as const, confirmed: confirmedView(identity) });
    },
  });

  async function definitionOf(submission: { formId: string; formVersionId: string }) {
    const version = (await deps.repos.forms.listVersions(submission.formId)).find(
      (candidate) => candidate.id === submission.formVersionId,
    );
    const parsed = formSchemas.FormDefinition.safeParse(version?.definition);
    return parsed.success ? parsed.data : null;
  }
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
    case 'bad-signature':
      return 'The signature could not be read. Clear it and sign again.';
    default:
      return 'That file type is not accepted';
  }
}

/** What the page learns about a recorded confirmation: enough to say it, nothing more. */
function confirmedView(identity: SubmissionIdentity) {
  return { method: identity.method, name: identity.name, test: identity.test };
}

/** Whether the step is offered as working, from what §5.6 listed. */
function identityOffer(methods: IdentityMethod[]) {
  return {
    available: methods.length > 0,
    test: methods.length > 0 && methods.every((method) => method.environment === 'test'),
  };
}

/** `<sign reference>.<HMAC over submission and reference>`: usable only with this submission. */
function bindReference(reference: string, submissionId: string, key: Buffer): string {
  return `${reference}.${referenceMac(reference, submissionId, key)}`;
}

function unbindReference(bound: string, submissionId: string, key: Buffer): string | null {
  const at = bound.lastIndexOf('.');
  if (at <= 0) return null;
  const reference = bound.slice(0, at);
  const given = Buffer.from(bound.slice(at + 1));
  const expected = Buffer.from(referenceMac(reference, submissionId, key));
  return given.length === expected.length && timingSafeEqual(given, expected) ? reference : null;
}

function referenceMac(reference: string, submissionId: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`identity\n${submissionId}\n${reference}`)
    .digest('base64url');
}

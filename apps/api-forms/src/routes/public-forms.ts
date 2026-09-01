import { z } from 'zod';
import { resolveTokens } from './brand-kit.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { pickText } from '@tp/i18n';
import { api, forms as formSchemas } from '@tp/shared';
import type { Repositories } from '../db/repositories/index.js';
import type { MailProvider } from '../auth/mail.js';
import { expiryFrom, generateSecret, hashSecret } from '../auth/tokens.js';
import {
  capacityFor,
  emailAnswer,
  formAvailability,
  generateReference,
} from '../forms/public-service.js';

const SlugParam = z.object({ slug: z.string().min(1).max(64) });

const RESUME_TTL_SECONDS = 30 * 24 * 60 * 60;

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
        supportedLocales: loaded.organisation.supportedLocales,
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

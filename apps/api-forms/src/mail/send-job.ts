import { pickText, type LocaleConfig } from '@tp/i18n';
import type { Repositories, SubmissionRecord } from '../db/repositories/index.js';
import { resolveTokens } from '../routes/brand-kit.js';
import type { JobHandler } from '../jobs/worker.js';
import type { AdmissionDeps } from '../documents/admission-service.js';
import { renderAdmissionPdf } from '../documents/admission-service.js';
import { attendeeName } from '../documents/admission.js';
import { admissionStrings } from '../documents/admission.js';
import type { MailProvider } from './provider.js';
import { assertSendable, domainOf } from './domain-verification.js';
import { renderConfirmation, renderNotification } from '../email/templates.js';

export const MAIL_SEND_JOB = 'mail.send';

export type MailTemplateKey = 'registration.confirmation' | 'registration.notification';

export interface MailDeps {
  repos: Repositories;
  provider: MailProvider;
  admission: AdmissionDeps;
  appUrl: string;
  /** Address the operator notification goes to. Usually the admin who owns the event. */
  operatorAddress: string | null;
}

/** Copy for the two transactional emails. Document text, so it lives beside the document copy. */
const COPY = {
  'sv-SE': {
    confirmationHeading: 'Din anmälan är bekräftad',
    confirmationIntro: 'Tack för din anmälan. Här är dina uppgifter.',
    attachmentNote: 'Ditt inträdeskort är bifogat som PDF. Ta med det till entrén.',
    referenceLabel: 'Referens',
    webVersion: 'Visa i webbläsare',
    notificationHeading: 'Ny anmälan',
    notificationIntro: 'Någon har anmält sig till evenemanget.',
    openSubmissions: 'Visa anmälningar',
    footer: 'Det här är ett automatiskt meddelande.',
  },
  'en-GB': {
    confirmationHeading: 'Your registration is confirmed',
    confirmationIntro: 'Thank you for registering. Here are your details.',
    attachmentNote: 'Your admission card is attached as a PDF. Bring it to the entrance.',
    referenceLabel: 'Reference',
    webVersion: 'View in browser',
    notificationHeading: 'New registration',
    notificationIntro: 'Someone has registered for the event.',
    openSubmissions: 'View registrations',
    footer: 'This is an automated message.',
  },
} as const;

function copyFor(locale: string) {
  return COPY[locale as keyof typeof COPY] ?? COPY['sv-SE'];
}

/**
 * Sending runs as a job, never from a request handler — `SPEC-mailer.md` §8. A registration must
 * not fail because a provider was slow, and a retry must not re-register anybody.
 */
export function createMailSendHandler(deps: MailDeps): JobHandler {
  return async ({ job }) => {
    const templateKey = String(job.payload['templateKey'] ?? '') as MailTemplateKey;
    const submissionId = String(job.payload['submissionId'] ?? '');

    const organisation = await deps.repos.organisations.findById(job.organisationId);
    if (!organisation) throw new Error('organisation missing');

    const submission = await findSubmission(deps.repos, job.organisationId, submissionId);
    if (!submission) throw new Error(`submission ${submissionId} not found`);

    const event = submission.eventId
      ? await deps.repos.events.findById(job.organisationId, submission.eventId)
      : null;

    const sendingDomain = (await deps.repos.sendingDomains.list(job.organisationId))[0] ?? null;
    const from = sendingDomain?.fromAddress ?? '';

    // The rule with no override. A console provider is development only and is exempt, because
    // there is no domain to burn.
    if (deps.provider.name !== 'console' && deps.provider.name !== 'memory') {
      const verification = sendingDomain
        ? {
            domain: sendingDomain.domain,
            verified: sendingDomain.verified,
            checks: [],
            checkedAt: sendingDomain.lastCheckedAt?.toISOString() ?? '',
          }
        : null;
      assertSendable(verification, sendingDomain?.domain ?? (domainOf(from) || 'unknown'));
    }

    const locales: LocaleConfig = {
      supported: organisation.supportedLocales,
      default: organisation.defaultLocale,
    };

    if (templateKey === 'registration.confirmation') {
      const to = submission.email;
      if (!to) throw new Error('submission has no email address to confirm to');

      const locale = submission.locale;
      const copy = copyFor(locale);
      const strings = admissionStrings(locale);
      const eventName = event ? pickText(locales, event.name, locale).value : organisation.name;

      // Rendered here rather than attached from storage: the document is small, and generating it
      // at send time means the attachment can never be stale relative to the record.
      const rendered = event
        ? await renderAdmissionPdf(deps.admission, job.organisationId, submission)
        : null;

      const { tokens } = await resolveTokens(deps.repos, job.organisationId);

      const html = await renderConfirmation(tokens, {
        heading: copy.confirmationHeading,
        intro: copy.confirmationIntro,
        eventName,
        when: event ? formatRange(locale, event.startsAt, event.endsAt) : '',
        where: [event?.venueName, event?.venueAddress].filter(Boolean).join(', '),
        referenceLabel: strings.reference,
        reference: submission.reference,
        attachmentNote: rendered ? copy.attachmentNote : '',
        footer: `${organisation.name} · ${copy.footer}`,
        webVersionLabel: copy.webVersion,
        webVersionUrl: `${deps.appUrl.replace(/\/$/, '')}/r/${submission.reference}`,
      });

      const sent = await deps.provider.send({
        to,
        from: from || undefined,
        subject: `${copy.confirmationHeading} — ${eventName}`,
        text: `${copy.confirmationIntro}\n\n${eventName}\n${strings.reference}: ${submission.reference}`,
        html,
        idempotencyKey: job.idempotencyKey,
        attachments: rendered
          ? [{ filename: rendered.filename, contentType: 'application/pdf', content: rendered.pdf }]
          : undefined,
      });

      await deps.repos.messages.record({
        organisationId: job.organisationId,
        submissionId: submission.id,
        templateKey,
        to,
        locale,
        subject: `${copy.confirmationHeading} — ${eventName}`,
        providerMessageId: sent.messageId,
        provider: deps.provider.name,
        sentAt: new Date(),
      });

      return { messageId: sent.messageId, attached: Boolean(rendered) };
    }

    // Operator notification, in the organisation's language rather than the attendee's.
    const to = deps.operatorAddress;
    if (!to) return { skipped: 'no operator address configured' };

    const locale = organisation.defaultLocale;
    const copy = copyFor(locale);
    const eventName = event ? pickText(locales, event.name, locale).value : organisation.name;

    const { tokens: operatorTokens } = await resolveTokens(deps.repos, job.organisationId);

    const html = await renderNotification(operatorTokens, {
      heading: copy.notificationHeading,
      intro: copy.notificationIntro,
      rows: [
        { label: 'Namn', value: attendeeName(submission.data) || '—' },
        { label: 'E-post', value: submission.email ?? '—' },
        { label: copyFor(locale).referenceLabel, value: submission.reference },
        { label: 'Evenemang', value: eventName },
      ],
      linkLabel: copy.openSubmissions,
      linkUrl: `${deps.appUrl.replace(/\/$/, '')}/forms/${submission.formId}`,
      footer: `${organisation.name} · ${copy.footer}`,
    });

    const sent = await deps.provider.send({
      to,
      from: from || undefined,
      subject: `${copy.notificationHeading}: ${eventName}`,
      text: `${copy.notificationIntro}\n${attendeeName(submission.data)} — ${submission.reference}`,
      html,
      idempotencyKey: job.idempotencyKey,
    });

    await deps.repos.messages.record({
      organisationId: job.organisationId,
      submissionId: submission.id,
      templateKey,
      to,
      locale,
      subject: `${copy.notificationHeading}: ${eventName}`,
      providerMessageId: sent.messageId,
      provider: deps.provider.name,
      sentAt: new Date(),
    });

    return { messageId: sent.messageId };
  };
}

async function findSubmission(
  repos: Repositories,
  organisationId: string,
  submissionId: string,
): Promise<SubmissionRecord | null> {
  for (const form of await repos.forms.list(organisationId)) {
    const found = (await repos.submissions.list(organisationId, form.id)).find(
      (submission) => submission.id === submissionId,
    );
    if (found) return found;
  }
  return null;
}

function formatRange(locale: string, start: Date, end: Date): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(start);
  const from = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(start);
  const to = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(end);
  return `${date}, ${from}–${to}`;
}

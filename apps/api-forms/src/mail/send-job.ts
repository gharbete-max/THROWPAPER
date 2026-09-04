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

/**
 * Copy for the two transactional emails. Document text, so it lives beside the document copy.
 *
 * ## Every language, not two
 *
 * This table held `sv-SE` and `en-GB`, and `copyFor` fell back to Swedish for everything else — so
 * a French respondent who filled in a French form got a Swedish confirmation, and the operator
 * notification mixed hard-coded Swedish row labels into whatever language the rest of it was in.
 * The product ships in twelve languages; an email is the only part of it that arrives when nobody
 * is looking, which makes it the worst place to be guessing.
 *
 * `send-job.test.ts` holds this table against the locale registry, so a thirteenth language fails
 * the build rather than silently sending Swedish to somebody who did not ask for it.
 */
const COPY = {
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
    nameLabel: 'Name',
    emailLabel: 'Email',
    eventLabel: 'Event',
  },
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
    nameLabel: 'Namn',
    emailLabel: 'E-post',
    eventLabel: 'Evenemang',
  },
  'da-DK': {
    confirmationHeading: 'Din tilmelding er bekræftet',
    confirmationIntro: 'Tak for din tilmelding. Her er dine oplysninger.',
    attachmentNote: 'Dit adgangskort er vedhæftet som PDF. Tag det med til indgangen.',
    referenceLabel: 'Reference',
    webVersion: 'Vis i browser',
    notificationHeading: 'Ny tilmelding',
    notificationIntro: 'Nogen har tilmeldt sig arrangementet.',
    openSubmissions: 'Vis tilmeldinger',
    footer: 'Dette er en automatisk besked.',
    nameLabel: 'Navn',
    emailLabel: 'E-mail',
    eventLabel: 'Arrangement',
  },
  'nb-NO': {
    confirmationHeading: 'Påmeldingen din er bekreftet',
    confirmationIntro: 'Takk for påmeldingen. Her er opplysningene dine.',
    attachmentNote: 'Adgangskortet ditt er vedlagt som PDF. Ta det med til inngangen.',
    referenceLabel: 'Referanse',
    webVersion: 'Vis i nettleser',
    notificationHeading: 'Ny påmelding',
    notificationIntro: 'Noen har meldt seg på arrangementet.',
    openSubmissions: 'Vis påmeldinger',
    footer: 'Dette er en automatisk melding.',
    nameLabel: 'Navn',
    emailLabel: 'E-post',
    eventLabel: 'Arrangement',
  },
  'fi-FI': {
    confirmationHeading: 'Ilmoittautumisesi on vahvistettu',
    confirmationIntro: 'Kiitos ilmoittautumisesta. Tässä ovat tietosi.',
    attachmentNote: 'Pääsylippusi on liitteenä PDF-tiedostona. Ota se mukaan sisäänkäynnille.',
    referenceLabel: 'Viite',
    webVersion: 'Avaa selaimessa',
    notificationHeading: 'Uusi ilmoittautuminen',
    notificationIntro: 'Joku on ilmoittautunut tapahtumaan.',
    openSubmissions: 'Näytä ilmoittautumiset',
    footer: 'Tämä on automaattinen viesti.',
    nameLabel: 'Nimi',
    emailLabel: 'Sähköposti',
    eventLabel: 'Tapahtuma',
  },
  'is-IS': {
    confirmationHeading: 'Skráningin þín er staðfest',
    confirmationIntro: 'Takk fyrir skráninguna. Hér eru upplýsingarnar þínar.',
    attachmentNote: 'Aðgangskortið þitt fylgir með sem PDF. Taktu það með að innganginum.',
    referenceLabel: 'Tilvísun',
    webVersion: 'Skoða í vafra',
    notificationHeading: 'Ný skráning',
    notificationIntro: 'Einhver hefur skráð sig á viðburðinn.',
    openSubmissions: 'Skoða skráningar',
    footer: 'Þetta eru sjálfvirk skilaboð.',
    nameLabel: 'Nafn',
    emailLabel: 'Netfang',
    eventLabel: 'Viðburður',
  },
  'fr-FR': {
    confirmationHeading: 'Votre inscription est confirmée',
    confirmationIntro: 'Merci de votre inscription. Voici vos informations.',
    attachmentNote: 'Votre carte d’accès est jointe au format PDF. Présentez-la à l’entrée.',
    referenceLabel: 'Référence',
    webVersion: 'Afficher dans le navigateur',
    notificationHeading: 'Nouvelle inscription',
    notificationIntro: 'Quelqu’un s’est inscrit à l’événement.',
    openSubmissions: 'Voir les inscriptions',
    footer: 'Ceci est un message automatique.',
    nameLabel: 'Nom',
    emailLabel: 'E-mail',
    eventLabel: 'Événement',
  },
  'de-DE': {
    confirmationHeading: 'Ihre Anmeldung ist bestätigt',
    confirmationIntro: 'Vielen Dank für Ihre Anmeldung. Hier sind Ihre Angaben.',
    attachmentNote: 'Ihre Eintrittskarte ist als PDF angehängt. Bringen Sie sie zum Eingang mit.',
    referenceLabel: 'Referenz',
    webVersion: 'Im Browser ansehen',
    notificationHeading: 'Neue Anmeldung',
    notificationIntro: 'Jemand hat sich für die Veranstaltung angemeldet.',
    openSubmissions: 'Anmeldungen ansehen',
    footer: 'Dies ist eine automatische Nachricht.',
    nameLabel: 'Name',
    emailLabel: 'E-Mail',
    eventLabel: 'Veranstaltung',
  },
  'es-ES': {
    confirmationHeading: 'Tu inscripción está confirmada',
    confirmationIntro: 'Gracias por inscribirte. Estos son tus datos.',
    attachmentNote: 'Tu entrada se adjunta en PDF. Llévala a la entrada.',
    referenceLabel: 'Referencia',
    webVersion: 'Ver en el navegador',
    notificationHeading: 'Nueva inscripción',
    notificationIntro: 'Alguien se ha inscrito en el evento.',
    openSubmissions: 'Ver inscripciones',
    footer: 'Este es un mensaje automático.',
    nameLabel: 'Nombre',
    emailLabel: 'Correo electrónico',
    eventLabel: 'Evento',
  },
  'zh-CN': {
    confirmationHeading: '您的报名已确认',
    confirmationIntro: '感谢报名。以下是您的信息。',
    attachmentNote: '入场凭证已作为 PDF 附件发送，请在入口出示。',
    referenceLabel: '参考编号',
    webVersion: '在浏览器中查看',
    notificationHeading: '新报名',
    notificationIntro: '有人报名了该活动。',
    openSubmissions: '查看报名',
    footer: '这是一封自动发送的邮件。',
    nameLabel: '姓名',
    emailLabel: '电子邮件',
    eventLabel: '活动',
  },
  'ja-JP': {
    confirmationHeading: 'お申し込みを受け付けました',
    confirmationIntro: 'お申し込みありがとうございます。内容は以下のとおりです。',
    attachmentNote: '入場券を PDF で添付しています。受付でご提示ください。',
    referenceLabel: '受付番号',
    webVersion: 'ブラウザで表示',
    notificationHeading: '新しい申し込み',
    notificationIntro: 'イベントに申し込みがありました。',
    openSubmissions: '申し込みを表示',
    footer: 'これは自動送信メールです。',
    nameLabel: '氏名',
    emailLabel: 'メールアドレス',
    eventLabel: 'イベント',
  },
  'ru-RU': {
    confirmationHeading: 'Ваша регистрация подтверждена',
    confirmationIntro: 'Спасибо за регистрацию. Вот ваши данные.',
    attachmentNote: 'Входной билет приложен в PDF. Покажите его на входе.',
    referenceLabel: 'Номер брони',
    webVersion: 'Открыть в браузере',
    notificationHeading: 'Новая регистрация',
    notificationIntro: 'Кто-то зарегистрировался на мероприятие.',
    openSubmissions: 'Показать регистрации',
    footer: 'Это автоматическое сообщение.',
    nameLabel: 'Имя',
    emailLabel: 'Электронная почта',
    eventLabel: 'Мероприятие',
  },
} as const;

export const EMAIL_COPY_LOCALES = Object.keys(COPY);

/**
 * The copy for a locale, falling back to English.
 *
 * It used to fall back to Swedish, which is nobody's idea of a neutral default and was only ever
 * the first language written. English is the language this product is authored in and the one a
 * recipient of an unknown locale is likeliest to make something of.
 */
function copyFor(locale: string) {
  return COPY[locale as keyof typeof COPY] ?? COPY['en-GB'];
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
        lang: locale,
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
      lang: locale,
      heading: copy.notificationHeading,
      intro: copy.notificationIntro,
      /*
       * Every label from the table. Three of these were Swedish string literals sitting next to a
       * correctly localised fourth, so an operator in a German organisation got "Namn", "E-post"
       * and "Evenemang" among otherwise German copy — one email in two languages.
       */
      rows: [
        { label: copy.nameLabel, value: attendeeName(submission.data) || '—' },
        { label: copy.emailLabel, value: submission.email ?? '—' },
        { label: copy.referenceLabel, value: submission.reference },
        { label: copy.eventLabel, value: eventName },
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

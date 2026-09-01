import QRCode from 'qrcode';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { toPrintCss, type PrintOptions } from '@tp/tokens/pdf';
import type {
  EventRecord,
  OrganisationRecord,
  SubmissionRecord,
} from '../db/repositories/index.js';

/**
 * The admission document — START-HERE §In scope: "branded, in the attendee's language, with the
 * event details and a QR code encoding a signed token".
 *
 * Rendered from the tokens compiled in phase 1, so a brand change reaches this page without it
 * knowing anything about colours.
 */
export interface AdmissionStrings {
  title: string;
  attendee: string;
  reference: string;
  event: string;
  when: string;
  where: string;
  admission: string;
  instructions: string;
  scanNote: string;
}

/** Both locales live here rather than in packages/i18n: this text is document copy, not UI. */
const STRINGS: Record<string, AdmissionStrings> = {
  'sv-SE': {
    title: 'Inträdeskort',
    attendee: 'Deltagare',
    reference: 'Referens',
    event: 'Evenemang',
    when: 'Tid',
    where: 'Plats',
    admission: 'Inträde',
    instructions: 'Ta med det här kortet till entrén.',
    scanNote: 'QR-koden läses av vid ankomst.',
  },
  'en-GB': {
    title: 'Admission card',
    attendee: 'Attendee',
    reference: 'Reference',
    event: 'Event',
    when: 'When',
    where: 'Where',
    admission: 'Admission',
    instructions: 'Bring this card to the entrance.',
    scanNote: 'The QR code is scanned on arrival.',
  },
};

export function admissionStrings(locale: string): AdmissionStrings {
  return STRINGS[locale] ?? STRINGS[locale.split('-')[0] ?? ''] ?? STRINGS['sv-SE']!;
}

export interface AdmissionInput {
  organisation: OrganisationRecord;
  event: EventRecord;
  submission: SubmissionRecord;
  /** The signed `<reference>.<signature>` payload. */
  token: string;
  tokens?: TokenSet;
}

/** Best-effort attendee name from the answers: whatever the form called it. */
export function attendeeName(data: Record<string, unknown>): string {
  for (const key of ['full_name', 'name', 'first_name', 'namn']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function renderAdmissionHtml(input: AdmissionInput): Promise<string> {
  const { organisation, event, submission } = input;
  const tokens = input.tokens ?? defaultTokens;
  const locales: LocaleConfig = {
    supported: organisation.supportedLocales,
    default: organisation.defaultLocale,
  };

  // The attendee's locale, not the organisation's — this document is for them.
  const locale = submission.locale;
  const strings = admissionStrings(locale);
  const eventName = pickText(locales, event.name, locale).value;

  const printOptions: PrintOptions = {
    pageSize: 'A4',
    header: organisation.name,
    footer: eventName,
  };

  // SVG rather than a raster image: it stays crisp whatever the print size, and Chromium embeds it
  // as vector in the PDF.
  const qr = await QRCode.toString(input.token, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 180,
  });

  const when = formatRange(locale, event.startsAt, event.endsAt);
  const where = [event.venueName, event.venueAddress].filter(Boolean).join(', ');

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(strings.title)} — ${escapeHtml(submission.reference)}</title>
<style>
${toPrintCss(tokens, printOptions)}

.admission {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  justify-content: space-between;
}
.admission__details { flex: 1; }
.admission__qr { width: 180px; text-align: center; }
.admission__qr svg { width: 180px; height: 180px; }
.admission__reference {
  margin-top: 8px;
  font-family: ${tokens.typography.bodyFont};
  font-size: 14px;
  letter-spacing: 0.08em;
}
dl { margin: 0; }
dt {
  margin-top: 12px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${tokens.colour.muted};
}
dd { margin: 2px 0 0 0; font-size: 16px; }
</style>
</head>
<body>
<div class="tp-card">
  <p class="tp-muted">${escapeHtml(strings.admission)}</p>
  <h1>${escapeHtml(strings.title)}</h1>

  <div class="admission">
    <div class="admission__details">
      <dl>
        <dt>${escapeHtml(strings.attendee)}</dt>
        <dd>${escapeHtml(attendeeName(submission.data) || '—')}</dd>

        <dt>${escapeHtml(strings.event)}</dt>
        <dd>${escapeHtml(eventName)}</dd>

        <dt>${escapeHtml(strings.when)}</dt>
        <dd>${escapeHtml(when)}</dd>

        ${where ? `<dt>${escapeHtml(strings.where)}</dt><dd>${escapeHtml(where)}</dd>` : ''}

        <dt>${escapeHtml(strings.reference)}</dt>
        <dd>${escapeHtml(submission.reference)}</dd>
      </dl>

      <p class="tp-muted">${escapeHtml(strings.instructions)}</p>
    </div>

    <div class="admission__qr">
      ${qr}
      <p class="admission__reference">${escapeHtml(submission.reference)}</p>
      <p class="tp-muted" style="font-size:11px">${escapeHtml(strings.scanNote)}</p>
    </div>
  </div>
</div>
</body>
</html>
`;
}

function formatRange(locale: string, start: Date, end: Date): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(start);
  const from = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(start);
  const to = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(end);
  return `${date}, ${from}–${to}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

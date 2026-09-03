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

/**
 * Document copy, so it lives here rather than in `packages/i18n` — this is the wording on a piece
 * of paper somebody carries to a door, not a label in the interface.
 *
 * ## Every language, not two
 *
 * This table held Swedish and English and fell back to Swedish, so a French attendee who filled in
 * a French form was handed a Swedish admission card to print and show at the entrance. Of all the
 * places for the wrong language, a document somebody presents to a stranger is close to the worst:
 * they cannot re-read it in a different one, and the person checking them in cannot either.
 *
 * `admission.test.ts` holds this against the locale registry, so a thirteenth language fails the
 * build rather than shipping Swedish to somebody who never asked for it.
 */
const STRINGS: Record<string, AdmissionStrings> = {
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
  'da-DK': {
    title: 'Adgangskort',
    attendee: 'Deltager',
    reference: 'Reference',
    event: 'Arrangement',
    when: 'Tid',
    where: 'Sted',
    admission: 'Adgang',
    instructions: 'Tag dette kort med til indgangen.',
    scanNote: 'QR-koden scannes ved ankomst.',
  },
  'nb-NO': {
    title: 'Adgangskort',
    attendee: 'Deltaker',
    reference: 'Referanse',
    event: 'Arrangement',
    when: 'Tid',
    where: 'Sted',
    admission: 'Adgang',
    instructions: 'Ta med dette kortet til inngangen.',
    scanNote: 'QR-koden skannes ved ankomst.',
  },
  'fi-FI': {
    title: 'Pääsylippu',
    attendee: 'Osallistuja',
    reference: 'Viite',
    event: 'Tapahtuma',
    when: 'Aika',
    where: 'Paikka',
    admission: 'Pääsy',
    instructions: 'Ota tämä lippu mukaan sisäänkäynnille.',
    scanNote: 'QR-koodi luetaan saavuttaessa.',
  },
  'is-IS': {
    title: 'Aðgangskort',
    attendee: 'Þátttakandi',
    reference: 'Tilvísun',
    event: 'Viðburður',
    when: 'Tími',
    where: 'Staður',
    admission: 'Aðgangur',
    instructions: 'Taktu þetta kort með að innganginum.',
    scanNote: 'QR-kóðinn er skannaður við komu.',
  },
  'fr-FR': {
    title: 'Carte d’accès',
    attendee: 'Participant',
    reference: 'Référence',
    event: 'Événement',
    when: 'Date',
    where: 'Lieu',
    admission: 'Accès',
    instructions: 'Présentez cette carte à l’entrée.',
    scanNote: 'Le code QR est scanné à l’arrivée.',
  },
  'de-DE': {
    title: 'Eintrittskarte',
    attendee: 'Teilnehmer',
    reference: 'Referenz',
    event: 'Veranstaltung',
    when: 'Zeit',
    where: 'Ort',
    admission: 'Eintritt',
    instructions: 'Bringen Sie diese Karte zum Eingang mit.',
    scanNote: 'Der QR-Code wird beim Einlass gescannt.',
  },
  'es-ES': {
    title: 'Entrada',
    attendee: 'Asistente',
    reference: 'Referencia',
    event: 'Evento',
    when: 'Fecha',
    where: 'Lugar',
    admission: 'Acceso',
    instructions: 'Lleva esta entrada a la puerta.',
    scanNote: 'El código QR se escanea a la llegada.',
  },
  'zh-CN': {
    title: '入场凭证',
    attendee: '参加者',
    reference: '参考编号',
    event: '活动',
    when: '时间',
    where: '地点',
    admission: '入场',
    instructions: '请携带此凭证到入口。',
    scanNote: '二维码将在入场时扫描。',
  },
  'ja-JP': {
    title: '入場券',
    attendee: '参加者',
    reference: '受付番号',
    event: 'イベント',
    when: '日時',
    where: '会場',
    admission: '入場',
    instructions: 'この券を入口までお持ちください。',
    scanNote: 'QRコードは受付で読み取ります。',
  },
  'ru-RU': {
    title: 'Входной билет',
    attendee: 'Участник',
    reference: 'Номер брони',
    event: 'Мероприятие',
    when: 'Время',
    where: 'Место',
    admission: 'Вход',
    instructions: 'Возьмите этот билет с собой на вход.',
    scanNote: 'QR-код сканируется на входе.',
  },
};

/** The languages an admission card can be printed in. `admission.test.ts` checks it is all of them. */
export const ADMISSION_LOCALES = Object.keys(STRINGS);

/**
 * The wording for a locale, falling back to English.
 *
 * There was a second lookup here on the language subtag — `locale.split('-')[0]`, so `sv` — which
 * could never match, because every key in the table is a full locale. It had never once fired, and
 * the real behaviour was "the right language, or Swedish". The same dead fallback was in `Flag`.
 *
 * English is the last resort rather than Swedish: it is the language this product is authored in,
 * not merely the first one somebody happened to write.
 */
export function admissionStrings(locale: string): AdmissionStrings {
  return STRINGS[locale] ?? STRINGS['en-GB']!;
}

/**
 * How the admission QR is generated. Exported so `admission-qr.test.ts` can hold it to the spec.
 *
 * ## The quiet zone
 *
 * `margin` was `0`. The QR specification requires a **four-module** clear border on all sides, and
 * it is not decoration: decoders use it to find the symbol's edges, and without it a scanner has to
 * guess where the code stops and the page begins. It happened to be surrounded by card padding,
 * which is not the same thing — the padding is a layout value that anybody could reduce, and the
 * card is parchment while the light modules were white, so the boundary the decoder needed to see
 * was exactly where one colour became another.
 *
 * ## The error correction level
 *
 * `M` corrects about 15% and is the right default for a code on a screen. This one is printed,
 * folded into a pocket and held under whatever light a venue door has. `Q` corrects about 25%,
 * which is the usual choice for anything physical and is what lets a crease through the symbol
 * still scan. It costs a slightly denser code at the same size.
 *
 * ## The colours
 *
 * The dark modules stay pure black rather than taking the brand's ink. `CLAUDE.md` rule 4 is about
 * *design* colours, and this is not one — it is the contrast a camera needs at a door, and the one
 * thing on this card that has to work for a machine before it works for a person. The light
 * modules take the card's own background so the quiet zone is part of the card rather than a white
 * patch stuck onto it.
 */
export const ADMISSION_QR = {
  type: 'svg',
  errorCorrectionLevel: 'Q',
  /** Four modules, per the specification. */
  margin: 4,
  width: 180,
} as const;

/** Pure black, for the reason in the note above: this is contrast for a camera, not a brand colour. */
export const QR_DARK = '#000000';

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
    ...ADMISSION_QR,
    // The quiet zone takes the card's colour, so it is part of the card and not a white patch.
    color: { dark: QR_DARK, light: tokens.colour.background },
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

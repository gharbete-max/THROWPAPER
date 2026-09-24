import { pickText, type LocaleConfig } from '@tp/i18n';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { toPrintCss } from '@tp/tokens/pdf';
import {
  answerableChildren,
  isVisible,
  readSignatureVector,
  signatureVectorSvg,
  type EntryField,
  type Field,
  type FormDefinition,
} from '@tp/shared/forms';
import type { OrganisationRecord, SubmissionRecord } from '../db/repositories/index.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import type { PdfRenderer } from './render.js';
import { fillPaper } from './paper.js';
import { documentFilename } from './filename.js';

/**
 * The finished document: one submission, as a PDF somebody can keep, print or send on.
 *
 * Every form ends here. The person who filled it in downloads it from the confirmation screen;
 * whoever collects the answers downloads it from the row. It is the same file for both, because
 * two renderings of one submission are two chances to disagree about what was answered.
 *
 * ## Which document
 *
 * - **A form made from paper** (`docs/adr/0004-old-forms-on-paper.md`) comes back *as that paper*,
 *   with the answers written into its boxes by `fillPaper`. The page was the point of the form.
 * - **Every other form** becomes a record of its answers: the form's title, when it was sent, its
 *   reference, then each question the person was shown and what they answered, in their language.
 *
 * ## What it says, and what it does not
 *
 * Only what happened: these answers were sent on this date under this reference. It carries no
 * wording about validity, signing or identity (CLAUDE.md rule 8) — a drawn signature appears as
 * the picture the person drew, under the question that asked for it, and nothing more is claimed
 * for it. Questions hidden by a condition are left out, because the person never saw them; hidden
 * fields (values carried in the link) are left out, because they were never asked.
 */

export interface FinishedDeps {
  renderer: PdfRenderer;
  uploadStore: PrivateUploadStore;
  tokens?: TokenSet;
}

export interface FinishedInput {
  organisation: Pick<OrganisationRecord, 'name' | 'supportedLocales' | 'defaultLocale'>;
  formTitle: Record<string, string>;
  submission: SubmissionRecord;
  /** The version this submission was made against, never the current draft. */
  definition: FormDefinition;
  /** Original filenames of attached files, by storage key. */
  filenames?: ReadonlyMap<string, string>;
}

export interface FinishedDocument {
  pdf: Buffer;
  filename: string;
}

export interface FinishedStrings {
  submitted: string;
  reference: string;
  yes: string;
  no: string;
  unanswered: string;
  /** "{n}" is replaced with the entry number. */
  entry: string;
  file: string;
  /** "{organisation}" is replaced. The last line on the page: whose record this is. */
  sentTo: string;
}

/**
 * Document copy, kept with the document like the admission card's (see `admission.ts` for why it
 * is not in `packages/i18n`). `finished.test.ts` holds it against the locale registry.
 */
const STRINGS: Record<string, FinishedStrings> = {
  'en-GB': {
    submitted: 'Sent',
    reference: 'Reference',
    yes: 'Yes',
    no: 'No',
    unanswered: 'Not answered',
    entry: 'Entry {n}',
    file: 'Attached file',
    sentTo: 'Answers as sent to {organisation}.',
  },
  'sv-SE': {
    submitted: 'Skickad',
    reference: 'Referens',
    yes: 'Ja',
    no: 'Nej',
    unanswered: 'Inte besvarad',
    entry: 'Post {n}',
    file: 'Bifogad fil',
    sentTo: 'Svaren så som de skickades till {organisation}.',
  },
  'da-DK': {
    submitted: 'Sendt',
    reference: 'Reference',
    yes: 'Ja',
    no: 'Nej',
    unanswered: 'Ikke besvaret',
    entry: 'Post {n}',
    file: 'Vedhæftet fil',
    sentTo: 'Svarene, som de blev sendt til {organisation}.',
  },
  'nb-NO': {
    submitted: 'Sendt',
    reference: 'Referanse',
    yes: 'Ja',
    no: 'Nei',
    unanswered: 'Ikke besvart',
    entry: 'Oppføring {n}',
    file: 'Vedlagt fil',
    sentTo: 'Svarene slik de ble sendt til {organisation}.',
  },
  'fi-FI': {
    submitted: 'Lähetetty',
    reference: 'Viite',
    yes: 'Kyllä',
    no: 'Ei',
    unanswered: 'Ei vastattu',
    entry: 'Kohta {n}',
    file: 'Liitetiedosto',
    sentTo: 'Vastaukset sellaisina kuin ne lähetettiin: {organisation}.',
  },
  'is-IS': {
    submitted: 'Sent',
    reference: 'Tilvísun',
    yes: 'Já',
    no: 'Nei',
    unanswered: 'Ekki svarað',
    entry: 'Færsla {n}',
    file: 'Viðhengi',
    sentTo: 'Svörin eins og þau voru send til {organisation}.',
  },
  'fr-FR': {
    submitted: 'Envoyé le',
    reference: 'Référence',
    yes: 'Oui',
    no: 'Non',
    unanswered: 'Sans réponse',
    entry: 'Entrée {n}',
    file: 'Fichier joint',
    sentTo: 'Réponses telles qu’envoyées à {organisation}.',
  },
  'de-DE': {
    submitted: 'Gesendet',
    reference: 'Referenz',
    yes: 'Ja',
    no: 'Nein',
    unanswered: 'Nicht beantwortet',
    entry: 'Eintrag {n}',
    file: 'Angehängte Datei',
    sentTo: 'Antworten, wie sie an {organisation} gesendet wurden.',
  },
  'es-ES': {
    submitted: 'Enviado',
    reference: 'Referencia',
    yes: 'Sí',
    no: 'No',
    unanswered: 'Sin respuesta',
    entry: 'Entrada {n}',
    file: 'Archivo adjunto',
    sentTo: 'Respuestas tal como se enviaron a {organisation}.',
  },
  'zh-CN': {
    submitted: '提交时间',
    reference: '参考编号',
    yes: '是',
    no: '否',
    unanswered: '未作答',
    entry: '第 {n} 项',
    file: '附件',
    sentTo: '以上为发送给 {organisation} 的答复。',
  },
  'ja-JP': {
    submitted: '送信日時',
    reference: '受付番号',
    yes: 'はい',
    no: 'いいえ',
    unanswered: '未回答',
    entry: '{n} 件目',
    file: '添付ファイル',
    sentTo: '{organisation} に送信された回答です。',
  },
  'ru-RU': {
    submitted: 'Отправлено',
    reference: 'Номер',
    yes: 'Да',
    no: 'Нет',
    unanswered: 'Нет ответа',
    entry: 'Запись {n}',
    file: 'Прикреплённый файл',
    sentTo: 'Ответы в том виде, в каком они отправлены в {organisation}.',
  },
};

export const FINISHED_LOCALES = Object.keys(STRINGS);

export function finishedStrings(locale: string): FinishedStrings {
  return STRINGS[locale] ?? STRINGS['en-GB']!;
}

export async function renderFinishedDocument(
  deps: FinishedDeps,
  input: FinishedInput,
): Promise<FinishedDocument> {
  const locales: LocaleConfig = {
    supported: input.organisation.supportedLocales,
    default: input.organisation.defaultLocale,
  };
  const title = pickText(locales, input.formTitle, input.submission.locale).value;
  const filename = documentFilename(title, input.submission.reference);

  if (input.definition.paper) {
    const filled = await fillPaper(
      { uploadStore: deps.uploadStore, renderer: deps.renderer, tokens: deps.tokens },
      input.submission,
      input.definition,
      locales,
    );
    // A paper whose source has gone missing still has answers worth keeping: fall through.
    if (filled) return { pdf: filled.pdf, filename };
  }

  const html = await finishedHtml(deps, input, title, locales);
  const pdf = await deps.renderer.render(html, {
    header: input.organisation.name,
    footer: `${title} · ${input.submission.reference}`,
  });
  return { pdf, filename };
}

/** Exported for tests: the HTML is where escaping and completeness can be checked cheaply. */
export async function finishedHtml(
  deps: Pick<FinishedDeps, 'uploadStore' | 'tokens'>,
  input: FinishedInput,
  title: string,
  locales: LocaleConfig,
): Promise<string> {
  const tokens = deps.tokens ?? defaultTokens;
  const { submission, definition } = input;
  const locale = submission.locale;
  const words = finishedStrings(locale);
  const values = submission.data;
  const text = (localised: Record<string, string> | undefined) =>
    localised ? pickText(locales, localised, locale).value : '';

  const sentAt = submission.submittedAt ?? submission.updatedAt;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(
    sentAt,
  );

  const rows: string[] = [];
  for (const field of definition.fields) {
    if (!isVisible(field, values)) continue;
    if (field.type === 'section_break') {
      rows.push(`<h2 class="section">${escapeHtml(text(field.label))}</h2>`);
      continue;
    }
    if (field.type === 'repeating_group') {
      const entries = Array.isArray(values[field.key]) ? (values[field.key] as unknown[]) : [];
      rows.push(`<h2 class="section">${escapeHtml(text(field.label))}</h2>`);
      if (entries.length === 0) {
        rows.push(`<p class="unanswered">${escapeHtml(words.unanswered)}</p>`);
      }
      for (const [index, entry] of entries.entries()) {
        const answers =
          entry !== null && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)
            : {};
        const inner: string[] = [];
        for (const child of answerableChildren(field)) {
          if (child.type === 'hidden' || !isVisible(child as Field, answers)) continue;
          inner.push(await row(deps, child, answers[child.key], text, words, locale, input));
        }
        rows.push(
          `<section class="entry"><h3>${escapeHtml(words.entry.replace('{n}', String(index + 1)))}</h3><dl>${inner.join('')}</dl></section>`,
        );
      }
      continue;
    }
    if (!isAnswerable(field) || field.type === 'hidden') continue;
    rows.push(`<dl>${await row(deps, field, values[field.key], text, words, locale, input)}</dl>`);
  }

  const { colour } = tokens;
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(submission.reference)}</title>
<meta name="author" content="${escapeHtml(input.organisation.name)}" />
<style>
${toPrintCss(tokens)}
.meta { display: flex; gap: 32px; margin: 0 0 24px 0; padding-bottom: 12px; border-bottom: ${tokens.borderWidth} solid ${colour.border}; }
.meta div { min-width: 0; }
.meta dt, dl dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: ${colour.muted}; margin: 0; }
.meta dd { margin: 2px 0 0 0; font-weight: ${tokens.typography.weightBold}; }
dl { margin: 0; }
dl dt { margin-top: 14px; text-transform: none; letter-spacing: 0; font-size: 12px; break-after: avoid; }
dl dd { margin: 2px 0 0 0; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; }
h2.section { margin-top: 24px; font-size: 16px; }
section.entry { margin: 8px 0 0 0; padding: 4px 0 8px 12px; border-left: 2px solid ${colour.border}; break-inside: avoid; }
section.entry h3 { font-size: 13px; margin: 8px 0 0 0; }
.unanswered { color: ${colour.muted}; font-style: italic; }
.signature { display: block; max-width: 280px; max-height: 110px; margin-top: 4px; }
.signature svg { width: 280px; height: 110px; }
.closing { margin-top: 32px; font-size: 11px; color: ${colour.muted}; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<dl class="meta">
  <div><dt>${escapeHtml(words.submitted)}</dt><dd>${escapeHtml(when)}</dd></div>
  <div><dt>${escapeHtml(words.reference)}</dt><dd>${escapeHtml(submission.reference)}</dd></div>
</dl>
${rows.join('\n')}
<p class="closing">${escapeHtml(words.sentTo.replace('{organisation}', input.organisation.name))}</p>
</body>
</html>
`;
}

function isAnswerable(field: Field): boolean {
  return !['page_break', 'rich_text', 'image', 'link', 'shape', 'drawing'].includes(field.type);
}

async function row(
  deps: Pick<FinishedDeps, 'uploadStore'>,
  field: Field | EntryField,
  raw: unknown,
  text: (localised: Record<string, string> | undefined) => string,
  words: FinishedStrings,
  locale: string,
  input: FinishedInput,
): Promise<string> {
  const label = 'label' in field ? text(field.label as Record<string, string>) : field.key;
  const answer = await answerHtml(deps, field, raw, text, words, locale, input);
  return `<dt>${escapeHtml(label)}</dt><dd>${answer ?? `<span class="unanswered">${escapeHtml(words.unanswered)}</span>`}</dd>`;
}

/** The answer, as HTML that is already escaped. `null` when nothing was answered. */
async function answerHtml(
  deps: Pick<FinishedDeps, 'uploadStore'>,
  field: Field | EntryField,
  raw: unknown,
  text: (localised: Record<string, string> | undefined) => string,
  words: FinishedStrings,
  locale: string,
  input: FinishedInput,
): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw) && raw.length === 0) return null;

  switch (field.type) {
    case 'signature': {
      const bytes = typeof raw === 'string' ? await deps.uploadStore.get(raw) : null;
      if (!bytes) return null;
      const read = readSignatureVector(bytes);
      const svg = read.ok && read.vector ? signatureVectorSvg(read.vector) : null;
      return svg
        ? `<span class="signature">${svg}</span>`
        : `<img class="signature" src="data:image/png;base64,${bytes.toString('base64')}" alt="" />`;
    }
    case 'file': {
      const name = typeof raw === 'string' ? input.filenames?.get(raw) : undefined;
      return escapeHtml(name ? `${words.file}: ${name}` : words.file);
    }
    case 'yes_no':
      return escapeHtml(raw === true || raw === 'true' ? words.yes : words.no);
    case 'single_select':
    case 'multi_select': {
      const chosen = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      return escapeHtml(
        chosen
          .map((value) => {
            const option = field.options.find((candidate) => candidate.value === value);
            return option ? text(option.label) : value;
          })
          .join(', '),
      );
    }
    case 'rating':
      return escapeHtml(`${String(raw)} / ${field.scale}`);
    case 'date': {
      const date = new Date(String(raw));
      return escapeHtml(
        Number.isNaN(date.getTime())
          ? String(raw)
          : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date),
      );
    }
    case 'number':
      // As stored: a number the person typed is shown as they typed it, never re-rounded.
      return escapeHtml(String(raw));
    default:
      return escapeHtml(Array.isArray(raw) ? raw.map(String).join(', ') : String(raw));
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

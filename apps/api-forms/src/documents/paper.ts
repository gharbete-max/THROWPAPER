import { PDFDocument } from 'pdf-lib';
import { pickText, type LocaleConfig } from '@tp/i18n';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { fontFaceCss } from '@tp/tokens/pdf';
import type { Field, FormDefinition, PaperAnchor } from '@tp/shared/forms';
import type { SubmissionRecord } from '../db/repositories/index.js';
import type { PrivateUploadStore } from '../uploads/private-store.js';
import { imageSize } from '../uploads/image-size.js';
import { contentTypeFor } from '../uploads/attachment.js';
import type { UploadExtension } from '@tp/shared/forms';
import type { PdfRenderer } from './render.js';

/**
 * A submission written back onto the paper its form was made from.
 *
 * `docs/adr/0004-old-forms-on-paper.md` calls this overlay output and holds it for the document
 * that must be submitted as itself — a signed authority, a regulator's sheet with a form number
 * on it. Everything else this product does with an answer happens after it is a record; this is
 * the one output where the original page is the point.
 *
 * ## Two tools, each doing what it already does
 *
 * Chromium draws the answers. Text in any of the twelve languages is a solved problem in
 * `render.ts` — the fonts the Playwright image ships cover Cyrillic and CJK, and pdf-lib's own
 * fonts are WinAnsi and would throw on a Russian surname. So the answers become an **overlay**:
 * one transparent page per paper page, the same size in points, each answer absolutely
 * positioned at its anchor.
 *
 * pdf-lib then puts the overlay on the paper: a source PDF's pages are copied as they are and
 * the matching overlay page is drawn over each. A photographed page needs no compositing at all
 * — the photograph is painted into the overlay page as its background, and that page *is* the
 * output page. pdf-lib never draws text or decodes an image; Chromium already did both.
 *
 * ## What is written
 *
 * The respondent's answer, verbatim, in their own language (rule 8: nothing here rephrases).
 * A field with no anchor was never on the paper and is not drawn. A repeating block has no box
 * that could hold N entries and is not drawn either — see PROGRESS.
 */

export interface PaperDeps {
  uploadStore: PrivateUploadStore;
  renderer: PdfRenderer;
  tokens?: TokenSet;
}

export interface FilledPaper {
  pdf: Buffer;
  filename: string;
}

/** A4 in points. A photograph becomes a page this wide, however many pixels it has. */
const A4_WIDTH = 595.28;

/** The largest text an answer is set in, whatever the box. Bigger reads as shouting. */
const MAX_FONT_PT = 11;

/**
 * A tick box, as an AcroForm one arrives: small and about square. A yes in one is a tick; a yes
 * in any other box is the word.
 */
function isTickBox(anchor: PaperAnchor, page: { width: number; height: number }): boolean {
  const w = anchor.w * page.width;
  const h = anchor.h * page.height;
  return h < 24 && Math.abs(w - h) < Math.max(w, h) * 0.5;
}

type Page = { width: number; height: number; background?: string };

export async function fillPaper(
  deps: PaperDeps,
  submission: SubmissionRecord,
  definition: FormDefinition,
  locales: LocaleConfig,
): Promise<FilledPaper | null> {
  if (!definition.paper) return null;
  const tokens = deps.tokens ?? defaultTokens;
  const locale = submission.locale;

  // Page geometry first: an anchor is a fraction, and the overlay has to be the page's size.
  const pages: Page[] = [];
  const sources: Array<{ bytes: Buffer; pdf: boolean; pages: number }> = [];
  for (const source of definition.paper.sources) {
    const bytes = await deps.uploadStore.get(source.key);
    if (!bytes) return null;
    const extension = source.key.split('.')[1] as UploadExtension;
    if (extension === 'pdf') {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const sizes = doc.getPages().map((page) => page.getSize());
      pages.push(...sizes);
      sources.push({ bytes, pdf: true, pages: sizes.length });
    } else {
      const format = extension === 'jpg' ? 'jpeg' : extension;
      const size = imageSize(bytes, format) ?? { width: 595, height: 842 };
      pages.push({
        width: A4_WIDTH,
        height: (A4_WIDTH * size.height) / size.width,
        background: `data:${contentTypeFor(extension)};base64,${bytes.toString('base64')}`,
      });
      sources.push({ bytes, pdf: false, pages: 1 });
    }
  }

  const overlay = await deps.renderer.renderPages(
    await overlayHtml(deps, tokens, definition, submission, locales, locale, pages),
  );

  // Composite. Each source contributes its pages in order; page indices match `pages` above.
  const out = await PDFDocument.create();
  const overlayDoc = await PDFDocument.load(overlay);
  let at = 0;
  for (const source of sources) {
    if (source.pdf) {
      const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
      const copied = await out.copyPages(doc, doc.getPageIndices());
      const drawn = await out.embedPdf(
        overlayDoc,
        copied.map((_, i) => at + i),
      );
      copied.forEach((page, i) => {
        out.addPage(page);
        const { width, height } = page.getSize();
        page.drawPage(drawn[i]!, { x: 0, y: 0, width, height });
      });
    } else {
      // The photograph is already in the overlay page; that page is the output page.
      const [page] = await out.copyPages(overlayDoc, [at]);
      out.addPage(page!);
    }
    at += source.pages;
  }

  return {
    pdf: Buffer.from(await out.save()),
    filename: `${submission.reference}-paper.pdf`,
  };
}

async function overlayHtml(
  deps: PaperDeps,
  tokens: TokenSet,
  definition: FormDefinition,
  submission: SubmissionRecord,
  locales: LocaleConfig,
  locale: string,
  pages: Page[],
): Promise<string> {
  const { typography } = tokens;
  const fonts = fontFaceCss([typography.bodyFont], [typography.weightRegular]);
  const words = STRINGS[locale] ?? STRINGS['en-GB']!;

  const boxes: string[][] = pages.map(() => []);
  for (const field of definition.fields) {
    const anchor = field.paper;
    const page = anchor && pages[anchor.page];
    if (!anchor || !page || field.type === 'repeating_group') continue;
    const raw = submission.data[field.key];
    if (raw === undefined || raw === null || raw === '') continue;

    /*
     * A choice whose options have their own boxes — a radio group as it came off the paper — gets
     * a tick on each chosen button, which is what a pen would do. Otherwise the label, in the box.
     */
    const chosen = choicesWithBoxes(field, raw);
    if (chosen.length > 0) {
      for (const box of chosen) {
        const on = pages[box.page];
        if (on) boxes[box.page]!.push(`<div class="a tick" style="${styleFor(box, on)}">✓</div>`);
      }
      continue;
    }

    const inner = await answerHtml(deps, field, raw, anchor, page, locales, locale, words);
    const kind =
      field.type === 'signature'
        ? ' mark'
        : field.type === 'yes_no' && isTickBox(anchor, page)
          ? ' tick'
          : '';
    if (inner) {
      boxes[anchor.page]!.push(
        `<div class="a${kind}" style="${styleFor(anchor, page)}">${inner}</div>`,
      );
    }
  }

  const pageCss = pages
    .map((page, i) => `@page p${i} { size: ${page.width}pt ${page.height}pt; margin: 0; }`)
    .join('\n');
  const sections = pages
    .map((page, i) => {
      const background = page.background
        ? `<img class="bg" src="${page.background}" alt="" />`
        : '';
      return `<section style="page:p${i};width:${page.width}pt;height:${page.height}pt">${background}${boxes[i]!.join('')}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<style>
${fonts}
${pageCss}
html, body { margin: 0; padding: 0; background: transparent; }
body { font-family: ${typography.bodyFont}; color: #111; }
section { position: relative; overflow: hidden; break-after: page; }
section:last-child { break-after: auto; }
.bg { position: absolute; inset: 0; width: 100%; height: 100%; }
.a { position: absolute; box-sizing: border-box; padding: 0 2pt; overflow: hidden; line-height: 1.2; white-space: pre-wrap; overflow-wrap: anywhere; display: flex; align-items: center; }
.a.tick { justify-content: center; align-items: center; padding: 0; }
.a.mark { align-items: flex-end; }
.a img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>
${sections}
</body>
</html>`;
}

async function answerHtml(
  deps: PaperDeps,
  field: Field,
  raw: unknown,
  anchor: PaperAnchor,
  page: Page,
  locales: LocaleConfig,
  locale: string,
  words: { yes: string; no: string },
): Promise<string | null> {
  switch (field.type) {
    case 'signature': {
      const bytes = typeof raw === 'string' ? await deps.uploadStore.get(raw) : null;
      if (!bytes) return null;
      return `<img src="data:image/png;base64,${bytes.toString('base64')}" alt="" />`;
    }
    case 'yes_no': {
      const yes = raw === true || raw === 'true';
      if (isTickBox(anchor, page)) return yes ? '✓' : null;
      return escapeHtml(yes ? words.yes : words.no);
    }
    case 'single_select':
    case 'multi_select': {
      const chosen = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const labels = chosen.map((value) => {
        const option = field.options.find((o) => o.value === value);
        return option ? pickText(locales, option.label, locale).value : value;
      });
      return escapeHtml(labels.join(', '));
    }
    case 'date': {
      const date = new Date(String(raw));
      return escapeHtml(
        Number.isNaN(date.getTime())
          ? String(raw)
          : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date),
      );
    }
    case 'number':
      return escapeHtml(
        typeof raw === 'number' ? new Intl.NumberFormat(locale).format(raw) : String(raw),
      );
    case 'file':
      // A filename would mean nothing on the paper, and the file itself cannot be drawn.
      return null;
    default:
      return escapeHtml(Array.isArray(raw) ? raw.join(', ') : String(raw));
  }
}

function styleFor(anchor: PaperAnchor, page: Page): string {
  return `left:${pct(anchor.x)};top:${pct(anchor.y)};width:${pct(anchor.w)};height:${pct(anchor.h)};font-size:${fontSize(anchor, page)}pt`;
}

/** The chosen options' own boxes, when every chosen option has one. */
function choicesWithBoxes(field: Field, raw: unknown): PaperAnchor[] {
  if (field.type !== 'single_select' && field.type !== 'multi_select') return [];
  const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  const found = values.map((value) => field.options.find((o) => o.value === value)?.paper);
  return found.every((box): box is PaperAnchor => box !== undefined) ? found : [];
}

function fontSize(anchor: PaperAnchor, page: Page): number {
  const height = anchor.h * page.height;
  return Math.max(6, Math.min(MAX_FONT_PT, Math.round(height * 0.7 * 10) / 10));
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The one pair of words this document needs in the respondent's language. */
const STRINGS: Record<string, { yes: string; no: string }> = {
  'en-GB': { yes: 'Yes', no: 'No' },
  'sv-SE': { yes: 'Ja', no: 'Nej' },
  'da-DK': { yes: 'Ja', no: 'Nej' },
  'nb-NO': { yes: 'Ja', no: 'Nei' },
  'fi-FI': { yes: 'Kyllä', no: 'Ei' },
  'is-IS': { yes: 'Já', no: 'Nei' },
  'de-DE': { yes: 'Ja', no: 'Nein' },
  'fr-FR': { yes: 'Oui', no: 'Non' },
  'es-ES': { yes: 'Sí', no: 'No' },
  'ru-RU': { yes: 'Да', no: 'Нет' },
  'ja-JP': { yes: 'はい', no: 'いいえ' },
  'zh-CN': { yes: '是', no: '否' },
};

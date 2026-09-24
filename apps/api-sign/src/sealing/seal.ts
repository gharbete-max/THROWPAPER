import {
  degrees,
  LineCapStyle,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { SignatureVector } from '@tp/shared/forms';
// The named class, not the default instance: the package is CommonJS, and Node's ESM loader
// hands a default import the whole `exports` object (vitest's interop does not, which hid it).
import { SignPdf } from '@signpdf/signpdf';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { createTranslator, resolveLocale, type Translator } from '@tp/i18n';
import { defaultTokens } from '@tp/tokens';
import type { Envelope, EnvelopeEvent } from '@tp/signing';
import type { Sealer } from './certificate.js';
import { signDetached } from './cms.js';
import { SEAL_LOCALES, sealMessages } from './messages.js';

export interface SealInput {
  /** The document exactly as it was sent for signing. */
  document: Uint8Array;
  /** Replayed from the trail, completed. */
  envelope: Envelope;
  events: readonly EnvelopeEvent[];
  declaration: { key: string; version: number };
  /** The hash of the trail's last event: the audit page commits to the whole chain through it. */
  trailSha256: string;
  sealedAt: Date;
}

/**
 * The sealed PDF: the document's pages, an audit page in each signer's language, a TEST MODE mark
 * on every page of a test envelope, and a PAdES seal over all of it.
 *
 * The seal is what makes a tampered byte detectable — by any validator, not just ours. The audit
 * page is what makes the file answer "who signed, how and when" on its own, if the database is
 * ever lost; the rows answer it if the file is (ADR 0009 § Sealing).
 */
export async function sealEnvelope(input: SealInput, sealer: Sealer): Promise<Uint8Array> {
  if (input.envelope.status !== 'completed') throw new Error('Only a completed envelope is sealed');

  const pdf = await PDFDocument.load(input.document, { updateMetadata: false });
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // One page per language the parties read, in party order: every signer can read the record of
  // what they did. Two parties whose languages fall back to the same catalogue share a page.
  const locales = [
    ...new Set(
      [...input.envelope.parties]
        .sort((a, b) => a.order - b.order)
        .map((party) => resolveLocale(SEAL_LOCALES, party.locale)),
    ),
  ];
  const first = createTranslator(SEAL_LOCALES, sealMessages, locales[0] ?? SEAL_LOCALES.default);
  const test = input.envelope.environment === 'test';
  // The document's own pages carry the first party's language; each audit page carries its own.
  if (test) {
    for (const page of pdf.getPages()) {
      watermark(page, fonts.bold, safe(fonts.bold, first('seal.watermark')));
    }
  }
  for (const locale of locales) {
    const t = createTranslator(SEAL_LOCALES, sealMessages, locale);
    const pages = drawAuditPages(pdf, fonts, t, input, sealer);
    if (test)
      for (const page of pages) watermark(page, fonts.bold, safe(fonts.bold, t('seal.watermark')));
  }

  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: safe(fonts.regular, first('seal.reason')),
    contactInfo: '',
    name: safe(fonts.regular, first('seal.product')),
    location: '',
    signingTime: input.sealedAt,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    signatureLength: 16_384,
    appName: 'Loppa Sign',
  });
  // Object streams would compress the signature dictionary out of reach of the byte-range search.
  const prepared = await pdf.save({ useObjectStreams: false });
  const sealed = await new SignPdf().sign(Buffer.from(prepared), new CmsSigner(sealer));
  return new Uint8Array(sealed);
}

class CmsSigner extends Signer {
  constructor(private readonly sealer: Sealer) {
    super();
  }

  override async sign(content: Buffer): Promise<Buffer> {
    return Buffer.from(await signDetached(new Uint8Array(content), this.sealer));
  }
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
/** The largest a drawn mark is shown on the audit page, in points. */
const MARK_BOX = { width: 200, height: 70 };
const BODY = 9;
const LINE = BODY * 1.45;

function colour(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const INK = colour(defaultTokens.colour.text);
const MUTED = colour(defaultTokens.colour.muted);
const RULE = colour(defaultTokens.colour.border);
const MARK = colour(defaultTokens.colour.danger);

/**
 * pdf-lib's standard fonts are WinAnsi: every Nordic and western European name fits, a Cyrillic or
 * CJK one would throw. Rather than fail a seal on a name, a character the font cannot draw is
 * printed as its code point — visibly, never dropped. The exact text is in the evidence rows and
 * the signed trail either way; an embedded Unicode font is a follow-up (it needs a dependency).
 */
export function safe(font: PDFFont, text: string): string {
  let out = '';
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/(\s+)/)) {
    const candidate = line + word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = word.trimStart();
    // A hash or a long name has no spaces: break it where it overflows.
    while (font.widthOfTextAtSize(line, size) > width) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

function utc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function drawAuditPages(
  pdf: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  t: Translator,
  input: SealInput,
  sealer: Sealer,
): PDFPage[] {
  const width = A4.width - MARGIN * 2;
  const added: PDFPage[] = [];
  const newPage = () => {
    const created = pdf.addPage([A4.width, A4.height]);
    added.push(created);
    return created;
  };
  let page = newPage();
  let y = A4.height - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed >= MARGIN) return;
    page = newPage();
    y = A4.height - MARGIN;
  };
  const text = (value: string, x: number, font: PDFFont, size: number, ink = INK) =>
    page.drawText(value, { x, y, size, font, color: ink });

  text(safe(fonts.bold, t('seal.title')), MARGIN, fonts.bold, 16);
  y -= 22;
  text(safe(fonts.regular, t('seal.product')), MARGIN, fonts.regular, BODY, MUTED);
  y -= LINE * 2;

  const { envelope } = input;
  const facts: [string, string][] = [
    [t('seal.document'), envelope.documentName],
    [t('seal.documentSha256'), envelope.documentSha256],
    [t('seal.envelope'), envelope.id],
    [
      t('seal.declaration'),
      t('seal.declarationVersion', {
        key: input.declaration.key,
        version: input.declaration.version,
      }),
    ],
    [t('seal.environment'), t(`seal.environment.${envelope.environment}`)],
    [t('seal.sealedAt'), `${utc(input.sealedAt.toISOString())} UTC`],
    [t('seal.certificate'), sealer.fingerprint],
    [t('seal.trail'), input.trailSha256],
  ];
  // Wide enough for the labels, narrow enough that a 64-character hash stays on one line.
  const labelWidth = 150;
  for (const [label, value] of facts) {
    const labelLines = wrap(fonts.bold, safe(fonts.bold, label), BODY, labelWidth - 8);
    const valueLines = wrap(fonts.regular, safe(fonts.regular, value), BODY, width - labelWidth);
    ensure(LINE * Math.max(labelLines.length, valueLines.length));
    const top = y;
    labelLines.forEach((line, index) => {
      y = top - index * LINE;
      text(line, MARGIN, fonts.bold, BODY);
    });
    valueLines.forEach((line, index) => {
      y = top - index * LINE;
      text(line, MARGIN + labelWidth, fonts.regular, BODY);
    });
    y = top - LINE * Math.max(labelLines.length, valueLines.length) - 3;
  }

  y -= LINE;
  ensure(LINE * 4);
  text(safe(fonts.bold, t('seal.events')), MARGIN, fonts.bold, 12);
  y -= LINE * 1.6;

  const columns = [
    { key: 'seal.column.time', x: 0, width: 95 },
    { key: 'seal.column.event', x: 95, width: 70 },
    { key: 'seal.column.party', x: 165, width: 130 },
    { key: 'seal.column.method', x: 295, width: width - 295 },
  ];
  const header = () => {
    for (const column of columns) {
      text(safe(fonts.bold, t(column.key)), MARGIN + column.x, fonts.bold, BODY);
    }
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + width, y },
      thickness: 0.5,
      color: RULE,
    });
    y -= LINE;
  };
  header();

  const partyName = (id: string | undefined) =>
    envelope.parties.find((party) => party.id === id)?.name ?? '';
  for (const event of input.events) {
    const cells = [
      utc(event.at),
      t(`seal.event.${event.type}`),
      'partyId' in event ? partyName(event.partyId) : '',
      event.type === 'signed' ? method(t, event.evidence) : '',
    ].map((cell, index) =>
      wrap(fonts.regular, safe(fonts.regular, cell), BODY, columns[index]!.width - 6),
    );
    const height = Math.max(...cells.map((lines) => lines.length));
    if (y - LINE * height < MARGIN) {
      page = newPage();
      y = A4.height - MARGIN;
      header();
    }
    const top = y;
    cells.forEach((lines, index) =>
      lines.forEach((line, row) => {
        y = top - row * LINE;
        text(line, MARGIN + columns[index]!.x, fonts.regular, BODY);
      }),
    );
    y = top - LINE * height - 2;
  }

  // Each signer's mark as they made it: the strokes of a drawn signature, the words of a typed one.
  const marks = input.events.filter(
    (event): event is Extract<EnvelopeEvent, { type: 'signed' }> => event.type === 'signed',
  );
  if (marks.length) {
    y -= LINE;
    ensure(LINE * 3);
    text(safe(fonts.bold, t('seal.marks')), MARGIN, fonts.bold, 12);
    y -= LINE * 1.6;
  }
  for (const event of marks) {
    const vector = drawnVector(event.evidence);
    ensure(LINE + (vector ? MARK_BOX.height : LINE) + LINE);
    text(safe(fonts.bold, partyName(event.partyId)), MARGIN, fonts.bold, BODY);
    y -= LINE;
    if (vector) {
      const scale = Math.min(MARK_BOX.width / vector.width, MARK_BOX.height / vector.height);
      page.drawRectangle({
        x: MARGIN,
        y: y - MARK_BOX.height,
        width: vector.width * scale,
        height: vector.height * scale,
        borderColor: RULE,
        borderWidth: 0.5,
      });
      // drawSvgPath's origin is the path's top-left, with y running down as in the pad.
      for (const path of vector.paths) {
        page.drawSvgPath(path, {
          x: MARGIN,
          y,
          scale,
          borderColor: INK,
          borderWidth: 1.2,
          borderLineCap: LineCapStyle.Round,
        });
      }
      y -= MARK_BOX.height + LINE;
    } else {
      const typed = event.evidence.details['typedName'] ?? '';
      // Drop by the larger size first: `drawText`'s y is the baseline, and 14pt rises into the label.
      y -= 14 - BODY;
      text(safe(fonts.regular, typed), MARGIN, fonts.regular, 14);
      y -= LINE * 2;
    }
  }
  return added;
}

/** The drawn strokes kept in a signature's evidence, or null for any other method. */
function drawnVector(
  evidence: Extract<EnvelopeEvent, { type: 'signed' }>['evidence'],
): Extract<SignatureVector, { kind: 'drawn' }> | null {
  if (evidence.method !== 'drawn' || !evidence.details['vector']) return null;
  const parsed = SignatureVector.safeParse(JSON.parse(evidence.details['vector']));
  return parsed.success && parsed.data.kind === 'drawn' ? parsed.data : null;
}

function method(
  t: Translator,
  evidence: Extract<EnvelopeEvent, { type: 'signed' }>['evidence'],
): string {
  if (evidence.method === 'typed') {
    return t('seal.method.typed', { name: evidence.details['typedName'] ?? '' });
  }
  if (evidence.method.startsWith('eid:')) {
    return t('seal.method.eid', { scheme: evidence.method.slice('eid:'.length) });
  }
  return t(`seal.method.${evidence.method}`);
}

function watermark(page: PDFPage, font: PDFFont, label: string): void {
  const { width, height } = page.getSize();
  const size = Math.min(width, height) / 7;
  const textWidth = font.widthOfTextAtSize(label, size);
  const angle = Math.atan2(height, width);
  page.drawText(label, {
    x: width / 2 - (Math.cos(angle) * textWidth) / 2 + (Math.sin(angle) * size) / 3,
    y: height / 2 - (Math.sin(angle) * textWidth) / 2 - (Math.cos(angle) * size) / 3,
    size,
    font,
    color: MARK,
    opacity: 0.18,
    rotate: degrees((angle * 180) / Math.PI),
  });
}

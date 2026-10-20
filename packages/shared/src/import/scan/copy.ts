import { straighten, type FoundLines } from './lines.js';

/**
 * The digital copy of a photographed page: lines and text only, on white, at the positions they
 * had in the photograph (`docs/plan/IMPROVEMENTS.md`, Track B). Built from what optical reading
 * says it read (words, boxes, confidence) and what {@link findLines} found; no model reads the
 * picture, and a word is never changed except by the person (`editWord`).
 *
 * Everything here is points on a page as wide as A4 and as tall as the photograph's proportions
 * make it, y down. The same model draws the review (`apps/forms`), the SVG, the plain text and,
 * on the server, the PDF (`apps/api-forms/src/pdf/copy.ts`).
 */

/** The part of an optical reading the copy needs: structurally `RecognisedWords` of `apps/forms`. */
export interface CopyInput {
  /** The picture's size in pixels. */
  width: number;
  height: number;
  lines: ReadonlyArray<{
    baseline: { x0: number; y0: number; x1: number; y1: number };
    rowHeight: number;
    words: ReadonlyArray<{
      text: string;
      /** 0–100. */
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }>;
}

export interface CopyWord {
  text: string;
  /** Left end and baseline, in points. */
  x: number;
  y: number;
  /** Width the word had in the photograph, in points. */
  w: number;
  /** Font size, in points. */
  size: number;
  /** Which row of text it is on, in reading order. */
  row: number;
  /** 0–100; 100 once the person has fixed the word. */
  confidence: number;
  edited?: true;
}

export interface CopyLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** In points. */
  width: number;
}

export interface DigitalCopy {
  widthPt: number;
  heightPt: number;
  lines: CopyLine[];
  words: CopyWord[];
}

/** A page as wide as A4. */
export const COPY_WIDTH_PT = 595;
/** A word read with less confidence than this is shown as uncertain (`docs/archive/plan/SCANS.md`). */
export const LOW_CONFIDENCE = 75;
/** The share of a row's height (ascender to descender) that is the font size. */
const SIZE_OF_ROW = 0.9;

const round = (value: number) => Math.round(value * 100) / 100;

export function isUncertain(word: CopyWord): boolean {
  return word.confidence < LOW_CONFIDENCE;
}

export function digitalCopy(
  read: CopyInput,
  found: FoundLines | null,
  widthPt: number = COPY_WIDTH_PT,
): DigitalCopy {
  const scale = widthPt / read.width;
  const heightPt = round((widthPt * read.height) / read.width);

  /** A point of the photograph, with the sheet's turn taken out, in reading pixels. */
  const upright = (x: number, y: number) => {
    if (!found || found.skew === 0) return { x, y };
    const fx = (found.width / read.width) * x;
    const fy = (found.height / read.height) * y;
    const moved = straighten(fx, fy, found, found.skew);
    return { x: (moved.x * read.width) / found.width, y: (moved.y * read.height) / found.height };
  };

  const words: CopyWord[] = [];
  let row = 0;
  for (const line of read.lines) {
    const { baseline } = line;
    const run = baseline.x1 - baseline.x0;
    const slope = run === 0 ? 0 : (baseline.y1 - baseline.y0) / run;
    const size = Math.max(4, line.rowHeight * scale * SIZE_OF_ROW);
    let any = false;
    for (const word of line.words) {
      const text = word.text.trim();
      if (text === '') continue;
      const middle = (word.bbox.x0 + word.bbox.x1) / 2;
      const at = upright(word.bbox.x0, baseline.y0 + slope * (middle - baseline.x0));
      words.push({
        text,
        x: round(at.x * scale),
        y: round(at.y * scale),
        w: round((word.bbox.x1 - word.bbox.x0) * scale),
        size: round(size),
        row,
        confidence: Math.min(100, Math.max(0, Math.round(word.confidence))),
      });
      any = true;
    }
    if (any) row += 1;
  }

  const lines: CopyLine[] = (found?.lines ?? []).map((line) => {
    const sx = widthPt / found!.width;
    const sy = heightPt / found!.height;
    const width = round(Math.min(3, Math.max(0.5, line.thick * sx)));
    return line.dir === 'h'
      ? {
          x1: round(line.from * sx),
          y1: round(line.at * sy),
          x2: round(line.to * sx),
          y2: round(line.at * sy),
          width,
        }
      : {
          x1: round(line.at * sx),
          y1: round(line.from * sy),
          x2: round(line.at * sx),
          y2: round(line.to * sy),
          width,
        };
  });

  return { widthPt, heightPt, lines, words };
}

/** The same copy with one word fixed by the person: certain from then on, and marked as theirs. */
export function editWord(copy: DigitalCopy, index: number, text: string): DigitalCopy {
  const trimmed = text.trim();
  const word = copy.words[index];
  if (!word || trimmed === '' || trimmed === word.text) return copy;
  const words = copy.words.slice();
  words[index] = { ...word, text: trimmed, confidence: 100, edited: true };
  return { ...copy, words };
}

/** The indexes of the words the reader was unsure of, in reading order. */
export function uncertainWords(copy: DigitalCopy): number[] {
  return copy.words.flatMap((word, index) => (isUncertain(word) ? [index] : []));
}

/**
 * The words as plain text: a row to a line, words in a row left to right, a tab where the page has
 * a wide gap (columns), a blank line where the page has a paragraph's space.
 */
export function copyText(copy: DigitalCopy): string {
  const rows = new Map<number, CopyWord[]>();
  for (const word of copy.words) {
    const row = rows.get(word.row);
    if (row) row.push(word);
    else rows.set(word.row, [word]);
  }
  const out: string[] = [];
  let before: CopyWord | undefined;
  for (const words of [...rows.values()]) {
    words.sort((a, b) => a.x - b.x);
    const first = words[0]!;
    if (before && first.y - before.y > before.size * 1.8) out.push('');
    before = first;
    let line = '';
    let end = first.x;
    for (const word of words) {
      if (line !== '') line += word.x - end > word.size * 3 ? '\t' : ' ';
      line += word.text;
      end = word.x + word.w;
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface SvgStyle {
  /** The colour of lines and text, and of the paper; a CSS colour each. */
  ink: string;
  paper: string;
  /** A CSS font-family. */
  font: string;
}

/** Text in an XML document: the five characters, and no control character an XML file cannot hold. */
export function xmlText(text: string): string {
  const allowed = (char: string) => {
    const code = char.charCodeAt(0);
    return code >= 0x20 || code === 9 || code === 10 || code === 13;
  };
  return [...text]
    .filter(allowed)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The copy as a standalone SVG file: white paper, lines, and every word as text. */
export function copySvg(copy: DigitalCopy, style: SvgStyle): string {
  const lines = copy.lines
    .map(
      (l) =>
        `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${l.width}"/>`,
    )
    .join('\n');
  const words = copy.words
    .map(
      (w) =>
        `<text x="${w.x}" y="${w.y}" font-size="${w.size}" textLength="${Math.max(1, w.w)}" lengthAdjust="spacingAndGlyphs">${xmlText(w.text)}</text>`,
    )
    .join('\n');
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${copy.widthPt}pt" height="${copy.heightPt}pt" viewBox="0 0 ${copy.widthPt} ${copy.heightPt}">`,
    `<rect width="100%" height="100%" fill="${xmlText(style.paper)}"/>`,
    `<g stroke="${xmlText(style.ink)}" stroke-linecap="square" fill="none">`,
    lines,
    `</g>`,
    `<g fill="${xmlText(style.ink)}" font-family="${xmlText(style.font)}">`,
    words,
    `</g>`,
    `</svg>`,
    '',
  ].join('\n');
}

/** What the server draws a PDF from. */
export function pdfRequestOf(copy: DigitalCopy, mode: 'copy' | 'searchable') {
  return {
    mode,
    widthPt: copy.widthPt,
    heightPt: copy.heightPt,
    lines: copy.lines,
    words: copy.words.map(({ text, x, y, size }) => ({ text, x, y, size })),
  };
}

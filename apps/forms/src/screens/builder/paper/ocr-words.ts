import { CHECKBOX_GLYPHS, type RawDocument, type RawWord } from '@tp/shared/import';
import { toIu } from './units.js';

/** Tesseract's name for each interface language. Keep in step with `scripts/ocr-assets.ts`. */
const TESS_LANG: Record<string, string> = {
  'sv-SE': 'swe',
  'da-DK': 'dan',
  'nb-NO': 'nor',
  'fi-FI': 'fin',
  'is-IS': 'isl',
  'de-DE': 'deu',
  'fr-FR': 'fra',
  'es-ES': 'spa',
  'ru-RU': 'rus',
  'ja-JP': 'jpn',
  'zh-CN': 'chi_sim',
};

/** English always, because a Swedish sheet has English headings more often than not. */
export function tessLangs(locale: string): string[] {
  const own = TESS_LANG[locale];
  return own ? ['eng', own] : ['eng'];
}

/**
 * A page is read as a picture with its longer side this many pixels at most: A4 at about 250 dots
 * an inch, where Tesseract reads print best. A smaller photograph is read at its own size.
 */
export const READ_LONG_SIDE = 3000;

/** A box or a baseline in pixels: its left and top end, then its right and bottom. */
type Corners = { x0: number; y0: number; x1: number; y1: number };

/**
 * A page read word by word — the part of a Tesseract result stage 1 reads (`docs/plan/SCANS.md`).
 * Our own shape, so an upgrade lands here: each line's words, its baseline and its height.
 */
export interface RecognisedWords {
  /** The image's size, in pixels. */
  width: number;
  height: number;
  /** What read it, for the raw document's `extractor`: "Tesseract 5.5.0". */
  engine: string;
  lines: Array<{
    /** The line's baseline, from its left end to its right, in pixels. */
    baseline: Corners;
    /** The line's height, ascenders to descenders, in pixels. */
    rowHeight: number;
    words: Array<{
      text: string;
      /** Tesseract's 0–100, a float. */
      confidence: number;
      bbox: Corners;
      /** Each character's own box, where Tesseract gave them: how a box read into a word is found. */
      symbols?: Array<{ text: string; bbox: Corners }>;
    }>;
  }>;
}

/** The part of `tesseract.js`'s result, read with `{ blocks: true }`, that `recognisedFrom` reads. */
export interface TesseractPage {
  version: string;
  blocks: Array<{
    paragraphs: Array<{
      lines: Array<{
        baseline: Corners;
        rowAttributes: { rowHeight: number };
        words: Array<{
          text: string;
          confidence: number;
          bbox: Corners;
          symbols: Array<{ text: string; bbox: Corners }> | null;
        }>;
      }>;
    }>;
  }> | null;
}

/**
 * Tesseract's result as a page read word by word: the same in the browser (`openPageReader`) and in
 * Node (`scripts/corpus/scan.ts`), so a frozen scan is read by exactly what the review screen reads.
 */
export function recognisedFrom(
  data: TesseractPage,
  size: { width: number; height: number },
): RecognisedWords {
  return {
    ...size,
    engine: `Tesseract ${data.version}`,
    lines: (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.map((line) => ({
          baseline: line.baseline,
          rowHeight: line.rowAttributes.rowHeight,
          words: line.words.map(({ text, confidence, bbox, symbols }) => ({
            text,
            confidence,
            bbox,
            symbols: (symbols ?? []).map((symbol) => ({ text: symbol.text, bbox: symbol.bbox })),
          })),
        })),
      ),
    ),
  };
}

/** The box `ocrWords` writes for a printed box OCR read as a mark: the first of stage 2's glyphs. */
export const BOX = [...CHECKBOX_GLYPHS][0]!;

/**
 * What Tesseract reads a printed square box as, having none among its characters (`SCANS.md`, B1).
 * Seen in the corpus's scans: "[", "0", and "[J", the box's left side and its right read as two.
 * Punctuation that is never square as printed — a bracket, a bar, a parenthesis — read in a square
 * is not itself, alone or stuck to the word after it ("[Ja"). A zero or an O only alone: either may
 * begin a word. Never a letter at the start of a word: Tesseract's box for one character of a word
 * can take in the next ("lä" in "lämna" came back as one square "l").
 */
const MARKS = ['[', ']', '|', '(', ')'];
/** Read alone as a word. */
const READ_AS_BOX_ALONE = new Set([...MARKS, '0', 'O']);
/** Read stuck to the word after it. */
const READ_AS_BOX_FIRST = new Set([...MARKS, ...CHECKBOX_GLYPHS]);
const isGlyph = (text: string) => [...text].length === 1 && CHECKBOX_GLYPHS.includes(text);

/**
 * Whether a mark is the shape of a printed box (B1): square, its width within a fifth of its
 * height either way, and at least half as tall as its line. A digit zero is about half as wide as
 * it is tall, a bracket a quarter, and a small o is half a line high; a box is none of them.
 */
export function boxShaped(bbox: Corners, rowHeight: number): boolean {
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  if (width <= 0 || height <= 0) return false;
  const shape = Math.round((width * 1000) / height);
  return shape >= 800 && shape <= 1250 && height * 2 >= rowHeight;
}

/**
 * Stage 1's words from a page read by OCR (`IMPORT-PIPELINE.md` stage 1, S14). Geometry becomes the
 * IR's integer units here, once, as `runWords` does for a PDF's text layer:
 * - each word's box;
 * - its baseline, where the line's baseline passes under its middle, so a tilted line keeps
 *   its words on it;
 * - the font size, which is the line's height.
 *
 * The confidence is rounded to an integer 0–100, for stage 7's OCR cap. The weight is 400 and
 * nothing is italic: Tesseract's guesses at either are not sure enough to make a heading of.
 * Words that are only whitespace are no words.
 *
 * **B1, a printed box.** A mark Tesseract read as a bracket, a bar, a parenthesis, a zero or an
 * O, that is the shape of a box (see {@link boxShaped}), is one: it is written as ☐, the repair
 * recording what was read (`box-mark`), so stages 2 to 7 read it as they read a box in a PDF's
 * text. A box read stuck to the next word ("[Ja") is split from it at its own character's box,
 * and characters read inside that box ("[J") are the box's own sides, not a word.
 */
export function ocrWords(result: RecognisedWords): RawWord[] {
  const words: RawWord[] = [];
  for (const line of result.lines) {
    const { baseline } = line;
    const run = baseline.x1 - baseline.x0;
    const slope = run === 0 ? 0 : (baseline.y1 - baseline.y0) / run;
    const fontSize = Math.max(1, toIu(line.rowHeight, result.height));
    const push = (text: string, bbox: Corners, confidence: number, read: string | null) => {
      const middle = (bbox.x0 + bbox.x1) / 2;
      words.push({
        text,
        box: {
          x0: toIu(bbox.x0, result.width),
          y0: toIu(bbox.y0, result.height),
          x1: toIu(bbox.x1, result.width),
          y1: toIu(bbox.y1, result.height),
        },
        baseline: toIu(baseline.y0 + slope * (middle - baseline.x0), result.height),
        fontSize,
        fontWeight: 400,
        italic: false,
        ocrConfidence: Math.min(100, Math.max(0, Math.round(confidence))),
        repair: read === null ? null : { kind: 'box-mark', raw: read },
        source: 'ocr',
        paragraph: null,
        docxNumbering: null,
        cell: null,
      });
    };
    for (const word of line.words) {
      const text = word.text.trim();
      if (text === '' || /\s/u.test(text)) continue;
      if (READ_AS_BOX_ALONE.has(text) && boxShaped(word.bbox, line.rowHeight)) {
        push(BOX, word.bbox, word.confidence, text);
        continue;
      }
      const [first, ...others] = word.symbols ?? [];
      if (
        first &&
        others.length > 0 &&
        READ_AS_BOX_FIRST.has(first.text) &&
        text.startsWith(first.text) &&
        boxShaped(first.bbox, line.rowHeight)
      ) {
        // What was read inside the box, its middle within the box's sides, is the box.
        const inside = (symbol: (typeof others)[number]) =>
          symbol.bbox.x0 + symbol.bbox.x1 < first.bbox.x1 * 2;
        let marks = 1;
        while (marks <= others.length && inside(others[marks - 1]!)) marks += 1;
        const mark = word
          .symbols!.slice(0, marks)
          .map((symbol) => symbol.text)
          .join('');
        const rest = others.slice(marks - 1);
        // A box glyph Tesseract did read is kept as it is; only its word is split.
        const glyph = marks === 1 && isGlyph(first.text);
        push(glyph ? first.text : BOX, first.bbox, word.confidence, glyph ? null : mark);
        const after = text.startsWith(mark) ? text.slice(mark.length).trim() : '';
        if (after !== '' && rest.length > 0) {
          push(
            after,
            {
              x0: Math.min(...rest.map((symbol) => symbol.bbox.x0)),
              y0: Math.min(...rest.map((symbol) => symbol.bbox.y0)),
              x1: Math.max(...rest.map((symbol) => symbol.bbox.x1)),
              y1: Math.max(...rest.map((symbol) => symbol.bbox.y1)),
            },
            word.confidence,
            null,
          );
        }
        continue;
      }
      push(text, word.bbox, word.confidence, null);
    }
  }
  return words;
}

/** A4's width in points: a photograph's page is drawn this wide, at its own proportions. */
export const PHOTO_WIDTH_PT = 595;

/**
 * A photograph as stage 1's raw document (S14): one page, its words read by OCR, as wide as A4
 * and as tall as its own proportions make it. It has no printed rules: what was drawn on the
 * paper is pixels, not lines.
 */
export function photoDocument(recognised: RecognisedWords, sha256: string): RawDocument {
  return {
    irVersion: 1,
    source: { kind: 'image', extractor: recognised.engine, sha256 },
    pages: [
      {
        pageNo: 1,
        widthPt: PHOTO_WIDTH_PT,
        heightPt: Math.max(1, Math.round((PHOTO_WIDTH_PT * recognised.height) / recognised.width)),
        words: ocrWords(recognised),
        rules: [],
      },
    ],
  };
}

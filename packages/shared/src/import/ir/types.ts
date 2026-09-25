/**
 * The Layout IR, `irVersion: 1` — copied from `docs/plan/LAYOUT-IR.md`, which is the contract.
 *
 * A change to any type here is a new `irVersion`, a note in `docs/adr/0018-document-import.md` and a
 * migration of every fixture in `fixtures/`; `schema.ts` is typed against these interfaces, so the
 * schema cannot drift from them without failing the typecheck.
 */

/** An integer in [0, 10000]: 1/10 000 of the page width (x) or height (y). */
export type Iu = number;

/** A rectangle. x0 ≤ x1 and y0 ≤ y1; y grows downward. */
export interface Box {
  x0: Iu;
  y0: Iu;
  x1: Iu;
  y1: Iu;
}

/** Where a word's text came from. Decides which rules may apply (NUMBERING-RULES P3, for one). */
export type IrSource = 'text-layer' | 'ocr' | 'docx' | 'paste';

/**
 * A layout repair applied to a word, with what it was before. Never a change of wording.
 *
 * - `dehyphenated`: a word split across a line break with a hyphen, joined and the hyphen
 *   removed ("regis-" + "tering" → "registering").
 * - `joined-at-break`: the same join, hyphen kept, because it belongs to the word ("e-" + "post"
 *   → "e-post", "Stockholm-" + "Göteborg" → "Stockholm-Göteborg").
 * - `ligature`: a presentation-form ligature expanded (U+FB00–U+FB06 only: ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ).
 */
export interface Repair {
  kind: 'dehyphenated' | 'joined-at-break' | 'ligature';
  /** The text exactly as extracted, before the repair; a line break inside it is "\n". */
  raw: string;
}

export interface IrWord {
  /** Verbatim, apart from the repairs recorded in `repair`. Never case-folded, never trimmed. */
  text: string;
  /** UTF-16 offset of this word in its line's `text`. Strictly increasing within a line. */
  start: number;
  box: Box;
  /** y of the baseline. */
  baseline: Iu;
  /** Em height, in iu of the page height. */
  fontSize: Iu;
  /** 700 when the source marks the word bold or its weight is ≥ 600; otherwise 400. */
  fontWeight: 400 | 700;
  italic: boolean;
  /** 0–100, integer, from the OCR engine. `null` for every source other than `ocr`. */
  ocrConfidence: number | null;
  repair: Repair | null;
}

/** Facts about a line that the extractor or reassembler knows for certain. Never guesses. */
export interface LineHints {
  /** Contains ≥ 3 consecutive `_`, or ≥ 4 consecutive `.` / `…`-equivalent leader dots. */
  blankRun: boolean;
  /** Count of checkbox glyphs: ☐ ☑ ☒ □ ■ ▢ ○ ● ◯ ◻ ◼. */
  checkboxes: number;
  /** The line's text, trimmed, ends with `:` (after removing any blank run). */
  endsWithColon: boolean;
  /**
   * A horizontal rule drawn at or under the line's baseline and extending ≥ 20% of the column
   * width beyond the line's last word — a printed answer line. Text layer only, from the page's
   * vector drawing operations; always `false` for `ocr`, `docx` and `paste`.
   */
  ruleBelow: boolean;
  /** DOCX only: Word's own numbering for this paragraph, from `numbering.xml`. */
  docxNumbering: DocxNumbering | null;
}

export interface DocxNumbering {
  numId: number;
  /** 0-based list level (`w:ilvl`). */
  ilvl: number;
  /** The marker Word would render, e.g. "12.1." — computed from `w:lvlText` and the counters. */
  rendered: string;
  /** `w:numFmt`: decimal, lowerRoman, upperRoman, lowerLetter, upperLetter, bullet, … */
  format: string;
}

/** DOCX tables only (`w:tbl`): the cell a line or word sits in. */
export interface Cell {
  row: number;
  col: number;
}

export interface IrLine {
  /** `p{pageNo}-l{n}`, n 1-based in the page's reading order. */
  id: string;
  /** 1-based. */
  pageNo: number;
  /** 0-based index into the page's `columns`. */
  columnIndex: number;
  blockId: string;
  /**
   * The words, joined by exactly one U+0020 between consecutive words. No leading or trailing
   * whitespace. `text.slice(w.start, w.start + w.text.length) === w.text` for every word.
   */
  text: string;
  /** Non-empty, in reading order (left to right for every locale this product ships). */
  words: IrWord[];
  /** The union of the words' boxes. */
  box: Box;
  /** The median of the words' baselines; for an even count, the smaller of the two middle values. */
  baseline: Iu;
  /** The median of the words' font sizes; for an even count, the smaller of the two middle values. */
  fontSize: Iu;
  /** 700 when every word is 700. */
  fontWeight: 400 | 700;
  /** Index into its column's `bands` — see "Indent bands". */
  indentBand: number;
  source: IrSource;
  /** The minimum of the words' `ocrConfidence`; `null` unless `source` is `ocr`. */
  ocrConfidence: number | null;
  hints: LineHints;
  /** DOCX tables only (`w:tbl`): the cell this line sits in. `null` everywhere else. */
  cell: Cell | null;
}

export type BlockRole = 'body' | 'heading' | 'page-furniture' | 'footnote' | 'table';

export interface IrBlock {
  /** `p{pageNo}-b{n}`, n 1-based in the page's reading order. */
  id: string;
  pageNo: number;
  columnIndex: number;
  role: BlockRole;
  box: Box;
  /** Non-empty, top to bottom (ascending baseline). */
  lines: IrLine[];
}

/**
 * A column region: a rectangle of the page read top to bottom as one column.
 *
 * A region rather than a full-height strip, because a page can change layout part way down — a
 * full-width introduction over two columns of questions (`layout-shift-within-document`) is three
 * regions: one across the top, two side by side below it.
 */
export interface IrColumn {
  /** 0-based, in reading order: regions top to bottom, side-by-side regions left to right. */
  index: number;
  x0: Iu;
  x1: Iu;
  y0: Iu;
  y1: Iu;
  /** Ascending. Each is the smallest line x0 in its band. See "Indent bands". */
  bands: Iu[];
}

export interface IrPage {
  /** 1-based. */
  pageNo: number;
  /** The page's size in points, rounded to integers. Informational: nothing compares these. */
  widthPt: number;
  heightPt: number;
  /** In reading order. A page with no detected columns has one region spanning its text area. */
  columns: IrColumn[];
  /** In reading order. */
  blocks: IrBlock[];
}

export interface IrSourceInfo {
  kind: 'pdf' | 'image' | 'docx' | 'paste';
  /** Which adapter produced it and its version, e.g. "pdfjs-dist@6.3.289". */
  extractor: string;
  /** Hex SHA-256 of the source bytes; `null` for paste. */
  sha256: string | null;
}

export interface LayoutDocument {
  irVersion: 1;
  source: IrSourceInfo;
  /** The document's own language, BCP 47, when stage 2 is sure of it; otherwise `null`. */
  locale: string | null;
  pages: IrPage[];
}

/** Stage 1's output: words with geometry, in whatever order the source gave them. */
export interface RawWord extends Omit<IrWord, 'start'> {
  source: IrSource;
  /** DOCX and paste only: the paragraph (or pasted line) this word came from, 0-based. */
  paragraph: number | null;
  /** DOCX only, on the paragraph's first word. */
  docxNumbering: DocxNumbering | null;
  /** DOCX only: the table cell, as on `IrLine`. */
  cell: Cell | null;
}

export interface RawPage {
  pageNo: number;
  widthPt: number;
  heightPt: number;
  words: RawWord[];
  /** Horizontal rules from the page's vector graphics (text layer only), for `ruleBelow`. */
  rules: Box[];
}

export interface RawDocument {
  irVersion: 1;
  source: IrSourceInfo;
  pages: RawPage[];
}

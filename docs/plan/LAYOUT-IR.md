# Layout IR — the frozen input contract for everything after extraction

**Status:** frozen at `irVersion: 1` (proposed with the plan set, 2026-09-25). A change to any type
below is a new `irVersion`, a note in `docs/adr/0018-document-import.md`, and a migration of every
fixture in `fixtures/`. Nothing else in the import pipeline is allowed to see a PDF, a DOCX or a
photograph: it sees this.

**Read with:** `NUMBERING-RULES.md` (the first consumer), `IMPORT-PIPELINE.md` (who produces it),
`CAVEATS.md` §8.2 (the geometry traps it exists to make testable).

## Why this exists before any code

The numbering detector is the highest-risk module in the project (`CAVEATS.md` §8.1). If its input
were "whatever pdf.js returned", every test of it would be a PDF, every PDF would be a binary blob
nobody can read in a diff, and every fixture would silently change when pdf.js changed how it
splits a text run. So the detector's input is a small, plain, integer-only JSON document that a
person can write by hand, and the fixtures in `fixtures/numbering/` are written in it. That is what
makes slice S1b (`ROADMAP.md`) possible with **no PDF parsing at all**.

## Two layers

| Layer | Type | Produced by | Consumed by |
| --- | --- | --- | --- |
| Raw | `RawDocument` | stage 1, **extract** (one adapter per source) | stage 2, **reassemble** |
| Layout | `LayoutDocument` | stage 2, **reassemble** | stages 3–7 (enumerate, segment, classify, overlay, score) |

A raw document is words with geometry and nothing else: no reading order, no lines, no columns.
A layout document is the same words, grouped, ordered and annotated. Both are part of this
contract, because the reassemble fixtures (`two-column-order`, `repeated-header-footer`,
`hyphenated-line-break`, `ligature-and-quote-repair`, `layout-shift-within-document`) take a raw
document in and assert a layout document out.

## Units: integers, page-relative

Every coordinate and size is an **integer in IR units (iu)**: one iu is 1/10 000 of the page's
width (for x) or height (for y). The top-left corner is `(0, 0)`, the bottom-right `(10000, 10000)`,
and y grows downward, as it does on a screen and in `PaperAnchor`.

- **Integers, not fractions,** so every comparison in the detector is exact and the same on every
  machine (`CAVEATS.md` #38 `determinism`). A tolerance such as "2% of the column width" is written
  `|dx| × 50 ≤ columnWidth`, never `|dx| ≤ 0.02 × columnWidth`.
- **Page-relative,** so the same document gives the same IR whether it was rendered at 72 dpi or
  photographed by a phone, and so a list that continues onto page 2 lines up with itself.
- **Converting** from a source is `Math.round(value / pageDimension × 10000)`, clamped to
  `[0, 10000]`, done exactly once, in the extract adapter. `PaperAnchor` (the fraction the overlay
  already stores) is `iu / 10000`.
- **Font size** is the em height in iu of the page height. 11 pt on A4 (842 pt tall) is 131 iu.

## The types

These are the definitions slice S1b copies into `packages/shared/src/import/ir/` (the package is
§14 question 1 in `PREDICTIVE-BUILDER.md`; the types do not depend on the answer).

```ts
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
  cell: { row: number; col: number } | null;
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
  cell: { row: number; col: number } | null;
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
```

## Invariants

A layout document that breaks one of these is rejected by the IR validator — `layoutProblems`
and `parseLayoutDocument` in `@tp/shared/import` (`packages/shared/src/import/ir/`), with one
broken document per invariant in its test; `rawProblems` checks the raw layer. It runs over every
fixture and sample in `scripts/caveat-fixtures.test.ts`, and the structure (types, ranges, no
unknown keys) is a Zod schema typed against the interfaces above:

1. Every `Iu` is an integer in `[0, 10000]`; every box has `x0 ≤ x1` and `y0 ≤ y1`.
2. Ids are unique across the document and match their pattern; `line.blockId` is its block's id;
   `line.pageNo`, `block.pageNo` and `page.pageNo` agree; `pageNo` runs 1, 2, 3… with no gaps.
3. `line.text` equals its words' texts joined by single spaces, and each `word.start` points at
   its word.
4. `line.indentBand < columns[line.columnIndex].bands.length`, and the line's `box.x0` lies in
   that band (see below).
5. `ocrConfidence` is `null` unless the source is `ocr`, in which case it is an integer 0–100.
6. `source` is the same on every word of a line, and equals the line's. (A layout word carries
   no `source` of its own, so in a layout document this holds by construction; it binds stage 2,
   which must not join raw words of different sources into one line.)
7. A line's derived fields are what their definitions say: `box` is the union of its words'
   boxes, `baseline` and `fontSize` the lower medians of its words', `fontWeight` 700 exactly
   when every word is, `ocrConfidence` the least of its words'. Ids are numbered 1, 2, 3… in the
   page's reading order, and a block's lines never go up the page. (The detector reads `box.x0`
   and `fontSize` of the line, not of its words, so a hand-written line that disagrees with its
   words would test a document no extractor can produce.)
8. Facts only one source can know stay with it: `ruleBelow` only on `text-layer` lines,
   `docxNumbering` and `cell` only on `docx` lines, and in the raw layer `paragraph` only on
   `docx` and `paste` words.

## Reading order

The document's reading order is `pages[]` in order, then `blocks[]` in order, then `lines[]` in
order. Consumers **never re-sort**. Deciding the order is stage 2's job (`IMPORT-PIPELINE.md` §2,
column-aware), and a consumer that re-sorts by y interleaves two columns — `two-column-order`.

## Indent bands

A band is a cluster of line starts that a reader would call "the same indent". Stage 2 computes
them per page and per column, exactly like this, and every consumer reads them rather than
re-deriving them:

1. Take `box.x0` of every line in the column whose block role is `body`, `heading` or `table`.
2. Sort ascending. Walk the sorted values; the first value opens band 0. A value `x` joins the
   current band when `(x − bandStart) × 50 ≤ (column.x1 − column.x0)` — within 2% of the column
   width of the band's **first** value. Otherwise it opens the next band.
3. A band's position is its first (smallest) value. `bands` lists positions ascending.
4. `page-furniture` and `footnote` lines are given the band their `x0` falls in, or band 0 if it
   falls in none; they never create one.

Measuring from the band's first value rather than chaining neighbour to neighbour is deliberate: a
chain lets three lines each 1.5% apart become one band 3% wide, and then a nested list merges
with its parent.

## How each source fills it

| Field | `text-layer` (PDF) | `ocr` (photo, scanned PDF) | `docx` | `paste` |
| --- | --- | --- | --- | --- |
| word boxes | from pdf.js runs, split at spaces; a run's width is shared out by character count | from Tesseract's word boxes | synthetic (below) | synthetic (below) |
| fontSize, weight | pdf.js font metrics | box height; weight 400 | the run's `w:sz`, `w:b` | 131, 400 |
| ocrConfidence | `null` | Tesseract word confidence, rounded | `null` | `null` |
| ruleBelow | vector ops | `false` | `false` | `false` |
| docxNumbering | `null` | `null` | from `numbering.xml` | `null` |
| soft line wraps | yes | yes | **no**: one paragraph is one line | **no**: one pasted line is one line |

**Synthetic geometry** (DOCX and paste) puts each paragraph or pasted line on a virtual A4 page:
the text area is x 1000–9000, the first baseline is at y 1000 and each next line is 180 iu lower,
a new page starts after y 9000, the font size is 131, and each character advances 92 iu. A
paragraph's x0 is `1000 + indent`, where the indent is the paragraph's own `w:ind` (left minus
hanging, twips → iu of an A4 width) for DOCX, and 92 iu per leading space (a tab is four spaces)
for paste. A tab inside a pasted line advances to the next multiple of 368 iu from x0. Blank
pasted lines separate blocks.

Synthetic geometry is honest about being synthetic: it carries exactly what the source said
(indentation, order, paragraph breaks), and the rules that depend on real geometry — soft wraps,
first of all — are switched off for these sources by the source field, not by guessing.

## The hand-authored samples

Three complete layout documents, validated by the same test as the fixtures:

- `fixtures/ir/single-column.ir.json` — one column, a numbered list whose first item wraps onto a
  second line that begins with `12.1` (the §8.1.1 trap in its hardest form).
- `fixtures/ir/two-column.ir.json` — a page in two columns, a numbered list running from the
  bottom of the left column to the top of the right one, and a running header marked
  `page-furniture`.
- `fixtures/ir/checkbox-grid.ir.json` — a question with a matrix of checkboxes under a header row
  (Ja / Nej / Vet ej), then a single-row yes/no question.

Fixture geometry uses the synthetic metrics above even for `text-layer` samples (92 iu per
character, 180 iu per line), so a person can add a fixture with a ruler and a text editor. Real
documents enter through the corpus (`IMPORT-PIPELINE.md` §10), where geometry comes from the
extractor.

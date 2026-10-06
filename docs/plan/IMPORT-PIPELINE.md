# The import pipeline — paper in, a draft out

**Status:** the specification for slices S7–S10 and S12 (S1b builds stage 3 early), proposed
2026-09-25. Decisions: ADR 0018 (document import), ADR 0019 (deterministic rules), ADR 0021 (JSON
data). The detector's own procedure is `NUMBERING-RULES.md`; the contract between stages is
`LAYOUT-IR.md`; the traps are `CAVEATS.md`.

## Shape

```
bytes ──1 extract──▶ RawDocument ──2 reassemble──▶ LayoutDocument ──3 enumerate──▶ items
                                                         │                            │
                                                         └────────4 segment◀──────────┘
                                                                     │
                              5 classify ──▶ 6 map + paper twin ──▶ 7 score + bucket
                                                                     │
                                                    8 review screen (never skipped)
                                                                     │
                                                               draft + sidecar
                                                     (9: the same, against a previous import)
```

- **Every stage is a pure function** of plain objects: `(input, options) → { output, debug }`. No
  DOM, no I/O, no clock, no randomness; options are data (weights, caps), never callbacks.
- **Stage 1 is the only stage that touches bytes**, and it lives in `apps/forms`
  (`screens/builder/paper/`), where pdf.js and Tesseract are already lazy-loaded and run in the
  author's browser — ADR 0004's rule that the server never parses a stranger's file stands.
  Stages 2–7 live in `@tp/shared/import` and run in a Web Worker (`import.worker.ts`). The desktop
  app loads the same bundle, so it runs the same worker: parity by construction.
- **Every stage emits a debug artifact** (below) that a test can snapshot.

## Caps

A document is untrusted input from outside. These are refused before any parsing, with a message
that says which limit and what to do:

| Limit | Value | Where from |
| --- | --- | --- |
| file size | 10 MB | the existing attachment cap (ADR 0004) |
| pages | 20 | `MAX_PAPER_PAGES` |
| DOCX zip entries | 200 | this plan |
| DOCX decompressed total | 20 MB, counted while inflating; stop at the limit | this plan (a zip bomb stops here) |
| XML nesting depth | 64 | this plan |
| XML DTD or entity declarations | refused outright | this plan (no XXE, no billion laughs) |
| pasted text | 200 000 characters | this plan |
| time | 4 s for 20 pages on a laptop (`CAVEATS.md` #42); a 30 s hard stop in the worker | the brief |

## Stage 1 — extract

Each adapter produces a `RawDocument` (`LAYOUT-IR.md`), converting geometry to integer iu exactly
once.

**PDF, text layer** (`paper/extract.ts`: `runWords`, `horizontalRules`, `PaperPdf.raw`). pdf.js
text runs are split into words at whitespace; a run's width is shared out among its characters in
proportion to their count (pdf.js does not give per-glyph advances without a much slower path; the
proportional split is exact for monospace and within a character for proportional fonts, which is
below every tolerance used downstream). A run that is not horizontal is left out. Font weight is
700 when the font says bold or black, or its name contains `Bold`, `Black`, `Heavy` or `Semibold`
(case-insensitive); the operator list is fetched first, because that is what loads the fonts.
Horizontal rules come from the page's operator list: the straight, level segments of every path
that is stroked or filled, through the transformation matrix, at least **5%** of the page wide, as
`rules` — an answer line, or the edge of a box around a field. (First written as 20% of the page
width; whether a rule is a line's answer line is `ruleBelow`'s question, which asks for 20% of the
*column* past the last word, so the extractor keeps shorter rules for it to judge.) The file's
SHA-256 is taken before pdf.js opens it, because pdf.js may hand the buffer to its worker. **A PDF with AcroForm fields** is also mapped by `importAcroFields` (exists): its fields
become questions with confidence 1000 and their widget rectangles are their paper anchors; the text
layer still goes through the pipeline for headings, instructions and labels the fields lack.

**Scanned PDF or photograph** (`paper/ocr.ts`, `paper/ocr-words.ts`, `paper/photo.ts`; built in
S14, `SCANS.md`). A PDF page that paints a picture and has fewer than 3 text runs is treated as
scanned — a page with no picture never is, however little text it has (`CAVEATS.md` #138): drawn
with its longer side 3 000 pixels (`picture`) and read by Tesseract, word by word, in its own worker, from
this origin. A photograph (PNG, JPEG, WebP) is one page, turned as its file says, A4 wide at its own
proportions, and read as it is: not straightened (the editor's four-corner straightening,
`warp.ts`, stays the classic import's). Words carry Tesseract's box, the baseline under their
middle, the line's height as their size, and their confidence rounded to an integer 0–100.
Language packs are the existing `tessLangs(locale)`, in the author's working language. **B1, a
printed box:** Tesseract has no box among its characters, so a box comes back as "[", "0" or
"[J"; a bracket, bar or parenthesis (alone, or stuck to the word after it), or a zero or an O
(alone), that is square and at least half its line high is written as ☐, the word recording
`repair: { kind: 'box-mark', raw }`. Never a letter at a word's start: Tesseract's box for one
can take in the next (`CAVEATS.md` #135). Each page has 60 seconds; past them the author is told
and nothing is added.

**DOCX** (`paper/docx.ts`, with `paper/zip.ts` and `paper/xml.ts`). No new dependency (ADR 0018):

- **Unzip** with a central-directory reader and the platform's `DecompressionStream('deflate-raw')`
  — present in every browser this product supports, in Electron and in Node ≥ 18. Stored (method
  0) and deflated (method 8) entries only; zip64, a split archive, an encrypted entry or another
  method is refused. Entries are counted as the directory is walked, whatever the end record
  claims; only the parts read are inflated, and their bytes are counted as they arrive against one
  budget for the document, so a zip bomb costs at most the budget. An OLE compound file (an
  encrypted `.docx`, or an old `.doc`) is refused as protected.
- **XML** with a minimal non-validating tokenizer written for WordprocessingML: elements,
  attributes, text, CDATA, the five predefined entities and numeric character references; any other
  entity is an error. A `<!DOCTYPE` or `<!ENTITY` anywhere (any case) is a refusal, before any
  parsing. Namespaces are resolved, so the main namespace (transitional or strict) is `w:` whatever
  prefix the file chose.
- **Read**: the main part where `_rels/.rels` says it is (usually `word/document.xml`), and the
  styles and numbering parts its own relationships name. Paragraphs `w:p` (inside tables,
  content controls and custom XML too), runs `w:r` inside hyperlinks, insertions and simple
  fields; text `w:t`, `w:tab`, `w:br`, `w:noBreakHyphen`, `w:sym`. What Word does not show is not
  read: hidden text (`w:vanish`), deletions, and a complex field's instructions (its result is).
  Symbol-font characters (Wingdings' boxes, Symbol's bullet — private-use code points) become the
  Unicode boxes and bullets `LineHints` counts. Paragraph styles give `w:numPr`, `w:ind`, and run
  properties `w:b`, `w:i` and `w:sz`, through `w:basedOn`, over `w:docDefaults`. Headers, footers,
  footnotes, comments and text boxes are other parts, and are not read.
- **Numbering is Word's own**: `w:num` → `w:abstractNumId` (+ `w:lvlOverride`: `w:startOverride`
  and a whole `w:lvl`), `w:abstractNum`/`w:lvl` → `w:start`, `w:numFmt`, `w:lvlText`,
  `w:lvlRestart`, `w:isLgl`, `w:ind`, and a list style's `w:numStyleLink`. **Counters are kept per
  abstract list and level, as Word keeps them**: two lists of one definition continue each other's
  numbering, and a list with a `w:startOverride` restarts at it the first time it is used. (First
  written as "per `numId`", which restarts a list Word continues.) Counting a level resets every
  deeper level, unless that level's `w:lvlRestart` is 0 (never) or names a level above the one
  counted. An empty numbered paragraph counts, as Word counts it. The rendered marker is
  `w:lvlText` with `%1`–`%9` replaced by the counters in their levels' formats (decimal throughout
  under `w:isLgl`); a level Word draws nothing for gives no marker. This is attached to the
  paragraph's first word as `docxNumbering`, and stage 3 takes it as fact (`NUMBERING-RULES.md`
  §11, W1).
- **Geometry is synthetic** (`LAYOUT-IR.md`): paragraph order, `w:ind`, page breaks, and one
  paragraph per line. More than 20 synthetic pages is refused, as a PDF of more is.

**Paste** (`pasteDocument`, `packages/shared/src/import/paste.ts`, built in S6): one pasted line is
one line, synthetic geometry, blank lines separate blocks. A string is not a file's bytes, so it
lives in the core — the ladder's T6 reads a pasted list through it, exactly as the importer reads a
pasted document — and with synthetic geometry there is nothing for stage 2 to do, so it builds the
layout document directly. Around it, the clipboard (`paper/clipboard.ts`): plain text over HTML —
every program that copies puts plain text beside its HTML, with the numbers and line breaks the
reader saw — and only a paste with no plain text is read from its HTML (blocks as lines, a list item
with the number or bullet its list shows, a table cell a tab). S4 and S5 enter here.

**Where it runs.** Stages 2 to 7 run in a Web Worker (`paper/import.worker.ts`, started by
`paper/read-in-worker.ts`), so a long document never freezes the page; after 30 seconds the worker
is ended and the author is told. They run nowhere else: without a `Worker` the door says this
browser cannot read documents (`NoWorker`). (First written as running the same function on the
page instead. Every supported browser and the desktop have module workers, so that second copy of
the stages was downloaded by nobody and weighed on the bundle; S10 removed it, and the bundle
budget now fails a build that carries the stages' word lists outside the worker.)

## Stage 2 — reassemble

`reassemble` in `@tp/shared/import` (`packages/shared/src/import/layout/`). Raw words in, a
`LayoutDocument` out. Every decision in the debug artifact names its rule from the table at the end
of this section.

**Measured and synthetic sources.** `text-layer` and `ocr` words go through every step.
`docx` and `paste` words carry only what their source said (`LAYOUT-IR.md`, "Synthetic
geometry"), so the steps that read real geometry are switched off for them by the source, never by
a guess: no column cut (one region per page, the synthetic text area x 1000–9000), no
hyphenation, no page furniture and no footnotes (a synthetic page has no margins and no foot). One
paragraph is one line, in the source's order. A page may not mix the two kinds.

Per page, in this order:

1. **Ligatures.** Characters U+FB00–U+FB06 are expanded (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ). Nothing else is
   normalised in the text; the word records `repair: { kind: 'ligature', raw }`. Curly quotes are
   the author's and stay. *Fixture:* `ligature-and-quote-repair`.
2. **Column regions, by recursive XY-cut** (`layout/xycut.ts`). The page's rectangle is its words'
   extent, widened on the right to mirror its left margin (`x1 ≥ 10 000 − x0`), so that a line is
   `WRAPPED` against the page's text width, not against the page's own longest line. On a region:
   - **Vertical gutters** are x ranges crossed by no word box of the region, at least 200 iu wide
     **and at least two ems** of the region's median font size. The widest is tried first (ties:
     leftmost). (First written as 200 iu alone: pdf.js gives a run's width, not its words', and
     shared out by character a space in a 24 pt heading comes out wider than 200 iu, so a heading
     was cut into a column per word — `large-heading-words`.) **A gutter is not a column (C2)** when its left
     side is nothing but list markers (by the §4 grammar) or checkbox glyphs — the tab after "1."
     — or its right side is nothing but answer space: every row of it starts with a checkbox or is
     only blank runs, or its checkboxes are at least half its words (a grid under its header row).
     Those are kept together, and the next gutter is tried. The first gutter that is a column cuts
     the region in two (C1): the left keeps the region's left edge and ends at the gutter's
     middle; the right starts at its own first word.
   - Failing a vertical cut, the region is cut into its rows at **every horizontal gap** of empty
     page between them, crossed by no word box, top to bottom (C3), and each row is tried again.
     (First written as 1.5 × "the median line pitch" — which before lines exist is not defined,
     and as any pitch of the fixtures is 360, a threshold that never cut the full-width
     introduction off the columns below it in `layout-shift-within-document`. Then written as one
     em, which a word processor's ordinary paragraph spacing never reaches: a two-column list with
     text above and below it at that spacing was one region, read across — "1. Namn 4. E-post" as
     one line — `columns-without-margin`.)
   - Recurse until nothing cuts, at most 64 deep. The cut order is the reading order (top before
     bottom, left before right). Then the rows are put back together:
     - **Consecutive rows that did not cut any further are one region** — the cuts exist to expose
       columns inside a band of the page, so a page of paragraphs, or a running header over its
       body, is one region. (First written as "consecutive leaves whose x extents agree within 2%
       of the page width merge", which kept a heading apart from the text under it and a short
       list apart from its header, since ragged lines never agree.)
     - **Consecutive rows that cut into the same columns are those columns (C4)**, each read top
       to bottom, left column first: as many columns, gutters that overlap, and each column's words
       where that column's words already are. An indented line still overlaps its column; a label
       that merely has a gap after it on one row does not. That finds a two-column list inside the
       flow of a page, which no gutter crosses from top to bottom.
   *Fixtures:* `two-column-order`, `layout-shift-within-document`, `hanging-marker-gutter`,
   `answer-column-gutter`, `large-heading-words`, `columns-without-margin`; the corpus's
   `anmalan-tva-spalter`.
3. **Lines.** Within a region, words sorted by baseline join the current line when
   `|baseline − the line's first baseline| × 2 ≤ the region's median font size` (half an em) and
   they come from the same source; within a line, sorted by x0. Synthetic words: one paragraph, one
   line.
4. **Page furniture** (measured only), decided before blocks so that furniture never shares a
   block with text and nothing is joined into it. A line in the top 8% (`y1 ≤ 800`) or bottom 8%
   (`y0 ≥ 9200`) of the page is furniture when its **key** — NFKC, lower-cased, every digit run
   replaced by `#`, whitespace collapsed — occurs in the same margin on at least 2 pages and at
   least half of the pages (F1), or when the key is a page number (F2: `#`, `# / #`, `page #`,
   `sida # av #`, `side # af #`, `seite # von #`, `sivu #`, `página # de #`, `стр. #`, `第#页`,
   `#ページ`, and the same forms in the other shipped languages, `layout/lexicon.json`).
   *Fixture:* `repeated-header-footer`.
5. **Blocks.** Consecutive lines in a region stay in one block when the baseline gap is at most
   1.5 × the region's **line pitch** and their font sizes agree within 10%, and they are the same
   kind of thing: furniture never shares a block with text, nor a table cell with a paragraph
   outside it, nor one source with another. The pitch is the **lower quartile** of the gaps between
   consecutive baselines. (First written as the median, which on a form of short sections — a
   heading, two items, a heading — is a paragraph gap, and then every heading joined the list under
   it.) *Fixture:* `headings-and-footnote`.
6. **Hyphenation** (measured only), inside a block. A lone hyphen at a line's end that touches the
   word before it — within a tenth of an em — is that word's own (a soft hyphen a Word user typed,
   printed where the line breaks, which pdf.js may give as a text item of its own: "med" and "-");
   a dash after a space is punctuation (#141). A line whose last word ends in `-` after a letter,
   that is `WRAPPED` (`NUMBERING-RULES.md` §2) **or** before a next word too long to have fitted
   after it (`noRoomFor`: a ragged line before a long compound ends short of 90%, #141), followed
   by a line that starts with a letter: join the next line's first word onto it. The hyphen is **removed** (Y1, `dehyphenated`)
   when the next word starts lower-case and the fragment before the hyphen has at least 3 letters
   ("regis-" + "tering"); otherwise it is **kept** (Y2, `joined-at-break`: "e-" + "post",
   "Stockholm-" + "Göteborg"). **Before a conjunction nothing is joined** (Y3): "för-" / "och
   efternamn" is a suspended compound, "för- och efternamn", and joining it wrote "föroch" (the
   conjunctions of the twelve languages are in `layout/lexicon.json`). Nothing is joined across a
   block, into furniture, or across a page. The joined word keeps the first part's box; the raw
   text is on the word. No dictionary is consulted, so the rule cannot "fix" a word it does not
   know. Stage 3 reads the line the word's second half moved up from as the continuation of the
   line above, whatever its indent (P3d, #142). *Fixtures:* `hyphenated-line-break`,
   `hyphen-not-across-boundary`, `hyphen-as-its-own-word`, `hyphen-before-a-long-word`,
   `hyphen-join-keeps-line-start`.
7. **Footnotes** (measured only). A block in the page's last region, starting in the bottom
   quarter of the page (`y0 ≥ 7500`), whose font size is at most 85% of the page's body median,
   and whose first word starts with a digit, a superscript digit, `*`, `†` or `‡`, or is set at
   most 70% of its line's size (N1). An asterisk footnote is otherwise a bullet item.
   *Fixture:* `headings-and-footnote`.
8. **Tables** are `table` only when the source says so (`w:tbl`: a line has a `cell`, T1); a table
   on a PDF page is found by stage 4 from geometry.
9. **Headings.** A block is `heading` when (H1) it has at most 2 lines and its median font size is
   at least 1.2 × the page's body median (`size × 5 ≥ median × 6`), or (H2) it is one line, every
   word bold, at most 80 characters and not ending in `. , : ; ? !`, or (H3) it is one line with at
   least 3 letters, every letter upper-case (so no Chinese or Japanese line qualifies), at most 60
   characters, not ending in punctuation, with no blank run and no checkbox. Otherwise `body` (B1).
   *Fixtures:* `layout-shift-within-document`, `headings-and-footnote`.
10. **Bands** exactly as `LAYOUT-IR.md` defines them (a column with no body, heading or table line
    takes its bands from its other lines, so that every line has one); **hints** from the text
    (`layout/hints.ts`, shared with the paste layout) and `rules`.
11. **Document locale** (G1): the twelve languages' stop words (`layout/lexicon.json`) are counted
    over the text a reader reads (not furniture, not footnotes). A language is the document's when
    it has at least **20 stop words** in it, shared ones included — enough prose — and at least
    **5 of its own**, words no other language lists, and at least twice the runner-up's own —
    enough to tell it from its neighbours. Otherwise `null`. Chinese and Japanese are counted a
    character at a time. (First written as "20 hits and twice the runner-up's", counting every
    word for every language that lists it: Swedish, Danish and Norwegian share most of their
    commonest words, so every Scandinavian document came out a near tie and `null`.) Used to keep
    a Swedish validator off a Norwegian document (`CAVEATS.md` #27).

| Rule | Step | Decides | Fixture or test |
| --- | --- | --- | --- |
| L1 | 1 | a ligature expanded | `ligature-and-quote-repair` |
| L2 | 1 | a printed box OCR read as a mark: stage 1's B1, recorded | `ocr.test.ts` (B1), the corpus's scans |
| C1 | 2 | a vertical gutter is a column: cut | `two-column-order`, `layout-shift-within-document`, `large-heading-words` |
| C2 | 2 | a vertical gutter is not a column: kept together | `hanging-marker-gutter`, `answer-column-gutter` |
| C3 | 2 | horizontal gaps: cut into rows | `layout-shift-within-document` |
| C4 | 2 | rows that cut into the same columns: those columns | `columns-without-margin`, `layout/reassemble.test.ts` |
| F1 | 4 | furniture: repeats in a margin | `repeated-header-footer` |
| F2 | 4 | furniture: a page number | `repeated-header-footer`, `hyphen-not-across-boundary` |
| Y1 | 6 | a hyphen removed at a join | `hyphenated-line-break` |
| Y2 | 6 | a hyphen kept at a join | `hyphenated-line-break` |
| Y3 | 6 | a suspended compound: nothing joined | `hyphen-not-across-boundary` |
| N1 | 7 | a footnote | `headings-and-footnote` |
| T1 | 8 | a table (DOCX) | `layout/reassemble.test.ts` |
| H1–H3 | 9 | a heading | `layout-shift-within-document`, `headings-and-footnote` |
| B1 | 9 | body | every fixture |
| G1 | 11 | the document's language | `layout/reassemble.test.ts` (a paragraph in each language) |

## Stage 3 — enumerate

`NUMBERING-RULES.md`, entirely. Its output is items with levels, verdicts and flags, rejected
look-alikes, and prose lines.

## Stage 4 — segment

`segment` in `@tp/shared/import` (`segment/`, built in S9). The layout document and stage 3's
reading in, **segments** out (`segment/types.ts`):

```ts
type Segment =
  | { kind: 'heading'; lineIds: string[]; text: string }
  | { kind: 'instruction'; lineIds: string[]; text: string }
  | { kind: 'meta'; lineIds: string[]; text: string }            // a form number, a revision date
  | { kind: 'question'; lineIds: string[]; label: string; itemId: string | null;
      answer: 'blank' | 'choice' | 'boolean' | 'unknown'; options: string[];
      details: string[]; flags: SegmentFlag[] }
  | { kind: 'grid'; lineIds: string[]; label: string | null; itemId: string | null;
      rows: string[]; columns: string[]; flags: SegmentFlag[] }
  | { kind: 'table'; lineIds: string[]; label: string | null; itemId: string | null;
      columns: string[]; rowCount: number; shape: 'repeating-rows' | 'labelled-fields';
      flags: SegmentFlag[] };
// SegmentFlag: 'label-by-reference' | 'many-options' | 'same-as-earlier' | 'split-line'
```

Every line a reader reads is in exactly one segment, in reading order of its first line; page
furniture is in none (S0). The one exception is a line of two label-and-blank pairs, which is in
each question split from it. Labels, options and text are verbatim: a label loses only its marker,
its blank runs and one trailing colon. `details` are the lines under an item that belong to it
(J1); `itemId` links a question to stage 3's item.

It runs in **three passes**, and every decision in the debug artifact names its rule. (First
written as one list, first match wins, with the heading rule first. A real ruled table's header row
comes out of stage 2 as one bold region per cell, which H2 calls a heading, so a grid lost its
columns to three section headings — `grid-header-cells`, #99.)

**Pass 1 — structures claim their lines.**

- **Grid** (S2) — two or more consecutive lines, each a label and then only checkboxes, the same
  number of them, their x0s within 2% of the column width; under a header: the words on the nearest
  baseline above the first row, *across regions*, grouped into cells where words are closer than
  one em ("Vet ej"). Each checkbox's centre falls within a cell, give or take an em, left to right;
  cells left of the first answer column head the row labels ("Session", "Day") and any other cell
  means the header is not this grid's. `rows` are each row's words before its first box, `columns`
  the cells over the boxes. One column is a list to tick. *Fixtures:* `checkbox-grid`,
  `grid-header-cells`, `grid-table-reference`.
- **A Word table's grid** (S2c) — from the cells, not geometry: row 0 names the columns (its empty
  cell is absent, as Word gives it), each later row is its text cells and one checkbox per column.
  *Fixture:* `grid-from-cells`.
- **Table** (S3) — at least two consecutive lines that are only a row number (1, 2, 3 … in order)
  or only a blank, under a header of at least two cells at least 4 em apart with no answer space:
  `repeating-rows`, the cells as `columns`. The rows are found first, because a line of words is
  not a header until rows follow. *Fixture:* `table-rows`. (`labelled-fields` is in the type and
  not yet produced: a Word table's empty cells are not in IR version 1, so its rows cannot be
  counted.)
- **A table of text** (S3t, S3tc) — a header row of two or more cells on one baseline, in regions
  side by side, none of them a list item, set in bold or over ruled rows; under it, rows of cells
  until a line that spans the header's width. Each row, header included, is one instruction read
  across, its words left to right; a Word table of text the same from its cells. Stage 2 cuts such
  a table into column regions exactly as it cuts two columns of text, and reads it down its columns;
  stage 4 undoes that (#108). Not a table of text: one with a blank, a box or a cell ending in
  `:` in it (a form laid out in a table, left to the line rules — `docx-layout-table`); a Word table
  with a row of one cell; and columns whose lines run to their column's edge, as prose does and a
  cell does not (two columns under bold headings — `two-columns-of-prose`). *Corpus:* `lagerschema`.
- **The label** of a grid or table is the line just before it when that is a body line of at most
  120 characters, not ending in `.` or `!`, with no answer space of its own — prose, or an item of
  one line (then `itemId`). "Kryssa i ett svar på varje rad." is an instruction, not a label.
  Failing that, the nearest earlier question within the section (six lines, back to a heading) that
  points at a table — a word starting with a table word in any shipped language (`tabell…`,
  `Tabelle…`, `tauluk…`, `table…`, `下表` …, `segment/lexicon.json`) — and has no answer space is the
  label, flagged `label-by-reference` (S2r). *Fixture:* `grid-table-reference`.
- **A table's edge is not an answer line** (#100). A ruled table draws its top edge under the line
  above it and its borders under its header and rows, and stage 1 reports each as `ruleBelow`. For
  the line just before a structure and for every line of it, `ruleBelow` is not answer space.

**Pass 2 — items with items under them**, in reading order, so the question that comes first claims
the answers under it:

- **Options under an item** (S5b) — two or more items directly under an item, lettered, bulleted or
  small roman (never numbered: numbers are sub-questions), none with an answer space and none ending
  in `?` or `:`, when the parent has no answer space either: one choice question, the children's
  labels its options. The parent need not end in `?` ("Voice part", "Röststämma"). (First written
  as "under an item whose label ends in `?` or `:`".) *Fixture:* `options-or-section`.
- **A section** (S1c) — an item whose items are the questions (they have answer spaces, or are
  numbered), with no answer space of its own, not ending in `?` and at most 80 characters, is a
  heading: "Kontaktuppgifter", "About you". *Fixture:* `options-or-section`.
- **Options under a sentence that asks** (S5c) — lettered or bulleted items right after a prose line
  of at most 120 characters ending in `?`. *Fixture:* `prose-question`.
- **Lines of one checkbox each under a question** (S5d) — two or more lines that each start with one
  box and then words, right after a line or item ending in `?` or `:`, **in its block**: a paragraph
  break ends its answers. Lines taken as its options are never its notes as well, though stage 3
  may have kept them as an item's detail lines (`CAVEATS.md` #134, the corpus's `reserva-sala`).
  *Fixture:* `single-checkbox-line`.

**Pass 3 — every line or item left**, first match wins:

1. **Heading** (S1) — a `heading` block (an item in one: its label). A footnote block is an
   instruction (S8b). **Capitals** (S1b): a prose line with at least 3 cased letters, all upper
   case, at most 60 characters, no answer space and no closing punctuation (#23).
2. **Meta** (S9) — two to four words, the first a form or revision word in any shipped language
   (`blankett`, `form`, `rev`, `version`, `lomake` …), the rest upper case, digits and `. / -`,
   one of them with a digit: "Blankett 1234", "Rev. 2024-03".
3. **Boolean pair** (S4) — the words after two checkboxes are a yes/no pair in a shipped language,
   in that order (Ja/Nej, Yes/No, Kyllä/Ei, Oui/Non, Sí/No, Да/Нет, 是/否, はい/いいえ …); the label is
   the text before the first box. **One box** (S4b), before the words or after them ("☐ Jag
   godkänner …", "Har du allergier? ☐"): a question ticked or not, the words its label.
   *Fixtures:* `checkbox-grid`, `single-checkbox-line`.
4. **Choice** (S5) — two or more boxes each followed by words: those words are the options.
   Boxes with no words to name them and no header: a question of unknown answer.
5. **Labelled blank** (S6) — a blank run (at least 3 `_`, or at least 4 leader dots with `…` as
   three). **Two or more label-and-blank pairs on a line** are one question each, flagged
   `split-line`, and text after a line's only blank stays in its label ("Födelsedatum ____
   (ÅÅÅÅ-MM-DD)") (S6c, `two-blanks-one-line`). A printed answer line (`ruleBelow`) is a blank too
   (S6d). **Lines of nothing but a blank directly under** a question, in its block, are more room
   for its answer — and under a label ending in `:` make it one (S6b, #24,
   `label-colon-blank-below`).
6. **Item** (S7) — any other item from stage 3, accepted, flagged or candidate: a question of
   unknown answer (stage 7 scores the verdict). A **bullet with no answer space** is an instruction
   (S8c).
7. **A sentence that asks** (S7b) — a prose paragraph of at most 120 characters ending in `?`, or
   `?` and a note in brackets ("… gäster? (max 8)"); or at most 60 ending in `:` that does not
   introduce bullets. (First written as "prose without a blank, checkbox or trailing colon is an
   instruction", which made "Har du några allergier?" text to read.) *Fixture:* `prose-question`.
8. **Instruction** (S8) — anything else: a paragraph. On a measured page, the next line goes on with
   the paragraph when it is at the block's line pitch (its lower quartile of gaps; a paragraph's own
   spacing is more than a tenth larger) and the line before did not end a sentence short of the
   margin; a Word or pasted line is a paragraph of its own. (First written as "the line before
   reached the margin", which cut a paragraph wherever a long word wrapped early and joined two
   whenever a last line was long — `arsmote-anmalan`.) One tap on the review screen makes it a
   question (#22).

Afterwards, over the whole document: the same label as an earlier question is flagged
`same-as-earlier`, never merged (#25); more than 30 options, `many-options` (#30).

## Stage 5 — classify

`classify` in `@tp/shared/import` (`classify/`, built in S9). For each question, grid and table, a
**scored feature model** proposes a kind (`PREDICTIVE-BUILDER.md`, "Kinds": a `FieldType`, or
`money`, `personnummer`, `orgnr`, `address`, `consent`, `grid`), whether it is required, a format,
and chips. Nothing is applied: stage 8 asks, and the label is never touched.

- **Which kinds** a question may be comes from its answer shape (`candidates` in
  `classify/weights.json`): a blank or unknown answer, one of the text kinds (short and long text,
  number, money, date, time, e-mail, phone, address, personnummer, orgnr, file, signature); a
  boolean, `yes_no` or `consent`; a choice, `single_select` or `multi_select`; a grid, `grid` or
  (one column) `multi_select`; a table, `repeating_group`, and each of its columns read as a text
  question of its own.
- **Features** (`CAVEATS.md` §8.4) are words from `classify/lexicon/<language>.json`, twelve files,
  and shapes read from the segment. A label's words are the interpreter's (`interpret/text.ts`:
  NFKC, lower case, Chinese and Japanese as character pairs); each word is claimed by one entry,
  whole phrases before an entry marked to match a word's start (`telefon*`) or end (`*adress`), so
  "E-mail address" is an e-mail word and not also an address; a sign that is no word (`€`, `£`) is
  found anywhere. A word several languages list counts for each of them. The lists read are the
  document's language's and English, or all twelve when stage 2 found none.
- **Weights** are integer millinats: a bias per kind and a weight per feature. A kind's score is its
  bias plus its features' weights; the best candidate wins; its confidence is
  `sigmoid(best − runner-up)` from the committed table (`interpret/sigmoid.json`, ADR 0019), and the
  three features that weighed most are the "why". **With no feature at all**, short text beats long
  text by 1 200 millinats: confidence 769, the `flag` bucket — acceptance S4's "I guessed the answer
  type — tap to change".
- **Required** (#26): an asterisk, or a required word in any language → `yes`; an optional word
  ("frivilligt", "optional") → `no`; no hint → `unknown`, never `no`. The words that said so are
  kept verbatim for the chip.
- **Formats** (#27): a personnummer or organisation-number word proposes its language's check
  (`se-personnummer`, `no-fodselsnummer`, `dk-cpr`, `fi-hetu`, `is-kennitala`, and the
  organisation numbers), applied only when the document is in that language; offered as a chip when
  one language's word matched and the document's language is unknown or another; nothing when that
  is ambiguous ("personnummer" is Swedish, Danish and Norwegian).
- **Consent** (#28) proposes the consent presentation; its text is the label, byte for byte.
- **Numbers inside a question** (#29) stay in the label; a max or min word followed by a number
  proposes a `max` or `min` chip, never options or questions. "per person" proposes a `repeatable`
  chip.

## Stage 6 — map to a template, and the paper twin

- **Template.** The imported labels are read by the ladder's T2 keyword scores against each
  template's labels (`FORM_TEMPLATES`), giving the belief engine a starting point, so that after
  an import Loppa can say "This looks like a membership form — right?" and seed only what is
  missing. It never replaces or reorders an imported question. (S11–S12.)
- **Paper twin** (built in S12b: `import/anchors.ts`, `CONVERGENCE.md`). For a PDF (not DOCX or
  paste, which have no page, nor a photograph, which is not kept as paper: `SCANS.md`), each
  question's
  `PaperAnchor` is the box it will be written into: its field's widget; else its blank runs after
  its own label (two questions on one line each have their own, #124); else its checkboxes; failing
  those, from the label's right edge to the column's right edge on the label's line. (A drawn rule
  is only a hint in the Layout IR, so the fallback is where it is.) Each option's anchor is its
  checkbox; a grid row's options are its checkboxes left to right. Anchors are iu ÷ 10 000 — the
  fractions `PaperAnchor` already stores, which `documents/paper.ts` already writes answers onto.
  The file is kept first, by the editor's own route, and goes into `definition.paper.sources` in
  the import's one step, so Back takes it away with the questions.
- **A PDF's own form fields beat its text** (#54, built in S9: `fieldsFirst`, `import/fields.ts`,
  rule A1). The paper door passes each field with its widget in layout units (`fieldBoxes`). Each is
  a question at confidence 1000; a question read from the text that sits on the widget's line, or
  just above it, is that field's label rather than a second question; a field with no label of its
  own takes that text's, verbatim, and a text field its printed label's kind ("E-post" → e-mail); a
  field with neither is asked about. The field's own type (a checkbox, a choice) is never
  overridden. Headings and instructions stay.

## Stage 7 — score and bucket

`score` in `@tp/shared/import` (`score/`, built in S9). Every decision the review screen will show
has a confidence in per mille and a bucket:

| Bucket | Confidence | On the review screen |
| --- | --- | --- |
| `auto` | ≥ 850 | listed, accepted by default |
| `flag` | 550–849 | listed with its chips, "check this" |
| `review` | < 550 | "needs your eye", nothing assumed |

- **A segment's own confidence** is `sigmoid(Σ named contributions)` in millinats, each from
  `classify/weights.json` (`score`): a bias of 500; stage 3's verdict (`accept` +1500,
  `accept-flagged` +300, `candidate` −1500; a Word numbering fact +3000); the evidence on its lines
  (a blank or rule +1500, a checkbox +1500, a colon +500, a question mark +300, a grid or table
  +3000); its flags (`many-options` −2500, `label-by-reference` −800, `same-as-earlier` and
  `split-line` −300). Headings, meta and long instructions +2500; an instruction under 120
  characters that does not end in `.` or `!`, +800 — "is this a question?".
- **A question's bucket** is the lower of its own and its kind's (stage 5), then the caps.
- **The OCR cap** (#20): the lowest OCR confidence among its words — not its marker, blanks or
  boxes — below 60 caps it at `review`, 60–84 at `flag`. The text is never changed: "Adr3ss" and a
  proper noun reach the screen exactly as read. *Fixture:* `ocr-noise-budget`.
- **Required is its own decision** (#26): a hint is 953; no hint is 701, and at most `flag`
  whatever the weights say. It does **not** lower the question's bucket. (First written as a cap on
  the question: most forms mark nothing required, so every question of them would have been "check
  this", and "3 need your eye" would stop meaning anything.)
- **Counts**: questions, grids and tables by bucket — the review screen's "I read 14 questions. 3
  need your eye."

## Stage 8 — the review screen

Never skipped. It opens with one sentence: **"I read 14 questions. 3 need your eye."**

- The document on the left, with every read span highlighted by bucket; the draft on the right as
  real previews. Tapping a question highlights its source span, and tapping a span selects its
  question — the link is `lineIds`, both ways.
- Each `flag` and `review` item has one-tap chips for its top three interpretations, and the trio
  **merge with previous** / **split here** / **this is just text**; an instruction has
  **make this a question**.
- Keyboard: ↑/↓ between items, 1–3 pick a chip, M merge, S split, T just text, Enter accept.
- Every action is a patch in the same log as the conversation, so it undoes the same way.
- **Nothing enters the draft until "Use these questions"**, and that button names what it will do
  ("Add 14 questions"). After it, the conversation resumes on what is still undecided (S6).

**As built (S10).** `apps/forms/src/screens/builder/review/`: the rules in `review.ts` (items,
actions, counts), `fields.ts` (what each becomes) and `keys.ts`; the screen in `ReviewScreen`,
`SourcePane` and `DraftPane`. "Start from paper" opens it at `/forms/:id/import`.

- **The document**: a PDF is its own pages, drawn by pdf.js, each line a box over where it was
  printed; a Word file or a paste, which have no pages, is its lines in reading order. Each line is
  highlighted by its item's bucket, or as settled. The lines are for the pointer; by keyboard the
  items are the way through, one stop each.
- **The draft**: every question through `FormPreview` — the public page's own `FieldInput`, as the
  control it will become — and headings and text as they will read. A PDF's own form field (#54)
  is one item with its field's type, never a guess, and is not merged or split; the text it sits
  on still gives it the options printed beside it, the notes under it, and a required mark (#26).
  Nothing read is a dead end: while anything was read, both panes are there, and a reading with no
  question says so and how to make one.
- **The chips** are stage 5's top three kinds (`Classification.alternatives`), offered on what is
  not `auto`. **Make this a question** is a question of unknown type, with chips. Keys as above,
  plus Q for "make this a question" and ⌘/Ctrl+Z to undo; a key held down moves on through the
  items but acts once. The selection follows an action: onto what the selected item was merged
  into, or put back together as by Undo.
- **No word is lost, and none is in two places**, whatever the person does:
  - **Merge** joins an item to the one before it. A note under a question becomes its note; text
    before a question (a label printed on two lines) begins its label; two questions are one, with
    both labels, options and notes, and the type of the one with choices; a question with a grid or table is the grid or table,
    labelled by both, and what it has no place for (a question's options beside a table) is kept
    as its notes; a grid or table printed in two parts, with the same columns, is one. A line read
    as two questions (`split-line`) is in the merged item once.
  - **Split** makes two items at a line, each the words of its own lines. A question's parts are
    questions labelled by their lines, each asked its type again: a choice without its options
    would be a choice of placeholders.
  - **Just text** keeps every word: label, columns, options, rows and notes, a line each.
- **"Use these questions" is shut while anything needs your eye** — `review` and not yet settled.
  Below the threshold Loppa asks and never guesses; one Enter settles an item.
- **The review's actions stay on the screen**, with their own Undo, as a list replayed from the
  reading like the conversation's log. (First written as every action being a step in the
  conversation's log. Nothing is in the form until the questions are used, so there is nothing
  for those steps to change; the form changes once, when they are used.) **"Use these questions"
  is one step in the conversation's log** (`importQuestions`, `source: 'import'`): Back undoes it,
  replay replays it, and the session is saved with it before the conversation goes on. (Until S12
  the editor opened; since S12 the conversation does, at "Go through the questions from your
  document?", with what the document decided recorded for each question: `CONVERGENCE.md`.)
- **What a reading becomes.** Every word verbatim, in the form's language. Money becomes a number
  with two decimals. An address becomes long text. A personnummer or an organisation number
  becomes short text; its check waits for a format check in the form schema (`CONVERGENCE.md`,
  "Not in S12"). Consent becomes yes/no, its text byte for byte (#28). A
  grid becomes a choice per row, under a section of its label: one of its columns, or any number
  when its "Multiple choice" chip is picked; a grid of one column is a list to tick, its header
  the help. A table becomes a repeating group, a question per column, with as many entries as it
  printed rows. Notes are help text, and so are a question's options when it is given a type that
  holds none (a yes/no's printed pair is the type itself). Headings become section breaks; text becomes text blocks. Ids
  are fingerprints of the document's text and place, and never one the form used. Keys come from
  the labels, without their accents, and each is its own within the form and within a group: two
  columns of one name, or of a script a key cannot hold ("Имя", "氏名"), are `namn`, `namn_2`.
- **How many questions** is how many the form will have: a grid of two or more columns is a
  question per row. "I read 14 questions", "Add 14 questions" and the step in the conversation
  (`{ kind: 'import', count }`, the questions without the headings and text that come with them)
  all say the same number.
- **Why?** names each stage, and a verdict the person has seen (a type, how sure, what a line was
  read as), in their language; a rule's code and its own words stay as `docs/plan/` defines them.
- **Saved in another tab meanwhile.** "Use these questions" saves the draft and then the session;
  if another tab saved the session after this screen read it, the screen says so and adds nothing
  more — the draft may already hold the questions, and adding them again would add them twice.
  The form's editor shows what it holds. Nothing can be left, by Cancel, while the questions are
  being saved.
- **Not yet here**: straightening a crooked photograph before it is read (the editor's paper
  import straightens one to draw on); more than one photograph as one document.

## Stage 9 — importing the same form again

The comparison is built (S12c, `import/reimport.ts`, `CONVERGENCE.md`, with the fixtures in
`fixtures/reimport/`): the "origin fingerprint" is the field's own id, which is its source text's
fingerprint, so a document read again as if into an empty form gives an unchanged field the id it
had, and nothing needs storing; and a third rule matches a field by the same wording wherever it
is, when that wording is one field's on each side (#126). On screen (S12c, part two): the editor's
"Update from a document" opens the review, which on a form with anything in it shows "Compared with
your form" and "Update the form", one step the conversation's Back undoes (`reimport`).

- The file's SHA-256 equals the kept source's: nothing to do, and the screen says so.
- Otherwise stages 1–7 run again, and new questions are matched to the draft's: first by equal
  `originFingerprint`; then, in document order, each unmatched new question to the unmatched old
  question with the highest label Dice similarity of at least 0.8 (exact rational) within 3 places
  of its ordinal, ties to the lower ordinal.
- **Additions are applied**, each at its document position, each a patch.
- **Removals, reorders and changed labels are listed and asked about**, one decision each; nothing
  is removed or reworded without a press (`CLAUDE.md` rule 7).
- **Collected answers are never touched**: re-import edits the draft, and published versions stay
  what they are (`form_versions`).

## Debug artifacts

Each stage returns, beside its output:

```ts
interface StageDebug {
  stage: 'extract' | 'reassemble' | 'enumerate' | 'segment' | 'classify' | 'map' | 'score';
  stageVersion: number;      // bumped when the stage's behaviour changes on purpose
  irVersion: 1;
  inputSha256: string;       // of the canonical JSON of the stage's input (below)
  decisions: {
    id: string;              // 'enumerate:p1-l3'
    rule: string;            // 'R4', 'V1', 'G2-grid', …
    subject: string[];       // line, item or segment ids
    verdict: string;
    evidence: Record<string, number | string | boolean>;   // integers and short strings only
  }[];
}
```

- **Canonical JSON**: keys sorted by code point, no whitespace, integers only — so "byte-identical"
  is a meaningful test and the SHA-256 of a stage's input identifies it. Both are in
  `@tp/shared/import` (`debug.ts`, `sha256.ts`): the hash is written out in integer arithmetic,
  because `node:crypto` is not allowed in the core and `crypto.subtle` is asynchronous.
- **A stage that reads several inputs** (stages 4–7 read the layout document and the stages before
  them) hashes each part by itself, then the parts' hashes by their names (`inputsSha256`). An
  object's digest is taken once: the layout document is hashed once per import, however many stages
  read it. (First written as the hash of the whole input: hashing the layout anew at every stage
  cost more than all the stages' own work, and twenty pages took 2.7 s of the 4 s budget. With the
  SHA-256 on typed arrays, stages 2–7 on the same twenty pages take 0.75 s.)
- Snapshots of these are the corpus's expected files; a diff in one needs a reviewed update. The
  numbering fixtures' are `fixtures/numbering/debug/<fixture>.json`, one decision per line, written
  and compared by `scripts/caveat-fixtures.test.ts` for every fixture whose status is `green`.
- They exist in the worker's memory and in the review screen's "Why?" panel, and are downloadable
  from it. **They are not stored on the server.** The only thing an import keeps is the source file,
  and only when the form keeps its paper twin (ADR 0004, `CAVEATS.md` #43).

## The golden corpus

`fixtures/documents/`: at least 60 real documents (PDF and DOCX; at least 10 Swedish; scanned and
photographed ones; two-column; tables; checkbox grids; dotted sub-numbering; one with the exact
§8.1.1 case; and clean minimal ones), each with its expected stage outputs. Every document is one
Loppa may redistribute — made for the corpus, or published under terms that allow it — with its
origin and licence recorded in `fixtures/documents/SOURCES.json`; the repository may be public
(ADR 0015), and a form someone sent us is not ours to publish.

**What it holds today: nineteen documents, each a PDF and a Word file, and two of them scanned** —
ten Swedish, two English, two Norwegian, one each in Danish, Finnish, German, French and Spanish; one and two pages; running headers and page-number
footers; a list that crosses a page; a two-column list inside the flow of the page; a checkbox grid
and a table of text cells, and a ruled table of text alone (`lagerschema`, S9); Word's own numbering at three levels, and numbers typed into the text
("1)", "1 -", "A."); a label that wraps; a note under an item; "punkt 12.1" at the start of a
wrapped line of prose; French typography's no-break spaces; consents as boxes to tick; and the
exact §8.1.1 case in its hardest form, a numbered question that wraps so that its next printed line
begins "12.1" (`rule-ballot`, held by P3a); and an inspection checklist numbered "1.1" to "2.3" by
hand under its sections (`besiktning`); and a form with no numbers at all, as most are, its
sections in capitals, dot leaders, a label whose blank is on the line under it, required hints and
"(max 7)" in a question (`sommarlager`; like `lagerschema`, too little prose to be sure of its
language: 18 stop words of 20); and a Norwegian registration numbered "(1)" to "(6)" straight on
across its section headings (`innmelding`, held by R6c), with its fødselsnummer and
organisasjonsnummer and a question asked again; and a notice whose lines break inside words, at a
soft hyphen and at the hyphen of "e-postadress" in a question that wraps (`stamma`). Scans of real
paper are still owed.

- **Made for Loppa, by a real word processor.** Each document is a few readable lines in
  `scripts/corpus/documents.ts`, written as a Word file by `scripts/corpus/word.ts`;
  `pnpm corpus:build` has LibreOffice read it and write the corpus PDF, and re-save it as the
  corpus Word file. So the files the tests read are a third party's — its fonts, kerning, list
  numbering, fields and section breaks — and never Loppa's own writer's. They are CC0.
- **`SOURCES.json`** lists each document: its language, what it is there to test, its features,
  its spec, and each file's SHA-256, with the tool that wrote them. A file that differs from its
  hash fails the test; a rebuild is a reviewed change (LibreOffice stamps the time into a PDF, so
  rebuild only when a spec changes).
- **`expected/<document>.json`, written by hand before the document was first run**: the numbered
  items a person reading it would list, in reading order, nested as they are nested, verbatim, with
  the lines under an item that belong to it (J1), and the document's language — and, since S9,
  `segments`: every part of it a person would list, its headings, its text and its questions, each
  question with what answers it and the type they would give it, grids with their rows and
  columns. Long paragraphs are copied from the spec, so they are verbatim; every kind, label, type
  and option is decided by hand. The PDF and the Word file of a document are held to the same
  expectation, so they agree. The language is `null` where the document has too little prose for
  §2.11 to be sure (`lagerschema`).
- **`debug/<document>.<format>.<stage>.json`**: each stage's debug artifact, one decision per line,
  so a change to any decision is a diff to review, not only a change to the items.
- `apps/forms/src/screens/builder/paper/corpus.test.ts` reads each file with exactly the paper
  door's code — `openPdf` with Node's pdf.js, or `readDocx` — and runs stages 2 to 7 as the
  worker does, holding the reading to the items and the segments, with five debug snapshots a
  file.

- **`scans/`** (S14, `pnpm corpus:scan`): a document's page printed and scanned — drawn by pdf.js
  at 200 dots an inch, grey, turned half a degree — kept as its picture, as the raw document
  Tesseract read from it (frozen: OCR is a measurement, like pdf.js), and for one as a PDF holding
  only the picture. `scans/expected/<document>.json` is the document's own expectation, changed
  only where OCR measurably changed it: each misread word named, with whether stage 7's cap caught
  it, the blanks OCR does not read, and how many boxes B1 wrote back. `corpus.test.ts` reads the
  frozen raw document through stages 2 to 7; `e2e/scan.spec.ts` gives the picture and the PDF to
  the review screen, where the browser's Tesseract reads them.

`fixtures/numbering/` (hand-authored IR, no PDF at all) stays what each rule is held to; the corpus
is what the rules together are held to.

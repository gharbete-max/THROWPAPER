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

**PDF, text layer** (`paper/extract.ts`, which exists). pdf.js text runs are split into words at
spaces; a run's width is shared out among its characters in proportion to their count (pdf.js does
not give per-glyph advances without a much slower path; the proportional split is exact for
monospace and within a character for proportional fonts, which is below every tolerance used
downstream). Font weight is 700 when the font name contains `Bold`, `Black`, `Heavy` or
`Semibold` (case-insensitive) or the font descriptor's weight is ≥ 600. Horizontal rules come from
the page's operator list: straight horizontal path segments at least 20% of the page width, as
`rules`. **A PDF with AcroForm fields** is also mapped by `importAcroFields` (exists): its fields
become questions with confidence 1000 and their widget rectangles are their paper anchors; the text
layer still goes through the pipeline for headings, instructions and labels the fields lack.

**Scanned PDF or photograph** (`paper/ocr.ts`, which exists). A PDF page with fewer than 3 text
runs is treated as scanned: rendered (the existing `render`) and read by Tesseract in its worker,
as a photograph is after the existing four-corner straightening (`warp.ts`, `detect.ts`). Words
carry Tesseract's box and confidence (rounded to an integer 0–100). Language packs are the
existing `tessLangs(locale)`.

**DOCX** (`paper/docx.ts`, new). No new dependency (ADR 0018):

- **Unzip** with a ~120-line central-directory reader and the platform's
  `DecompressionStream('deflate-raw')` — present in every browser this product supports, in
  Electron and in Node ≥ 18. Stored (method 0) and deflated (method 8) entries only; anything else
  is refused. Sizes are counted while inflating against the caps.
- **XML** with a minimal non-validating tokenizer written for WordprocessingML: elements,
  attributes, text, the five predefined entities and numeric character references. A `<!DOCTYPE`
  or `<!ENTITY` anywhere is a refusal, not a warning.
- **Read**: `word/document.xml` (paragraphs `w:p`, runs `w:r`, text `w:t`, `w:tab`, `w:br`, tables
  `w:tbl`/`w:tr`/`w:tc`), `word/styles.xml` (paragraph styles: their `w:numPr`, `w:outlineLvl`,
  run properties `w:b` and `w:sz`), and `word/numbering.xml`.
- **Numbering is Word's own**: `w:num` → `w:abstractNumId` (+ `w:lvlOverride`/`w:startOverride`),
  `w:abstractNum`/`w:lvl` → `w:start`, `w:numFmt`, `w:lvlText`, `w:lvlRestart`, `w:ind`. Counters
  are kept per `numId` and level; incrementing a level resets every deeper level unless its
  `w:lvlRestart` says otherwise; the rendered marker is `w:lvlText` with `%1`–`%9` replaced by the
  formatted counters. This is attached to the paragraph's first word as `docxNumbering`, and stage 3
  takes it as fact (`NUMBERING-RULES.md` §11).
- **Geometry is synthetic** (`LAYOUT-IR.md`): paragraph order, `w:ind`, and one paragraph per line.

**Paste** (`paper/paste.ts`, new): one pasted line is one line, synthetic geometry, blank lines
separate blocks. S4 and S5 enter here.

## Stage 2 — reassemble

Raw words in, a `LayoutDocument` out. Per page, in this order:

1. **Ligatures.** Characters U+FB00–U+FB06 are expanded (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ). Nothing else is
   normalised in the text; the word records `repair: { kind: 'ligature', raw }`. Curly quotes are
   the author's and stay. *Fixture:* `ligature-and-quote-repair`.
2. **Column regions, by recursive XY-cut.** On a region (initially the words' bounding box):
   find vertical gutters — x ranges at least 200 iu wide crossed by no word box over the region's
   whole height — and split at the widest (ties: leftmost) into left and right. If there is none,
   find horizontal gaps — y ranges at least 1.5 × the median line pitch crossed by no word box
   over the region's whole width — and split at every one of them into bands top to bottom. Recurse
   until nothing splits. Leaves, in the order the cuts produced them (top before bottom, left
   before right), are the reading order. Consecutive leaves stacked vertically whose x extents
   agree within 2% of the page width merge into one region. *Fixtures:* `two-column-order`,
   `layout-shift-within-document`.
3. **Lines.** Within a region, words sorted by baseline join the current line when
   `|baseline − line baseline| × 2 ≤ median font size` (half an em); within a line, sorted by x0.
4. **Hyphenation.** A line whose last word ends in `-` after a letter, that is `WRAPPED`
   (`NUMBERING-RULES.md` §2), followed in the same region by a line that starts with a letter:
   join the next line's first word onto it. The hyphen is **removed** (`dehyphenated`) when the
   next word starts lower-case and the fragment before the hyphen has at least 3 letters
   ("regis-" + "tering"); otherwise it is **kept** (`joined-at-break`: "e-" + "post",
   "Stockholm-" + "Göteborg"). The joined word keeps the first part's box; the raw text is on the
   word. No dictionary is consulted, so the rule cannot "fix" a word it does not know. *Fixture:*
   `hyphenated-line-break`.
5. **Blocks.** Consecutive lines in a region stay in one block when the baseline gap is at most
   1.5 × the region's median line pitch and their font sizes agree within 10%.
6. **Page furniture.** A line in the top 8% (`y1 ≤ 800`) or bottom 8% (`y0 ≥ 9200`) of the page is
   furniture when its **key** — NFKC, lower-cased, every digit run replaced by `#`, whitespace
   collapsed — occurs in the same margin on at least 2 pages and at least half of the pages, or
   when the key is a page number (`#`, `# / #`, `page #`, `sida # av #`, `side # af #`, `seite # von
   #`, `sivu #`, `página # de #`, `стр. #`, `第#页`, and the same forms in the other shipped
   languages). Its block's role is `page-furniture`. *Fixture:* `repeated-header-footer`.
7. **Footnotes.** A block in the bottom quarter of the page's last region whose font size is at most
   85% of the page's body median and whose first word is a digit or a superscript-sized glyph.
8. **Headings.** A block is `heading` when (H1) it has at most 2 lines and its median font size is
   at least 1.2 × the page's body median (`size × 5 ≥ median × 6`), or (H2) it is one line, every
   word bold, at most 80 characters and not ending in `. , : ; ? !`, or (H3) it is one line of at
   least 3 letters, all upper-case, at most 60 characters, not ending in punctuation, with no blank
   run and no checkbox.
9. **Tables** are `table` only when the source says so (`w:tbl`); a table on a PDF page is found by
   stage 4 from geometry.
10. **Bands** exactly as `LAYOUT-IR.md` defines them; **hints** from the text and `rules`.
11. **Document locale**: the twelve locales' stop-word lists (`import/layout/stopwords.json`) are
    counted over the body text; the winner is the locale when it has at least 20 hits and at least
    twice the runner-up's, otherwise `null`. Used to keep a Swedish validator off a Norwegian
    document (`CAVEATS.md` #27).

## Stage 3 — enumerate

`NUMBERING-RULES.md`, entirely. Its output is items with levels, verdicts and flags, rejected
look-alikes, and prose lines.

## Stage 4 — segment

Stage 3's items and the layout's lines in, **segments** out:

```ts
type Segment =
  | { kind: 'heading'; lineIds: string[]; text: string }
  | { kind: 'instruction'; lineIds: string[]; text: string }
  | { kind: 'meta'; lineIds: string[]; text: string }            // a form number, a revision date
  | { kind: 'question'; lineIds: string[]; label: string; itemId: string | null;
      answer: 'blank' | 'choice' | 'boolean' | 'unknown'; options: string[] }
  | { kind: 'grid'; lineIds: string[]; label: string | null; rows: string[]; columns: string[] }
  | { kind: 'table'; lineIds: string[]; label: string | null; columns: string[]; rowCount: number;
      shape: 'repeating-rows' | 'labelled-fields' };
```

Rules, first match wins, each with its fixture or ledger id:

1. **Heading** — a `heading` block without a marker; or an ALL-CAPS line (H3) inside body text
   (#23). `PARTICIPANT DETAILS` is a section, never a field.
2. **Grid** — two or more consecutive lines with the same number (≥ 2) of checkbox glyphs whose
   x0s align within 2% of the column width, under a line whose words align with those columns: the
   header gives `columns` (adjacent header words closer than one em are one header, "Vet ej"), the
   first word run of each row gives `rows`, and the line above the header, if it is prose, is the
   `label`. *Fixture:* `checkbox-grid`.
3. **Table** — a line of at least 2 words separated by gaps of at least 4 em, followed by at least
   2 lines that each have `ruleBelow` or contain nothing but a row number: `repeating-rows`, with
   the header words as `columns` and the row count. Rows with a label in the first column and blanks
   in the rest are `labelled-fields`. Row numbers are never questions. *Fixture:* `table-rows`.
4. **Boolean pair** — a line whose checkboxes are followed by exactly the words of a yes/no pair in
   any shipped language (Ja/Nej, Yes/No, Kyllä/Ei, Oui/Non, Sí/No, Да/Нет, 是/否, はい/いいえ, …):
   a question, `answer: 'boolean'`, the pair as options, the text before the first checkbox as the
   label. *Fixture:* `checkbox-grid`.
5. **Choice** — a line (or an item's detail lines) with 2 or more checkbox glyphs each followed by
   words: a question with those words as options. An item at level L + 1 directly under an item at
   level L whose label ends in `?` or `:` and has no blank of its own is an **option** of that item.
   More than 30 options is flagged "this looks like a table or two questions" (#30).
6. **Labelled blank** — a line with a blank run: a question, `answer: 'blank'`, whose label is the
   text with the blank run and one trailing `:` removed, trimmed (the raw text stays on the
   provenance). *Fixture:* `blank-line-leaders`. A line ending in `:` followed in the same block by
   a line that is only a blank or has only `ruleBelow` pairs with it into one question (#24).
7. **Item** — any other accepted or flagged item from stage 3: a question, `answer: 'unknown'`.
8. **Instruction** — prose longer than 120 characters, or any prose without a blank, checkbox or
   trailing colon ("Please read the terms and conditions.") (#22). One tap on the review screen
   makes it a question.
9. **Meta** — a line matching a form-number pattern (`Blankett 1234`, `Form A-12`, `Rev. 2024-03`).

Nothing is de-duplicated: the same question in two sections stays two questions, and the review
screen offers a "these look the same" chip (#25).

## Stage 5 — classify

For each question segment, a **scored feature model** proposes a kind (`PREDICTIVE-BUILDER.md`,
the kind table), validation, and whether it is required.

- **Features** are named predicates with concrete tests, each in `classify/features.ts`:
  `hasBlankRun`, `hasCheckboxGlyph` (+ count, row/column layout), `selectAllPhrase`, `datePattern`
  (+ a date-ish label word in the locale pack), `timeSlotPattern` (`kl. 18:00`, `18:00–19:00`, a
  table of slots), `currencyHint` (`kr`, `SEK`, `EUR`, `€`, `belopp`, `summa`, `moms`, …),
  `emailWord`, `phoneWord`, `addressWord`, `personnummerWord`, `orgNrWord`, `signatureHint` (+ a long
  blank at the foot of the page), `fileHint` (`bifoga`, `attach`, `upload`, …), `consentHint`
  (`samtycke`, `GDPR`, `I agree to`, …), `repeatableHint` (`per person`, `varje deltagare`, `antal` +
  sub-blocks), `longPromptNoBlank` (> 120 characters), `labelColonThenBlank`, `booleanPair`,
  `gridAlignment`. Word lists live in `classify/lexicon/<language>.json`.
- **Weights** live in `classify/weights.json` — integer millinats, one bias per kind and one weight
  per feature per kind:
  ```json
  { "weightsVersion": 1,
    "kinds": { "email": { "bias": -2000, "features": { "emailWord": 3500, "hasBlankRun": 400 } } } }
  ```
  A kind's score is its bias plus the weights of the features present. The best kind wins; its
  confidence is `sigmoid(best − runner-up)` from the committed table (ADR 0019); the three features
  that contributed most are kept for the "why" chip.
- **When nothing fires**, the kind is `short_text` at a confidence that lands in `flag` — the
  S4 promise: "I guessed the answer type — tap to change".
- **Required** (#26): `*`, `required`, `obligatoriskt`, `(mandatory)`, `påkrevd`, `pakollinen`,
  `Pflichtfeld`, `obligatoire`, `obligatorio`, … → `required: true`. **No hint is `unknown`, not
  `false`**, and `unknown` is flagged.
- **Locale-specific validation** (#27) is proposed only when the document locale (stage 2) is that
  locale's: a Swedish personnummer check on a Swedish document; on a document of unknown locale
  the format is offered as a chip, never applied.
- **Consent** (#28) proposes the consent presentation; its text is the label, verbatim, never
  shortened.
- **Numbers inside a question** ("How many guests? (max 8)") are part of the label; they may
  propose `max: 8` validation as a chip, never options or extra questions (#29).

## Stage 6 — map to a template, and the paper twin

- **Template.** The imported labels are read by the ladder's T2 keyword scores against each
  template's labels (`FORM_TEMPLATES`), giving the belief engine a starting point, so that after
  an import Loppa can say "This looks like a membership form — right?" and seed only what is
  missing. It never replaces or reorders an imported question.
- **Paper twin.** For PDF and photo sources (not DOCX or paste, which have no page), each
  question's `PaperAnchor` is the box it will be written into: the union of its blank run,
  checkboxes or rule; failing those, from the label's right edge to the column's right edge on the
  label's line. Each option's anchor is its checkbox. Anchors are iu ÷ 10 000 — the fractions
  `PaperAnchor` already stores, which `documents/paper.ts` already writes answers onto. The source
  file goes into `definition.paper.sources` exactly as the manual paper flow does today.

## Stage 7 — score and bucket

Every decision the review screen will show has a confidence in per mille and a bucket:

| Bucket | Confidence | On the review screen |
| --- | --- | --- |
| `auto` | ≥ 850 | listed, accepted by default |
| `flag` | 550–849 | listed with its chips, "check this" |
| `review` | < 550 | "needs your eye", nothing assumed |

A question's confidence is `sigmoid(Σ named contributions)` in millinats, each from
`classify/weights.json` (`score` section): marker verdict (`accept` +1500, `accept-flagged` +300,
`candidate` −1500; a DOCX numbering fact +3000), segment evidence (a blank, a checkbox, a trailing
colon: +800 each), the kind margin from stage 5, and penalties. Two caps apply after the sum, and
cannot be outweighed:

- **OCR** (#20): the lowest word confidence in the label below 60 → at most `review`; 60–84 → at
  most `flag`. The text is never changed: "Adr3ss" and a proper noun reach the screen exactly as
  read. *Fixture:* `ocr-noise-budget`.
- **Unknown required** (#26) → at most `flag`.

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

## Stage 9 — importing the same form again

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
  inputSha256: string;       // of the canonical JSON of the stage's input
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
  is a meaningful test and the SHA-256 of a stage's input identifies it.
- Snapshots of these are the corpus's expected files; a diff in one needs a reviewed update.
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

Until the corpus exists, `fixtures/numbering/` (hand-authored IR, no PDF at all) is what the
stages are held to.

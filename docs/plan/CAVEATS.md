# The caveat ledger

**Status:** proposed with the plan set, 2026-09-25. Every row is a trap the builder or the importer
must survive: `id | symptom | rule | test`. A row whose test is a fixture in `fixtures/numbering/`
is checked by `scripts/caveat-fixtures.test.ts` — the fixture must exist and name the row's id in
its `caveats`, and every fixture's caveats must be rows here. **A row without a test is an
opinion**; rows whose test is still a planned file name the slice that writes it.

Numbers 1–45 are the brief's (§8). Numbers from 46 are traps this plan found while fitting the
brief to the repository. Nothing here is optional, and nothing here may be "simplified away":
removing a row is a decision, recorded in the commit that does it.

## 8.1 Numbering traps

The detector's own procedure is `NUMBERING-RULES.md`; the rule ids below are its.

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 1 | `dotted-subnumber-mid-sentence` | `1. A thing 12.1 mentions blabla` becomes two questions, or loses "12.1" | only a line's first word is ever tested (P1); a soft-wrapped line is never a marker line (P3a, P3b) | `fixtures/numbering/dotted-subnumber-mid-sentence.json`, `fixtures/numbering/dotted-subnumber-mid-sentence--wrapped.json`, `fixtures/numbering/dotted-subnumber-mid-sentence--flush.json` |
| 2 | `dotted-subnumber-line-start` | `12.1` at the start of a line becomes a new top-level question | a dotted number nests under the item whose path it extends (R1, R9); with no such item it is accepted and flagged `orphan-subnumber` | `fixtures/numbering/dotted-subnumber-line-start.json`, `fixtures/numbering/dotted-subnumber-line-start--orphan.json` |
| 3 | `decimal-not-marker` | "3.5 million", "no. 12.1", "version 2.0", "§ 4.2" become questions | they match no production (P1, §4) or are vetoed: lower-case word after (V1), a unit (V2), above 199 (V4) | `fixtures/numbering/decimal-not-marker.json` |
| 4 | `ordinal-not-marker` | "the 1st of May", "den 3:e", "1. mai" become questions | "1st" and "3:e" match no production; a month after a Nordic/German ordinal is vetoed (V3) | `fixtures/numbering/ordinal-not-marker.json` |
| 5 | `sequence-continuity` | 1, 2, 12.1 at one indent is read as a clean list | only expected next values continue a run (R1); a jump flags the whole run `sequence-jump` (R4, D2) | `fixtures/numbering/sequence-continuity.json` |
| 6 | `scheme-change-same-indent` | 1, 2, 3, i, ii read as one list of five, or 1, 2, iii as two lists | a restart in another scheme nests (R5a); a non-restart joins and flags `scheme-inconsistent` (R5b) | `fixtures/numbering/scheme-change-same-indent.json` |
| 7 | `single-item-list` | a lone "1. Namn" becomes a question list of one | accepted only with band evidence and field evidence; otherwise a candidate, off by default (D3) | `fixtures/numbering/single-item-list.json` |
| 8 | `counter-reset-on-heading` | a second "1." after a heading is read as a duplicate or a jump | a heading (R6a), an outdented line (R6b) or an outdented marker (R3) closes lists; a restart with no boundary is flagged (R7) | `fixtures/numbering/counter-reset-on-heading.json` |
| 9 | `page-break-continuation` | a list restarts at 1 on page 2, or a "continued on page 2" notice ends it | nothing reads page or column (R8); continuation notices change nothing (V7); furniture is not read (P2) | `fixtures/numbering/page-break-continuation.json` |
| 10 | `letter-vs-word` | "A. Andersson" becomes question A | a lone letter with nothing to fill in is a word (D4); letters in sequence are a list | `fixtures/numbering/letter-vs-word.json` |
| 11 | `parenthesised-number` | "(the form)" or "(3 500 kr)" becomes a question | only `(n)`, `(a)`, `(iv)` as a whole first word are markers (M5) | `fixtures/numbering/parenthesised-number.json` |
| 12 | `nordic-numbering` | "1)", "1 -", "1:", "1 ." are not recognised, or "1 - 3 dagar" is | all four are productions (M2, M8, M3); a range after a spaced dash is vetoed (V5) | `fixtures/numbering/nordic-numbering.json` |

## 8.2 Geometry and text quality

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 13 | `two-column-order` | two columns are read interleaved, line by line across the page | recursive XY-cut into column regions; reading order is the cut order (IMPORT-PIPELINE §2.2); lists continue across columns (R8) | `fixtures/numbering/two-column-order.json` |
| 14 | `repeated-header-footer` | "Sida 2 av 3" and the running header become questions | margin band + key with digits folded, repeated on ≥ 2 and ≥ half the pages, or a page-number pattern → `page-furniture` (§2.6) | `fixtures/numbering/repeated-header-footer.json` |
| 15 | `hyphenated-line-break` | "regis- / tering" stays two words; "e- / post" loses its hyphen | join at a wrapped line's trailing hyphen; drop it only for a lower-case continuation of a ≥ 3-letter fragment (§2.4) | `fixtures/numbering/hyphenated-line-break.json` |
| 16 | `ligature-and-quote-repair` | "ﬁrst" is not "first"; a curly quote changes whether "1." is a marker | U+FB00–FB06 expanded and recorded (§2.1); probe folds quotes for marker tests only, output verbatim (§4 of the rules) | `fixtures/numbering/ligature-and-quote-repair.json`, `fixtures/numbering/ligature-and-quote-repair--marker.json` |
| 17 | `table-rows` | a table with a header row becomes N questions with jumbled text | header of ≥ 2 widely spaced words + ≥ 2 ruled or numbered rows → one table segment (§4.3) | `fixtures/numbering/table-rows.json` |
| 18 | `checkbox-grid` | a checkbox matrix becomes loose options; "☐ Ja ☐ Nej" becomes two questions | aligned checkbox rows under a header → grid (§4.2); a single yes/no pair → boolean (§4.4) | `fixtures/numbering/checkbox-grid.json` |
| 19 | `blank-line-leaders` | "Namn ........." is read as prose | ≥ 3 underscores or ≥ 4 leader dots is a blank; label without it and one trailing colon (§4.6) | `fixtures/numbering/blank-line-leaders.json` |
| 20 | `ocr-noise-budget` | a noisy OCR label is accepted silently, or "fixed" | lowest word confidence < 60 caps at `review`, < 85 at `flag`; the text is never changed (§7) | `fixtures/numbering/ocr-noise-budget.json` |
| 21 | `layout-shift-within-document` | a full-width intro above two columns scrambles the order | XY-cut produces three regions: top, then left, then right (§2.2) | `fixtures/numbering/layout-shift-within-document.json` |

## 8.3 Semantic traps

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 22 | `instruction-vs-question` | "Please read the terms and conditions." becomes a question | prose with no blank, checkbox or trailing colon is an instruction; one tap makes it a question | planned: `packages/shared/src/import/segment/segment.test.ts` (S9) |
| 23 | `heading-vs-question` | "PARTICIPANT DETAILS" becomes a field | a heading block or an all-caps line without a marker is a heading segment | planned: `segment.test.ts` (S9) |
| 24 | `label-and-field-split` | "E-post:" and the blank line under it become two things | a line ending in `:` followed in its block by a line that is only a blank or a rule is one question | planned: `segment.test.ts` (S9) |
| 25 | `same-question-repeated` | the same question in two sections is merged | never de-duplicated; a "these look the same" chip | planned: `segment.test.ts` (S9) |
| 26 | `required-inference` | no hint is read as "optional" | `*`, "required", "obligatoriskt", "(mandatory)"… → required; no hint → **unknown**, capped at `flag` | planned: `packages/shared/src/import/classify/classify.test.ts` (S9) |
| 27 | `locale-specific-fields` | a Swedish personnummer check runs on a Norwegian form | a locale's validator is proposed only when the document locale (§2.11) is that locale; otherwise it is a chip | planned: `classify.test.ts` (S9) |
| 28 | `consent-language` | consent text is summarised, shortened or tidied | "samtycke", "GDPR", "I agree to…" → the consent presentation; the text verbatim, byte for byte | planned: `classify.test.ts` (S9) |
| 29 | `number-in-question-text` | "How many guests? (max 8)" grows 8 options or a second question | numbers inside a label stay in it; `max: 8` is offered as a chip | planned: `classify.test.ts` (S9) |
| 30 | `option-count-sanity` | a single choice with 45 options is accepted | > 30 options is flagged "this looks like a table or two questions" | planned: `segment.test.ts` (S9) |

## 8.4 The classification features

Not traps but the scored feature model that avoids them — `hasBlankRun`, `hasCheckboxGlyph`,
`selectAllPhrase`, `datePattern`, `timeSlotPattern`, `currencyHint`, the field gazetteers,
`signatureHint`, `fileHint`, `consentHint`, `repeatableHint`, `longPromptNoBlank`,
`labelColonThenBlank`, `booleanPair`, `gridAlignment`. Their definitions and weights are in
`IMPORT-PIPELINE.md`, stage 5, and `classify/weights.json`; each feature gets a row in
`classify.test.ts` (S9).

## 8.5 Design

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 31 | `preview-must-be-real` | a grey wireframe, or a preview that ignores the brand kit | the preview renders `FieldInput` on the organisation's compiled tokens; there is no wireframe component to reach for | planned: `apps/forms/src/screens/builder/guided/preview.test.tsx` (S5) |
| 32 | `brand-before-build` | a user's preview in Loppa's own colours | no brand → presets other than `default`, or the 60-second flow; the Demo AB kit only in the demo workspace | planned: `preview.test.tsx` (S5) |
| 33 | `placement-slots-not-pixels` | a logo placed at x/y, broken on a phone | six named slots; no coordinate is ever stored | planned: `packages/shared/src/forms/layout.test.ts` (S5) |
| 34 | `print-faithful-mode` | an imported form prints nothing like its paper | the Print Faithful layout; preview shows screen and paper | planned: `e2e/guided-builder.spec.ts` (S12) |
| 35 | `reduced-motion-and-contrast` | motion for someone who asked for none; a brand colour silently changed to pass contrast | `useReducedMotion` gates every animation; contrast failures are reported, never fixed by altering the brand | planned: `apps/forms/src/lib/motion.test.ts` (extend, S4) |
| 36 | `rtl-and-long-strings` | a German label truncated; a mirrored layout broken | no fixed widths on text; a pseudo-RTL and a German-length run of the whole flow | planned: `e2e/guided-builder.spec.ts` (S13) |
| 37 | `one-decision-per-screen` | a node asking two things; a primary action below a scrollbar | one `ask` per node; each node renders at 360×640 without scrolling to its answers | planned: `e2e/guided-builder.spec.ts` (S4) |

## 8.6 Technical and product

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 38 | `determinism` | the same file gives a different draft on another machine | no clock, no randomness, integer arithmetic, canonical JSON; every fixture run twice and shuffled | planned: `packages/shared/src/import/determinism.test.ts` (S1b) |
| 39 | `stable-ids` | a rename, reorder or re-import changes a question's id | fingerprint-seeded once, never recomputed, never reused (`retiredIds`) | planned: `packages/shared/src/builder/ids.test.ts` (S2) |
| 40 | `contract-and-parity` | the desktop and the browser disagree, or `contract:check` breaks | one table on Postgres and PGlite; Forms-internal endpoints are documented by their Zod schemas (not `CONTRACT.md`, which is inter-product); `contract:check` run every slice | planned: `apps/api-forms/src/builder/sessions.test.ts` on both drivers (S2) |
| 41 | `no-new-runtime-deps` | a parser or a model library appears in `package.json` | an ADR first; DOCX uses `DecompressionStream` and an in-house XML tokenizer | `scripts/licence-check.ts` + review; ADR 0018 |
| 42 | `perf-budget` | a node takes a frame too long; 20 pages take a minute | node render < 16 ms, graph load < 50 ms, interpretation < 10 ms (a comparison budget), 20 pages < 4 s, no spinner under 150 ms | planned: `packages/shared/src/import/budget.test.ts` (S7), `interpret/budget.test.ts` (S3) |
| 43 | `privacy` | a document leaves the machine, or its traces cannot be removed | parsing is local; the source is kept only for a paper twin, in the organisation's own store, deletable; debug artifacts are never stored server-side | planned: `apps/forms/src/lib/bundle-split.test.ts` (extend, S7) + review |
| 44 | `accessibility-of-the-conversation` | a step needs a pointer | 1–9 / Alt+1–9 pick, Enter accepts, Escape and ⌘Z go back; a live region announces each question | planned: `e2e/guided-builder.spec.ts` keyboard-only twins (S13) |
| 45 | `never-lose-work` | a refresh mid-conversation starts over | the log and cursor autosave to `builder_sessions`; resume returns to the same node and trail | planned: `e2e/guided-builder.spec.ts` (S2 API, S4 UI) |

## Added by the plan

| # | Id | Symptom | Rule | Test |
| --- | --- | --- | --- | --- |
| 46 | `marker-on-own-line` | "1." on its own line, label on the next, is lost or read as two things | the next line in the block is the label (P4); with none it is rejected | `fixtures/numbering/marker-on-own-line.json` |
| 47 | `bullet-list` | bullets are read as prose; a lone "* Obligatoriskt" legend becomes a question | bullets form runs with no counter (M9); a lone one is a candidate | `fixtures/numbering/bullet-list.json` |
| 48 | `nested-by-indent` | letters indented under numbers are read as one flat list | an indent to the right of an open list nests (R2); the next number pops back (R1) | `fixtures/numbering/nested-by-indent.json` |
| 49 | `id-reuse-after-delete` | a deleted question's fingerprint id is given to a new identical one, and old answers attach to it | `retiredIds` in the sidecar; a colliding fingerprint takes the next suffix | planned: `ids.test.ts` (S2) |
| 50 | `float-determinism` | `Math.exp` differs in the last bit between engines and flips a threshold | integers in every decision; a committed sigmoid table; logs computed at build time only (ADR 0019) | planned: `packages/shared/src/builder/belief/belief.test.ts` (S11) |
| 51 | `browser-reserved-shortcuts` | ⌘1–9 switches browser tabs instead of picking an option | browser: 1–9 when the text box is not focused, Alt+1–9 anywhere; desktop adds ⌘/Ctrl+1–9 | planned: `use-keyboard.test.ts` (S4) |
| 52 | `operative-wording-never-generated` | an example chip or a seeded template writes a consent or safety sentence | chips are labels only, held to the same regulated-word list as the templates (`forms/wording.ts`); consent text comes from the organisation, or publishing is blocked (ADR 0012) | `packages/shared/src/builder/graph/validate.test.ts` (G13), `apps/forms/src/lib/guided-graph.test.ts` |
| 53 | `untrusted-docx` | a zip bomb or an XML entity expansion from an uploaded .docx | caps counted while inflating; DOCTYPE or ENTITY refused (IMPORT-PIPELINE, "Caps") | planned: `apps/forms/src/screens/builder/paper/docx.test.ts` (S7) |
| 54 | `acroform-first` | a PDF with real form fields is guessed at from its text | AcroForm fields are mapped by `importAcroFields` at confidence 1000; text only fills what they lack | planned: `packages/shared/src/import/pipeline.test.ts` (S7) |
| 55 | `tap-target-floor` | an inline-edit handle drags a choice below 44 px or to a free colour | handles snap to `ChoiceStyle` values; there is no smaller size and no hex | planned: `InlineEdit/inline-edit.test.ts` (S5) |
| 56 | `legacy-wizard-answers` | an old client's `wizardAnswers` stop resolving when the new door ships | `POST /v1/forms` keeps accepting them (`wizard-definition.ts`) until a removal is decided | existing: `apps/api-forms/src/forms/forms.test.ts` (keep green) |
| 57 | `cjk-tokenisation` | Chinese and Japanese free text never matches anything | CJK runs are split into character bigrams, not whitespace words (INTENT-LADDER, normalisation) | planned: `fixtures/ladder/zh.json`, `ja.json` (S3) |
| 58 | `pdfjs-runs-not-words` | word boxes are wrong because pdf.js gives runs, not words | runs split at spaces, width shared by character count (IMPORT-PIPELINE §1) | planned: `apps/forms/src/screens/builder/paper/extract.test.ts` (extend, S7) |
| 59 | `form-word-not-jargon` | a banned-word list bans Norwegian *skjema* or Danish *skema* — the everyday word for *form* — and the builder can no longer say what it builds | banned words are per language; a word is banned only where it is jargon (`graph/voice.json`) | `apps/forms/src/lib/guided-graph.test.ts` (G10 on the real catalogues) |
| 60 | `first-answer-adds-a-question` | the first answer leaves a draft with nothing to answer, which publishing already refuses (`no-answerable-fields`) | every answer to the start node adds a field, labelled from `forms/vocabulary.ts` in all twelve languages | `packages/shared/src/builder/graph/graph.test.ts` |
| 61 | `icon-that-does-not-exist` | an option names an icon `Icon.tsx` cannot draw, and it renders as nothing | every icon the graph names is held to `IconName` | `apps/forms/src/lib/guided-graph.test.ts` |

## Known unknowns

Not yet decided, and not to be decided by an implementation quietly choosing:

- **`glued-marker`** — `1.Namn` (no space after the marker) is common in pasted text and matches no
  production today. Accepting it risks `3.5million`-style prose. Decide with corpus evidence, then
  add a production and a fixture together.
- **Grid as a field type** — an imported grid is one `single_select` per row until a grid field
  type exists (its own ADR, CSV shape first). S9 writes that ADR or keeps the fallback
  (`BRIEF.md` §12).
- **Right-to-left** — none of the twelve locales is RTL; #36 tests a pseudo-RTL run so the day one
  is added is not the day RTL is discovered. `IrLine.words` is left to right by contract; an RTL
  locale would need an `irVersion` bump.
- **The corpus's sources** — sixty documents Loppa may redistribute have to be found or made;
  `fixtures/documents/SOURCES.json` records each one's origin and licence.
- **Handwriting** — a photographed form filled in by hand is out of scope: OCR reads print. A page
  that is mostly handwriting lands in `review` because its confidence is low; nothing more.
- **Consent reformatting** — byte for byte is assumed until the owner answers question 3.

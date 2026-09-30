# Roadmap — the predictive builder and document import

**Status:** proposed 2026-09-25; the mission is `BRIEF.md` (revision 3). This is the plan's own roadmap; the product's is
`docs/ROADMAP.md` (Track A / Track B), which points here. Updated at the end of every slice: the
status column, new caveats in `CAVEATS.md`, and the slice's five-line summary under "Log".

**Order.** The brief's work order, with its order note applied: **S1b — the detector — runs
immediately after S1**, because it is the highest-risk module, it is blocked only on the frozen IR,
and if it fails the roadmap changes (the fallback is the paper twin that exists today: keep the page
as an image and place fields on it). That holds unless the owner answers §14 question 7 with "the
click-through builder is the headline", in which case S1b moves back to S8 and nothing else moves.

Every slice ends with `pnpm verify`, `pnpm contract:check` and — from the first slice with a
screen — one `pnpm test:e2e` run, with the exact commands and results pasted in its summary
(`CLAUDE.md`: a green `verify` is not a green `e2e`).

## Milestones

### M0 — The plan (turn 1) · done when the owner approves it

- **Slices:** none; the plan set, the ADRs, the `CLAUDE.md` section.
- **Demo:** the documents in `docs/plan/`; ADRs 0017–0021; 29 hand-authored fixtures in
  `fixtures/numbering/` and three IR samples in `fixtures/ir/`, all validated by
  `scripts/caveat-fixtures.test.ts`, the 29 expectations registered as `todo`.
- **Not in this milestone:** any feature code.

### M1 — The graph and the detector · S1, S1b

- **Demo:** `pnpm builder:validate` rejecting each kind of broken graph; the 21 enumerate fixtures
  green, `dotted-subnumber-mid-sentence` first; the detector's debug JSON for S5 on screen
  (`fixtures/numbering/debug/dotted-subnumber-mid-sentence.json` is that artifact, snapshot-tested).
- **Not in this milestone:** extraction from real files, the machine, any screen.

### M2 — The engine · S2, S3

- **Demo:** a recorded session replayed into a byte-identical draft; undo of every patch kind;
  a refresh mid-session resuming on Postgres and on PGlite; phrases in the twelve languages
  resolving through T0–T4, and the must-not-resolve table asking.
- **Not in this milestone:** a screen, T5–T8, import.

### M3 — The buttons chain on screen · S4, S5

- **Demo:** acceptance **S2** and **S3** in the browser and the desktop app, keyboard only as well.
- **Not in this milestone:** multi-slot free text, import, the guess.

### M4 — Talking freely, and paper in · S6, S7, S8

- **Demo:** "three buttons, pill shape, side by side" filling three slots, each undoable alone;
  pasting **S4** and **S5**; a two-column PDF and a Word file with real numbering read in order,
  their debug JSON shown; the enumerate fixtures still green through real extraction.
- **Not in this milestone:** the review screen, answer types, the guess.

### M5 — Review and guess · S9, S10, S11

- **Demo:** "I read 14 questions. 3 need your eye." on a real form; S4's "I guessed the answer
  type — tap to change"; "This looks like an event registration — right?" with its three answers
  and "Why this guess".
- **Not in this milestone:** re-import, writing answers onto the paper twin from an import.

### M6 — Convergence · S12, S13

- **Demo:** **S1–S6** as Playwright journeys with keyboard-only twins; an imported form walked by
  the conversation asking only what is undecided (S6); a filled response coming back as its paper;
  a re-import asking before it removes anything.
- **Not in this milestone:** a grid field type (unless S9 wrote its ADR),
  handwriting, community sharing of forms (ADR 0006: an owner decision with DSA obligations).

## Slices

| Slice | Builds | Its tests | Touches | Status |
| --- | --- | --- | --- | --- |
| **S1** Graph as data | `builder/graph/` schema, `nodes.ts` (15 nodes + menu + end), validator G0–G13, `guards.ts` parser, `guided.*` keys in 12 catalogues, `pnpm builder:validate`, the purity ESLint block | one broken graph per rule; `when` grammar and totality; serialisability | `packages/shared`, `apps/forms` messages, `scripts/`, `eslint.config.js` | **done** — in review, PR #147 |
| **S1b** Enumerate | `import/ir/` types + validator, `import/enumerate/` per `NUMBERING-RULES.md`, stage debug JSON | the 21 enumerate fixtures; determinism (twice, shuffled) | `packages/shared` | **done** — in review, PR #147 |
| **S2** Machine | reducer, patch ops + inverses, log, replay, breadcrumbs, `ids.ts`, sidecar; `builder_sessions` + `GET/PUT /v1/forms/:id/builder-session` | replay property test; undo of each op; publishable at every node; ids stable and never reused; sessions on Postgres and PGlite | `packages/shared`, `apps/api-forms` (migration 0019), `apps/forms` messages (one key) | **done** — in review, PR #147 |
| **S3** Ladder T0–T4 | normalisation, word lists and `aliases/<language>.json` in twelve languages, the integer logarithm, T0–T4 with negation and vagueness on every rung; `pnpm builder:validate` checks the aliases | phrase and must-not-resolve tables per language (880 rows); determinism; budget; every card's label read as its card | `packages/shared`, `scripts/`, `fixtures/ladder/`, `apps/forms` (one test) | **done** — in review, PR #147 |
| **S4** Builder shell | the two doors, `Shell`, cards, quantity, trail, keyboard, motion token; the buttons chain end to end | component tests; e2e for S2 without editing | `apps/forms`, `packages/tokens` (`--tp-motion-preview`) | **done** — in review, PR #147 |
| **S5** Preview + inline editing | `PreviewMoment`, `InlineEdit/`, "changed by hand", reconciliation; `ChoiceStyle` gains `tab`, `segmented`; `FormSettings.layout` | e2e for S3; snapping; reconciliation never clobbers | `apps/forms`, `packages/shared` | **done** — in review, PR #147 |
| **S6** Ladder T5–T8 | multi-slot parse, list extraction (through the paste IR), group ranking, disambiguation, alias capture, export/import, `builder_aliases`; answers ahead of their turn (`answerAt`, `fill`, graph version 3's slots) | T5–T7 tables; capture needs consent; import diff | `packages/shared`, `apps/forms`, `apps/api-forms` (migration 0020) | **done** — in review, PR #147 |
| **S7** Extract + reassemble | `paper/docx.ts`, the clipboard around `import/paste.ts` (built in S6), operator-list rules in `extract.ts`, `import/layout/`, `import.worker.ts`; Word's own numbering in enumerate (`NUMBERING-RULES.md` §11) | the 5 reassemble fixtures; a DOCX numbering fixture; DOCX caps and entity refusal; the budget | `apps/forms`, `packages/shared` | **done** — in review, PR #147 |
| **S8** Enumerate on real input | S1b wired to extraction; the corpus's first documents | the corpus so far, through stages 1–3 | `packages/shared`, `fixtures/documents/` | **done** — in review, PR #147 |
| **S9** Segment + classify + score | `import/segment/`, `import/classify/` (`weights.json`, lexicons, sigmoid table), buckets | the 3 segment and 1 classify fixtures; #22–#30; every feature | `packages/shared`, `apps/forms` (the worker, the corpus, one message) | **done** — in review, PR #147 |
| **S10** Review screen | `review/`, highlight linking, chips, merge/split/just text, "Use these questions" | e2e for S4 and S5 | `apps/forms`, `packages/shared` (the import step, classify's top three, `sideEffects`) | **done** — in review, PR #147 |
| **S11** Belief engine | `belief/recipes.json`, integer log-odds, entropy-driven next node, three-state guess, seeding (structure only for rule-8 templates) | belief determinism; "why" lists the three strongest answers; seeding never adds operative wording | `packages/shared`, `apps/forms` | **done** — in review, PR #147 |
| **S12** Convergence, paper twin, re-import | `decided()` slots from import, anchors from the IR, `definition.paper` from an import, stage 9 | e2e for S6; a filled response as its paper; re-import asks before removing | `packages/shared`, `apps/forms`, `apps/api-forms` | done, in review — S12a (the walk, acceptance S6), S12b (the paper twin), S12c (re-import, in two commits), PR #147 (`CONVERGENCE.md`) |
| **S13** Polish | twelve-language completeness, keyboard-only e2e twins for S1–S6, pseudo-RTL, the performance budget, this roadmap and the ADRs brought up to date | e2e; budgets | all of the above | not started |

## Log

*(Five lines per slice — what changed, why, tests added, what is next, open questions — appended
when each slice ends.)*

- **M0, turn 1 (2026-09-25).** The plan set, ADRs 0017–0021, the `CLAUDE.md` section, 29 fixtures
  and 3 IR samples. Why: the brief's §11 — the plan lands before the code. Tests:
  `scripts/caveat-fixtures.test.ts` (fixtures well-formed, every §8.1/§8.2 row has one, every
  rule in `NUMBERING-RULES.md` names a fixture that exists; expectations `todo`). Next: S1, then
  S1b. Open: the owner questions at the end of `PREDICTIVE-BUILDER.md`.
- **S1, graph as data (2026-09-25).** What: `@tp/shared/builder` — the node schema (types and
  Zod), the path grammar and the table of writable paths, the `when` language (hand-written
  parser, total, bounded), the validator G0–G13, and the 17-node graph; 77 `guided.*` keys in all
  twelve catalogues; `pnpm builder:validate`; an ESLint block that makes the core's purity a
  rule; the regulated-word list moved to `forms/wording.ts` so templates and chips share it. Why:
  every later slice renders or walks this graph. Tests: 88 in `packages/shared` (a broken graph per
  rule, guard grammar and totality, paths) and 4 in `apps/forms` (the real catalogues, both
  directions of key usage, icons). Next: S1b, the detector. Open: the owner questions still
  stand; S1 ran on the assumptions Q1 (`@tp/shared`) and Q7 (import is the headline).
- **Brief revision 3 (2026-09-25).** What: the owner's brief is now `docs/plan/BRIEF.md`, with the
  changes the first two turns found necessary applied (its closing section lists them), by the
  owner's permission. Why: a brief that disagrees with the plan sends every later session back to
  the same conflicts. Tests: none — documents only; `scripts/caveat-fixtures.test.ts` still holds
  the ledger and the rules to their fixtures. Next: S1b. Open: owner questions 1–4, 6 and 7, each
  with the assumption work proceeds on.
- **S1b, the detector (2026-09-25).** What: `@tp/shared/import` — the Layout IR types, a Zod
  schema typed against them and a validator for every invariant (two added: a line's derived
  fields agree with its words; source-only facts stay with their source); stage 3, `enumerate`,
  exactly `NUMBERING-RULES.md`, with its word lists as data; the debug artifact, canonical JSON
  and a pure SHA-256. Implementing the rules as production code found five defects in their text,
  fixed there and locked (roman numerals stopped short of xxxviii; R7's parent; APPEND's and D3's
  arabic parent; D4 lifted one level of a nested list and left dangling parents — the new fixture
  `letter-vs-word--nested`, which the literal reading fails; "whole word" for continuation
  notices), and one dead gazetteer entry (`mrd.`). Why: the highest-risk module, built before
  anything depends on it. Tests: the 21 enumerate fixtures green, each with its debug snapshot in
  `fixtures/numbering/debug/`, run by `scripts/caveat-fixtures.test.ts` for every fixture marked
  green; determinism over every layout document in the repository (twice, in reverse, keys
  reversed, frozen input); the grammar production by production; the gazetteers held to §9; one
  broken document per IR invariant; SHA-256 against NIST and `node:crypto`. Next: S2, the
  machine. Open: owner questions 1–4, 6 and 7; Word's own numbering (§11) waits for S7's DOCX
  extractor and its fixture.
- **S2, the machine (2026-09-26).** What: `@tp/shared/builder` walks the graph — changes resolved
  against the live state and stored with exact inverses (Back, breadcrumbs and replay agree, and
  replay needs no graph); a question's type change rebuilds the question and sets aside what it
  cannot hold; fingerprint ids that are never reused; the sidecar's first fields; sessions saved as
  base + log (`builder_sessions`, migration 0019, `GET/PUT /v1/forms/:id/builder-session` with a
  version lock). Walking every answer from every reachable state found four ways the S1 graph could
  stop or mislead — nodes reachable by escape before what they write exists, a stale answer leaking
  into the next question, a half-typed choice, a skip sentence that was not the reason — fixed in
  the graph, the schema (`skip` as a guarded list) and rule G8 (guarded lists must end in `true`,
  which it had only said); `CAVEATS.md` #62–#65. Why: every later slice renders, replays or saves
  through this. Tests: 64 new in `packages/shared/src/builder` (the whole-graph walk, eight seeded
  walks with Back, each change kind undone, ids, sessions and a recorded session in
  `fixtures/sessions/`) and three new G8 cases, 8 route tests, and the repository with its version
  lock on PGlite and on a real Postgres 16 (`database.test.ts`, which had skipped in every earlier
  run here, ran). Next: S3, the ladder T0–T4. Open: owner questions 1–4, 6 and 7; the
  reconciliation baseline (S5) and the belief (S11) join the state with their slices.
- **S3, the ladder T0–T4 (2026-09-26).** What: `@tp/shared/interpret` — normalisation whose every
  span points back at what was typed; word lists (numbers, stop words, negators, contrast words,
  vague words, months, currencies) and 2 295 built-in aliases in twelve languages, every card's
  label among them; an integer logarithm for T2's weights; T0 exact, T1 tokens, T2 weighted
  keywords, T3 fuzzy (exact fractions, a 20 000-comparison budget), T4 values (quantity, currency,
  date, e-mail, phone, org.nr, personnummer); every ask with its reason. Writing the tables found
  seven places the specification would misread, ask needlessly or could not be built — negation
  that only looked forward ("knappar behövs inte" read as yes), a negator the rules left alone
  treated as any other word ("knapper er ikke nødvendigt" read as yes), order-free aliases making
  "yes buttons no text" mean "no buttons", Chinese 不 inside 不错, T2 summing over all of an
  option's aliases, two T1 matches always asked, and the generated index — each fixed in
  `INTENT-LADDER.md` and locked by rows; `CAVEATS.md` #66–#71. Why: every text box in S4 reads
  through this, and S6's T5–T8 build on its rungs. Tests: 880 phrase-table rows in twelve
  languages, each run twice and with the aliases shuffled; the pieces (spans through NFKC,
  `lnMille` against the true value for every p ≥ q ≤ 400, the fuzzy fractions against their
  float definitions, each pattern's edges, each alias rule catching its mistake); `apps/forms`
  types every card's label in every language and gets that card at T0. Next: S4, the builder
  shell. Open: owner questions 1–4, 6 and 7; the plan change "no generated index" (ADR 0019,
  amended) is the owner's to overturn.
- **S4, the builder shell (2026-09-26).** What: New form opens the two doors — start from questions
  (the conversation) or from paper (a blank form, the editor, the paper import open) — with "Build
  it myself" beneath, and the old wizard component gone. The conversation at `/forms/:id/guided`:
  the trail, the question, its answers (cards, several at once, the number stepper, the text answer,
  the end), "Or type it" read by S3's ladder with "read that as … — change", its asks with the
  answers it could not choose between, Back, "Show all options" and "Build it myself"; every key of
  the design's table; a live region; focus to the first answer, back to the chosen one on Back; the
  new node sliding in on `--tp-motion-preview` and `--tp-ease-unfurl`, still under reduced motion;
  the live preview after the shape and at the preview moment. Every step saves — the draft, then the
  session — in order, and a second tab is never saved over. The screen's rules are functions
  (`conversation.ts`, `keyboard.ts`, `saver.ts`); the components only render. Pressing it in a
  browser found four things, each a caveat row with its test: the app's chrome left the first
  question's answers below the fold on a phone (#72, so the conversation is full screen like the
  check-in door), a long trail, and the next question sliding in, widened the screen past the phone
  (#73), focus landed in the preview's sample control (#74), and a resumed conversation would have
  saved its draft over edits made in the editor since (#75, so it resumes only on an exact match).
  Why: the buttons chain on screen is M3's demo, and every later slice's screen lives in this shell.
  Tests: 49 in `guided/` (keys, saving, starting and resuming, the trail, the way out, the preview,
  and static renders of each node kind and the doors); `e2e/guided-builder.spec.ts` — the chain by
  pressing and typing, checked against the draft in Postgres; the same chain by keyboard alone at
  360×640 with every node's answers on the first screen; the brand questions there too; a reload
  mid-conversation back to the same question; the paper door, landing in the editor with the paper
  import open. Next: S5, the preview moment and inline editing. Open: owner questions 1–4, 6 and 7.
- **S5, the preview moment and inline editing (2026-09-26).** What: the preview moment — the real
  control through `FormPreview`, on the organisation's own kit (the signed-in app wears it), the
  whole form under the logo in its slot for a brand preview, the fixed sentence "Not completely
  happy with the preview? Click it to edit." ("Tap" on a touch screen), "What Loppa assumed" with
  its ways back, and a "Show me" chip. Inline editing on the same reducer (`edit()`, `source:
  'manual'`): named shape samples, a size step that stops at both ends, three brand-role swatches,
  the question's and answers' words in place, answers moved by drag or by Move up / Move down, and E
  to open it; every gesture a step Back undoes. "changed by hand" with Revert to guided.
  Reconciliation in the machine (`reconcile.ts`): each guided step records the question it left; a
  question changed by hand is never changed by a later step, which proposes instead — the person's
  version with its change on top — and the screen asks "You changed this by hand. Keep your version,
  or use the guided one?" (Keep mine / Use guided / Show both). Coming back from the classic editor
  carries on over its draft with a fresh log (`rebase`) instead of starting again. The form schema
  gained `tab` and `segmented` shapes and `FormSettings.layout.logoSlot` (six named slots, never a
  position), laid out by one `Masthead` on the public page and in the preview; the editor offers
  both; the graph (version 2) offers the two shapes and writes the slot into the form. Why:
  acceptance S3, and non-negotiable 4 made a property of the machine rather than a promise. It
  found: a hand edit written over by the next answer (#76), a resume after the editor deleted the
  question in focus stuck at a node it could not answer (#77), and a stacked "one bar" drawn as
  rounded pieces (#78); #75 now carries on rather than starting again. It raised owner question 8:
  the colour preset would restyle the whole organisation and only an administrator may, so it is
  recorded, not applied. Tests: a property test that 40 seeded walks with hand edits among the
  answers never change a question changed by hand, and 12 more on reconciliation; the layout schema;
  every inline gesture through the real machine, with snapping at both ends; static renders of the
  preview, the editing panel and the reconcile question; the recorded session reviewed (one baseline
  per step, draft unchanged); `e2e/guided-builder.spec.ts` presses acceptance S3 — shape, size,
  colour, a rename, a move by button and one by drag, Revert and Back, Show both and Keep mine, then
  a rename in the classic editor and back. Next: S6, the ladder T5–T8. Open: owner questions 1–4, 6,
  7 and 8.
- **S6, the ladder T5–T8 (2026-09-28).** What: one sentence answering several questions —
  "three buttons, pill shape, side by side" — each answer its own step, those ahead of their turn
  marked decided so they are not asked again (the machine's `answerAt` and `fill`; graph version 3
  gives each such node a `slot`, and rule G14 holds its guard to it); a list — typed, or pasted and
  read through the paste layout and the list-number detector — as the options, labels verbatim;
  "Did you mean …?" for another question of the group, confirmed before anything happens; after a
  miss, the offer to remember the words, only on the press; two misses in a row list the group; the
  organisation's learned aliases (`builder_aliases`, migration 0020, `/v1/builder/aliases`) with
  an administrator's page to list, delete, export and import them, an import showing its diff and
  storing nothing until confirmed. Why: M4's demo, and T8's "ask, then learn". It found nine traps
  (#79–#87), among them one word read as two answers, misspellings read for questions not asked,
  numerals inside words read as numbers (四角 made four options — an S3 defect), and a list of
  answers read as a list of options; `INTENT-LADDER.md` closes with what changed. Tests: 427
  phrase-table rows (at least ten per tier per language for T5, T6 and T7), `ahead.test.ts` (answers
  ahead of their turn, with seeded walks), `group.test.ts`, `paste.test.ts`, the alias routes on
  the memory store, PGlite and Postgres (with the race), the screen's logic and renders, and three
  journeys in `e2e/guided-builder.spec.ts`. Next: S7, extract and reassemble. Open: owner questions
  1–4, 6, 7 and 8; question 4 (learned aliases per organisation) is now built as proposed.
- **S7, extract and reassemble (2026-09-28).** What: stage 2, `reassemble`, in `@tp/shared/import`
  (`layout/`) — ligatures, column regions by XY-cut, lines, page furniture, blocks, hyphenation,
  footnotes, tables, headings, bands and hints, and the document's language, every decision in its
  debug artifact under a rule id; Word's own numbering in stage 3 (NUMBERING-RULES §11, W1: Word's
  marker, level and list as fact, the whole text the label; stage version 2); the DOCX reader in
  `apps/forms` (`paper/docx.ts`, `zip.ts`, `xml.ts`: no dependency, caps counted while reading, a
  DTD or entity refused before parsing, counters kept as Word keeps them); the PDF text layer as a
  raw document (runs split into words, bold from the font, printed rules from the drawing
  operations); the clipboard, plain text over HTML; stages 2–3 in a worker with a 30-second stop;
  and the paper door reading a PDF, a Word file or a paste and showing the numbered items in order,
  with the whole reading as a download — changing nothing. Writing the fixtures found six places
  the specification would misread: a horizontal cut at 1.5 × a pitch that does not exist yet (the
  introduction over two columns never cut off), leaves merged by "x extents that agree" (a heading
  kept apart from its text), a tab after "1." or blanks at a tab stop taken for a column gutter
  (#88), "för-" joined to "och" (#89), a median pitch that is a paragraph gap on a form of short
  sections (#91), and Scandinavian stop words that made every Nordic document a tie (#95); and
  Word's counters, specified per `numId`, restart lists Word continues (#93). Each is fixed in
  `IMPORT-PIPELINE.md` §1–§2 and locked by a fixture or test. Why: M4's demo — a two-column PDF and a
  Word file with real numbering read in order, their debug JSON shown. Tests: the 5 reassemble
  fixtures green and 4 new ones (`hanging-marker-gutter`, `answer-column-gutter`,
  `hyphen-not-across-boundary`, `headings-and-footnote`), `docx-numbering` (enumerate), each with its
  debug snapshot; `layout/reassemble.test.ts` (60 seeded pages always valid, the same bytes whatever
  order the words arrive in, each step's edges, a paragraph in each of the twelve languages);
  `budget.test.ts` (twenty dense pages in 0.85 s of a 4 s budget); `docx.test.ts` (Word's counting,
  fields and hidden text, tables, every cap, a mutation of the restart rule caught);
  `extract.test.ts` (words from runs, rules from operators); `clipboard.test.ts`;
  `pipeline.test.ts`; `bundle-split.test.ts` (#43); and `e2e/paper-import.spec.ts` (a Word file in
  order through the worker, its download, a paste and an HTML paste, an unsafe file refused). Next:
  S8, enumerate on real input — the corpus. Open: owner questions 1–4, 6, 7 and 8; "table or
  columns" joins the known unknowns.
- **S8, enumerate on real input (2026-09-28).** What: the golden corpus's first ten documents
  (`fixtures/documents/`), each a PDF and a Word file — seven Swedish, one each in English,
  Danish, Norwegian, Finnish and German — written as readable specs (`scripts/corpus/documents.ts`,
  `word.ts`) and turned by LibreOffice into the files the tests read (`pnpm corpus:build`), so they
  are a real word processor's: fonts, kerning, list numbering, headers, fields, section columns.
  `SOURCES.json` holds each file's hash; each document's expectation was written by hand before it
  ran; `corpus.test.ts` reads each file with exactly the paper door's code and stages 2 and 3, and
  holds the PDF and the Word file to the same expectation. Running real documents found three
  misreadings, each fixed in `IMPORT-PIPELINE.md` §2.2 or `NUMBERING-RULES.md` with its fixture
  written first: a heading in large type cut into a column per word (a gutter is now at least two
  ems too, #96, `large-heading-words`); a two-column list inside the flow read across its columns
  (rows are cut at every gap and rows that share a gutter are columns, C4, #97,
  `columns-without-margin`); and a list continued in a column whose left edge is not the page's
  flagged or mis-nested (R8b, #98, `column-break-indent`). Reassemble to version 2, enumerate to
  version 3. Why: M4's demo — real PDFs and Word files read in order. Tests: the corpus (10
  documents × 2 formats, items, details and language, and 40 debug snapshots; against S7's
  stage code the two-column document fails); 3 new fixtures green with their snapshots;
  `layout/reassemble.test.ts` (a gutter of two ems, rows that share a gutter). Next: S9, segment,
  classify and score. Open: owner questions 1–4, 6, 7 and 8; "table or columns" has its first
  evidence (checkbox tables keep their rows) and waits for a table of text alone.
- **S9, segment, classify and score (2026-09-29).** What: stage 4 (`import/segment/`) — every
  line read once, as a heading, an instruction, a form number, a question with what answers it, a
  grid or a table, in three passes: structures claim their lines first (grids by geometry and from
  Word's cells, repeating tables, tables of text re-read row by row, a grid's label or the question
  that points at "the table below"), then items with items under them (options, or a section), then
  every line left, rule by rule; stage 5 (`import/classify/`) — a proposed kind, required or not, a
  format and chips for every question, by integer weights (`weights.json`) over word lists in
  twelve languages and the committed sigmoid (`interpret/sigmoid.json`, made by an integer series);
  stage 7 (`import/score/`) — a confidence and bucket for every segment, the OCR cap, and required
  as a decision of its own; a PDF's own form fields over its text (#54, `fields.ts`); stages 2–7 in
  the paper door's worker (`import/pipeline.ts`), and the reading's download with all of it. Why:
  M5 — an import that ends in questions the review screen (S10) can show, "I read 14 questions. 3
  need your eye." Found on the way, each fixed with its fixture first: the heading rule taking a
  real table's header cells (#99); a table's edge read as an answer line (#100); a Word grid
  (#101); the question that points at a table (#102); options versus a section (#103); one checkbox
  per line (#104); two blanks on a line (#105); a sentence that asks (#106); a paragraph cut where a
  long word wrapped, or two joined (`arsmote-anmalan`); required as a cap on the whole question;
  Scandinavian definite forms missing from the word lists (`namnet`); "table or columns", decided on
  a new corpus document, `lagerschema` (#108), which also found that a schedule's times read as list
  numbers — V6, enumerate version 4 (#107); and hashing that took most of the budget (now 0.75 s for
  twenty pages through stages 2–7). Decided: the grid fallback stays (no grid type); the owner's
  questions, on their delegated answer. Tests: the 4 fixtures owed and 11 new ones green, with
  their snapshots; `segment.test.ts`, `classify.test.ts` (a row for every feature, every language),
  `pipeline.test.ts` (#20, #26, #54, the counts), `sigmoid.test.ts`; the corpus (11 documents × 2
  formats, items and segments, 110 debug snapshots, mutation-checked); the budget (stages 2–7).
  Next: S10, the review screen. Open: ADRs 0017–0021 to accept; scanned pages and other writers'
  files in the corpus; `glued-marker`.
- **Owner question 8, the colours (2026-09-29).** What: "Which colours should your form use?" is
  asked only of an administrator (graph version 4, input `pending.canChangeBrand`); anyone else
  passes it by, and the trail says "Your organisation's colours are set by an administrator." An
  administrator's choice, pressed or typed, is held — not taken — until "Use these colours for all
  your organisation's forms? (changes your brand kit)" is confirmed; then the preset is saved over
  the organisation's kit, its logo kept (or as its first kit), and only once it is saved does the
  conversation move on. Cancel, Back or Escape change nothing. A resumed conversation reads today's
  facts, so a role or a kit changed since decides what is asked from then on. The Brand screen's
  gallery and the conversation apply a preset with one function (`lib/theme-preset.ts`). Why: the
  owner's delegated answer to question 8 — one brand source of truth, and no form restyling the
  others silently. Tests: the operator's skip and its reason, the administrator's question, a
  preset held however it was given (and again when chosen twice), the resume with today's facts, the
  presets the graph offers against the kit's (#32), the machine's walk from both kinds of person,
  and two journeys in `e2e/guided-builder.spec.ts`: Cancel and Escape change nothing, Enter makes
  the first kit in Garden's colours; an operator is never asked. Next: S10.
- **S10, the review screen (2026-09-29).** What: "Start from paper" opens a review of the document
  at `/forms/:id/import`: "I read 14 questions. 3 need your eye.", the document beside the form it
  would make — a PDF as its own pages, a Word file or a paste as its lines — linked line by line
  both ways; every question as the control it will become; chips of the three likeliest types on
  what is not sure; accept, merge with the item before, split at a line, "this is just text",
  "make this a question", each with its own Undo and a key (`IMPORT-PIPELINE.md` §8, "As built").
  "Use these questions" is shut while anything needs your eye, and then adds everything, verbatim
  and in order, as one step in the form's conversation (`importQuestions`), saved before the
  editor opens. First, the bundle: `@tp/shared` without side effects and the stages only in their
  worker took the total from 978.4 to 914.4 KB and the editor's chunk from 42.7 to 29.4 (#109).
  Why: M5 — an import that ends in real questions, which the plan (Q7) put before the guess. Found
  on the way: the stages in the editor's chunk (#109); a chip press lost to a layout shift (#110);
  a PDF line covered by the one below it (#111). Decided: the review's actions stay on the screen
  (the form changes once); nothing below the threshold is added unsettled; consent is a yes/no,
  as the wizard asks it. Tests: `review.test.ts` (acceptance S4 and S5 at the model, every action,
  undo by replay, every mapping, ids and keys, through the machine into a publishable form),
  `keys.test.ts`, `panes.test.tsx`, `imported.test.ts` (the import step), classify's top three;
  `e2e/review.spec.ts`: S4 by pointer and by keyboard alone, S5, the gate, a PDF linked both ways
  with merge and Undo, a Word grid. Next: S11, the belief engine. Open: ADRs 0017–0021; photographs
  and scans through the stages; S12's decided slots.
- **S10, after its review (2026-09-29).** What: an adversarial read of S10 found words a merge or
  "just text" dropped, a PDF form field without its printed options, grid chips that did nothing,
  table columns with one key between them, a reading of no questions with no way on, a save
  conflict that left the screen stuck, split parts that both kept the options, a selection left on
  an item that had gone, two drawings on one canvas, and a screen that could be left mid-save. All
  fixed, each with its test (#112–#114; `IMPORT-PIPELINE.md` §8, "As built": no word lost and none twice; how
  many questions; saved in another tab). Decided: a grid of two or more columns counts as a
  question per row, everywhere the number is said; the import step counts questions, not headings
  and text (`packages/shared`: `importQuestions`); a second import into an imported form keeps it
  imported; "Why?" names stages and verdicts in the person's language. The editor's paper canvas
  had the same two drawings on one canvas, and is fixed with it. Tests: `review.test.ts`
  (merges, splits, "just text", the form field, the selection, the count), `keys.test.ts`,
  `panes.test.tsx`, `imported.test.ts`; `e2e/review.spec.ts`: a reading of no questions made one,
  saved in another tab, the Word grid's count through to the conversation.
- **S11, the guess (2026-09-29).** What: after "What is this form for?" the conversation asks
  yes / no / not sure questions (twenty-two, graph version 5), each the one expected to tell it most,
  until one of 25 recipes — the 23 templates and two structure-only ones rule 8 keeps out of the
  catalogue — is at 800 per mille: "This looks like a proxy form. Right?", with "Why this guess".
  "Right" adds the template's questions as the conversation's own, in place of an untouched
  starter, shows the whole form to change in place, and goes on with only the gaps; "Sort of" and
  "No" ask on (`BELIEF.md`). All in integers: `expMicro`, a 40-digit series, beside `lnMille`. Why:
  M5 — brief §6 and ADR 0019 point 4. Decided: a score is normalised over its node's options
  (added as it stood, no question could be weighed against another), so `flow.start`'s were re-set
  and the one on `choice.buttons` removed (G9 now refuses a score alone); twenty-two questions, not
  eight, which could not tell 25 recipes apart; at most five asked, and two "Not sure" end them; the
  catalogue comes from the API, not the bundle (#118); the guess questions' yes, no and not sure are
  written once per language, not once per question (`aliases/answers.json`, 18 KB). Found on the way: no recipe could reach
  800 (#115), "Not sure" for ever (#116), a name asked twice after "Right" (#117), a sure recipe
  never offered after "No" (#119), the guess begun again after a trip to the editor (#120), a recipe named by its id when the
  catalogue did not load (#121). Tests:
  `belief.test.ts` (frozen numbers, every recipe as itself), `seed.test.ts`, `exp.test.ts`, G9 and
  G11 cases, `guess.test.tsx`, two journeys in `e2e/guided-builder.spec.ts`; every earlier walk now
  passes the guess. Next: S12, convergence. Open: `member-details` and `absence-notice` answer
  alike (`BELIEF.md`, "Known limits"); the brief's five new templates; ADRs 0017–0021.
- **S12a, the conversation over an imported form (2026-09-30).** What: "Use these questions"
  records what the document decided about each question — its kind always, whether it must be
  answered when the document said either way, its options when they were printed — and goes on in
  the conversation (not the editor) at "Go through the questions from your document?" (graph
  version 6, group `import`). Each question is walked in the form's order through the chain every
  question goes through, which passes by what the document decided; "Go on to the next one?"
  between them, "No, stop here" always one press; then the brand and "Add another question?".
  Why: acceptance S6, the two doors converging. Found on the way: an imported choice passed by
  with "You chose no buttons" (#122), and a shape on a dropdown changed nothing (#123); the editor
  had no way into the conversation, so the review now hands over to it. Decided: a format check
  (personnummer) waits for the form schema to have one; the template match after an import waits
  for the belief to read imported labels (`CONVERGENCE.md`, "Not in S12"). Tests: `walk.test.ts`,
  the whole-graph walk from an imported form, `review.test.ts` (what the document decided), and
  acceptance S6 in `e2e/review.spec.ts` by pointer and by keyboard alone. Next: S12b, the paper
  twin from an import.
- **S12b, the paper twin from an import (2026-09-30).** What: a PDF read on the review screen is
  kept with the form (the editor's own route) before its questions are added, and each question,
  option and grid row gets its box on the page — a form field's widget, else its blank runs after
  its own label, else its checkboxes, else the rest of its line (`import/anchors.ts`, pure, in
  layout units); the source joins `definition.paper.sources` in the import's one step. A response
  then comes back as that paper, through `documents/paper.ts` unchanged. Why: owner question 2 —
  the paper twin is the default for an imported form that kept its source. Found on the way: two
  questions on one line would have shared both blanks (#124); a form keeping twenty documents
  would have refused the twenty-first's questions on every press (#125), so those come without
  their places, said first. Tests: `anchors.test.ts` (and every box of every layout fixture within
  its page), `review.test.ts`, `imported.test.ts`, and `e2e/paper-twin.spec.ts` — published,
  filled in, downloaded and read with pdf.js, each answer inside its box on its label's line
  (a shifted box fails it, checked by mutation); a file that cannot be kept; a full form. Next:
  S12c, importing the same form again.
- **S12c, part one: stage 9's comparison (2026-09-30).** What: `compareImport` and `planImport`
  (`import/reimport.ts`, pure, integer): a form's fields and its document read again, matched by
  id — the id is the source text's fingerprint, so an unchanged field has the one it was given and
  nothing needs storing per author — then by Dice at least 4/5 within three places, then by the
  same wording anywhere when it is one field's on each side; what is added, asked back, reworded,
  gone or moved, and the plan the person's choices make of it. Why: the plan lands before the code,
  and the comparison is the part a test can freeze. Found on the way: without the third rule, four
  questions inserted before one would have added it twice (#126). Tests: eleven fixtures in
  `fixtures/reimport/`, written first and compared whole; the Dice arithmetic exactly; the edges.
  Next: the machine's step and the review screen's update.
- **S12c, part two: the update on screen (2026-09-30).** What: the machine's `reimport` — one step
  that adds, moves, rewords and removes, Back exact — and the review screen's update mode: "Update
  from a document" in the editor, "Compared with your form" with a toggle for each question asked
  (every toggle starting off), "Update the form" held back only by what it would add, and the
  document the form keeps said to be unchanged. Twenty-one messages in twelve catalogues. Why:
  stage 9, acceptance "re-import asks before removing". Found on the way: a form made by hand had
  every addition put above what the person made (#127). Tests: `builder/reimport.test.ts`,
  `review/reimport.test.ts`, and two journeys in `e2e/reimport.spec.ts`. Next: S13.

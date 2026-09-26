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
| **S4** Builder shell | the two doors, `Shell`, cards, quantity, trail, keyboard, motion token; the buttons chain end to end | component tests; e2e for S2 without editing | `apps/forms`, `packages/tokens` (`--tp-motion-preview`) | not started |
| **S5** Preview + inline editing | `PreviewMoment`, `InlineEdit/`, "changed by hand", reconciliation; `ChoiceStyle` gains `tab`, `segmented`; `FormSettings.layout` | e2e for S3; snapping; reconciliation never clobbers | `apps/forms`, `packages/shared` | not started |
| **S6** Ladder T5–T8 | multi-slot parse, list extraction (through the paste IR), group ranking, disambiguation, alias capture, export/import, `builder_aliases` | T5–T7 tables; capture needs consent; import diff | `packages/shared`, `apps/forms`, `apps/api-forms` | not started |
| **S7** Extract + reassemble | `paper/docx.ts`, `paper/paste.ts`, operator-list rules in `extract.ts`, `import/layout/`, `import.worker.ts`; Word's own numbering in enumerate (`NUMBERING-RULES.md` §11) | the 5 reassemble fixtures; a DOCX numbering fixture; DOCX caps and entity refusal; the budget | `apps/forms`, `packages/shared` | not started |
| **S8** Enumerate on real input | S1b wired to extraction; the corpus's first documents | the corpus so far, through stages 1–3 | `packages/shared`, `fixtures/documents/` | not started |
| **S9** Segment + classify + score | `import/segment/`, `import/classify/` (`weights.json`, lexicons, sigmoid table), buckets | the 3 segment and 1 classify fixtures; #22–#30; every feature | `packages/shared` | not started |
| **S10** Review screen | `review/`, highlight linking, chips, merge/split/just text, "Use these questions" | e2e for S4 and S5 | `apps/forms` | not started |
| **S11** Belief engine | `belief/recipes.json`, integer log-odds, entropy-driven next node, three-state guess, seeding (structure only for rule-8 templates) | belief determinism; "why" lists the three strongest answers; seeding never adds operative wording | `packages/shared`, `apps/forms` | not started |
| **S12** Convergence, paper twin, re-import | `decided()` slots from import, anchors from the IR, `definition.paper` from an import, stage 9 | e2e for S6; a filled response as its paper; re-import asks before removing | `packages/shared`, `apps/forms`, `apps/api-forms` | not started |
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

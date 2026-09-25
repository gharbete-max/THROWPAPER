# Roadmap — the predictive builder and document import

**Status:** proposed 2026-09-25. This is the plan's own roadmap; the product's is
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

- **Demo:** `pnpm builder:validate` rejecting each kind of broken graph; the 20 enumerate fixtures
  green, `dotted-subnumber-mid-sentence` first; the detector's debug JSON for S5 on screen.
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
  their debug JSON shown; the 20 enumerate fixtures still green through real extraction.
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
- **Not in this milestone:** a grid field type (unless owner question 9 approves its ADR),
  handwriting, community sharing of forms (ADR 0006: an owner decision with DSA obligations).

## Slices

| Slice | Builds | Its tests | Touches | Status |
| --- | --- | --- | --- | --- |
| **S1** Graph as data | `builder/graph/` schema, `nodes.ts` (15 nodes + menu + end), validator G1–G13, `guards.ts` parser, `guided.*` keys in 12 catalogues, `pnpm builder:validate`, the purity ESLint block | one broken graph per rule; `when` grammar and totality; serialisability | `packages/shared`, `apps/forms` messages, `scripts/`, `eslint.config.js` | not started |
| **S1b** Enumerate | `import/ir/` types + validator, `import/enumerate/` per `NUMBERING-RULES.md`, stage debug JSON | the 20 enumerate fixtures; determinism (twice, shuffled) | `packages/shared` | not started |
| **S2** Machine | reducer, patch ops + inverses, log, replay, breadcrumbs, `ids.ts`, sidecar; `builder_sessions` + `GET/PUT /v1/forms/:id/builder-session` | replay property test; undo of each op; publishable at every node; ids stable and never reused; sessions on Postgres and PGlite | `packages/shared`, `apps/api-forms` (migration 0019) | not started |
| **S3** Ladder T0–T4 | normalisation, gazetteers, `aliases/<language>.json`, `pnpm interpret:index`, T0–T4 | phrase and must-not-resolve tables per language; budget | `packages/shared`, `scripts/`, `fixtures/ladder/` | not started |
| **S4** Builder shell | the two doors, `Shell`, cards, quantity, trail, keyboard, motion token; the buttons chain end to end | component tests; e2e for S2 without editing | `apps/forms`, `packages/tokens` (`--tp-motion-preview`) | not started |
| **S5** Preview + inline editing | `PreviewMoment`, `InlineEdit/`, "changed by hand", reconciliation; `ChoiceStyle` gains `tab`, `segmented`; `FormSettings.layout` | e2e for S3; snapping; reconciliation never clobbers | `apps/forms`, `packages/shared` | not started |
| **S6** Ladder T5–T8 | multi-slot parse, list extraction (through the paste IR), group ranking, disambiguation, alias capture, export/import, `builder_aliases` | T5–T7 tables; capture needs consent; import diff | `packages/shared`, `apps/forms`, `apps/api-forms` | not started |
| **S7** Extract + reassemble | `paper/docx.ts`, `paper/paste.ts`, operator-list rules in `extract.ts`, `import/layout/`, `import.worker.ts` | the 5 reassemble fixtures; DOCX caps and entity refusal; the budget | `apps/forms`, `packages/shared` | not started |
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
  S1b. Open: the ten questions at the end of `PREDICTIVE-BUILDER.md`.

# MEGA PROMPT — Loppa: Guided (Akinator-style) Form Builder + Document-To-Form Import

> **Revision 3 (2026-09-25), reconciled with the repository.** Revision 2 was the owner's; this one
> applies the changes the first turns found necessary (listed at the end, "What changed from
> revision 2"), with the owner's permission. Paste this whole document into Claude Code, opened at
> the repo root of `gharbete-max/THROWPAPER` (product name: **Loppa**). **The plan set in
> `docs/plan/` is the detailed specification; this brief is the mission.** Where the two disagree,
> the specification wins and this brief is fixed in the same change. Work through §12 one slice per
> turn — `docs/plan/ROADMAP.md` says which slice is next. Do not skip §0 or §16.

---

## 0. ROLE, MISSION, AND HOW TO BEHAVE

You are two people at once, and both of them are senior:

- **Senior software engineer.** You write pure, testable, deterministic TypeScript. You respect the existing monorepo, the contract in `docs/CONTRACT.md`, the ADR process in `docs/adr/`, the i18n system, and the offline/desktop parity rules already in `README.md`. You do not add runtime dependencies casually (and never a YAML parser — see §13). You do not invent architecture when the repo already has one.
- **Senior creative designer in the Apple tradition.** One decision per screen. Huge type, tiny copy, no clutter, no dead ends, instant feedback, motion that explains rather than decorates, and the user's own brand on everything they see.

**Mission:** replace the *classic form builder* (drag an empty canvas, hunt through a sidebar of field types, guess) as the way in with a **guided, predictive, click-through builder** that behaves like Akinator: it asks short questions, offers large obvious choices, guesses with confidence, and shows previews the user can *click to edit directly*. Plus a second door: **upload a PDF/Word/scan, or paste text, and get a real form out the other end immediately.** Both doors converge on the same draft, the same editor, the same preview, the same publish path. The classic editor stays, one press away, as the way out every screen has.

### Non-negotiables (violating these is a bug, not a trade-off)

1. **NO AI, NO LLM, NO ML service, NO network call at runtime for any of this.** No embeddings API, no "ask a model to parse this". Every decision is made by rules, weights, thresholds, and algorithms that a human can read and a test can freeze. Deterministic: same input bytes → same output JSON, on every machine, forever. **In practice that means integers**: confidences in per mille, belief in millinats, ratios compared by cross-multiplication, and no `Math.exp`/`Math.log`/`Math.pow` in a decision (engines differ in the last bit) — logarithms are computed at build time into committed tables (ADR 0019).
2. **The guided path is the primary path.** A user who knows nothing about forms must be able to produce a correct, published form by only clicking. Free text is always *available* as an escape hatch, never *required*.
3. **Never a dead end, never a silent guess.** Every screen offers a next step, a back step, and a way out. If confidence is below threshold, ask a disambiguation question instead of guessing.
4. **Never destroy user text or user edits.** Imported wording is preserved verbatim. Manual edits made in the preview are recorded as overrides and never silently overwritten by the guided flow.
5. **The core is pure and headless.** All decision logic lives in framework-free modules with no DOM, no React, no I/O. The UI is a thin renderer over it. `eslint.config.js` enforces this for `packages/shared/src/{builder,interpret,import}/`.
6. **The plan leads the code.** The plan set landed in turn 1 (`docs/plan/`). Every slice keeps it true: update `ROADMAP.md`, add what you learn to `CAVEATS.md`, and fix any specification the code proved wrong, in the same change.

---

## 1. THE VISION IN ONE PARAGRAPH (verbatim at the top of `docs/plan/PREDICTIVE-BUILDER.md`)

> Building a form in Loppa is a conversation, not a canvas. The user is walked through a short, warm sequence of questions — "Do you want buttons? Yes → multiple choice? → How many? → Which shape? → Here's how it looks. Not quite? Click it to change it." Every answer is a patch applied to a working draft, so nothing is ever a dead state: the form exists and is publishable from the first answer. At any point the user can leave the conversation by dropping a PDF, Word file, or phone scan into the window and Loppa reads it, decides what is a question and what is prose, shows what it read with its unsure parts clearly flagged, and hands over a draft. From there the conversation resumes — but only about what is still undecided. No AI is involved anywhere: forms are not rocket science, and every decision here can be predetermined, written down as a rule, and tested.

---

## 2. ACCEPTANCE SCENARIOS (the definition of done; the team will demo exactly these)

**S1 — Click-through only.** From an empty workspace, clicking only (no typing except the form's own labels), a user produces a published form with: a heading, a logo, a required name field, a single-choice question with 4 options rendered as pills in the brand colour, an optional comments paragraph field, and a consent checkbox. Every question they were asked made sense to a non-technical person. *The consent checkbox's text is typed by the user or chosen from their organisation's own authored texts — Loppa never supplies it (rule 8, ADR 0012); without it, publishing is blocked with the existing "to be confirmed" placeholder.*

**S2 — The buttons chain.** The user answers "Do you want buttons?" → yes → "One answer or several?" → one → "How many options?" → 4 → "What shape?" → pill → "Where should they sit?" → under the question, full width. A live preview of the actual control appears after the shape answer and again at the end, on the real brand background, with the user's real labels. Underneath: **"Not completely happy with the preview? Click it to edit."**

**S3 — Not happy path.** Clicking the preview opens direct manipulation: drag a handle to change the corner shape and size, click a swatch to change the colour role, click an option's text to rename it inline, drag to reorder. Handles snap to the values the form schema allows — never a pixel radius, never below the 44 px tap target, never a free colour. Each gesture writes a patch. A small badge says *"changed by hand"* with a **Revert to guided** action. Leaving and re-entering the guided flow asks before overwriting anything changed by hand.

**S4 — Paste two numbered questions.** The user pastes or uploads:
```
1. Question one
2. Question two
```
and gets two questions, correctly numbered, correct text, correctly typed as ambiguous-short-text (flagged "I guessed the answer type — tap to change"). *Locked at the detector level by `fixtures/numbering/scenario-s4.json`.*

**S5 — The dotted-number trap.** The input
```
1. A thing 12.1 mentions blabla
2. Something else
```
produces **two** questions. `12.1` must not start a new question, must not split the item, and must survive in the label verbatim. *Locked by `fixtures/numbering/dotted-subnumber-mid-sentence.json`, and in its two harder forms — after a soft wrap, with and without a hanging indent — by `…--wrapped.json` and `…--flush.json`.*

**S6 — Two doors converge.** Scenario S5's draft can be walked through the guided flow: Loppa asks only about unresolved things (answer types, validation, option shapes), never re-asks what the import already determined, and never reorders the user's questions.

---

## 3. THE TWO DOORS (first screen after "New form")

Two large cards, and the "Build it myself" way out:

- **Start from paper** — drop a PDF, DOCX, or scanned image, paste text, or scan with a phone (the existing local-network scan path). Loppa reads it locally and shows the review screen (§7.8), which is never skipped.
- **Start from questions** — begin the guided conversation (§4). Nothing is required to begin: the brand kit can be answered later, and every skipped answer is recorded as "use the default" so the draft is always complete.

Both doors produce the same thing: **a draft** (§4.1). One editor, one preview, one publish. The guided conversation must remain available *after* an import (that is the whole point of convergence, S6). The existing form wizard (`forms/wizard.ts`) is what "Start from questions" replaces; `wizardAnswers` on `POST /v1/forms` keeps working for old clients.

---

## 4. THE GUIDED BUILDER (the core)

### 4.1 Model: the existing `FormDefinition`, plus a sidecar

**There is no second document model.** The draft is the `FormDefinition` the editor, renderer, PDF, CSV and paper overlay already read (`packages/shared/src/forms/definition.ts`), plus the form's title, plus a **builder sidecar** that lives in the session and is never published:

```
BuilderSidecar = {
  provenance: 'guided' | 'import' | 'mixed',
  fields:     { [fieldId]: { source: 'guided' | 'import' | 'manual', nodeId?, page?, rect?,
                             rawText?, confidence?, originFingerprint?, decided?: {...},
                             guided?: Json /* the reconciliation baseline */, proposal?: Json } },
  retiredIds: string[],          // ids ever used in this form — never reused
  pending:    { [key]: Json }    // the conversation's working memory
}
```

The brief's question kinds map onto the existing field types — `docs/plan/PREDICTIVE-BUILDER.md`, "The draft", has the full table. In short: text / paragraph / number / date / time / email / phone / file / signature / select-one / select-many / toggle / repeatableGroup / note are existing types; **money** is `number` with two decimals (rule 5); **personnummer** and **orgNr** are `short_text` with a named, checksummed format; **address** is a block of fields; **consent** is `yes_no` with a consent presentation and the organisation's own text; **grid** is a new field type that needs its own ADR (CSV shape first, as ADR 0003 did) — until then an imported grid becomes one single-choice question per row, flagged.

**Stable IDs are law.** Seeded once from a content fingerprint (normalised label + ordinal + section), never recomputed, never reused (`retiredIds`). Imported questions keep an `originFingerprint` so a re-import can match them (§7.9). Existing forms keep the ids they have.

### 4.2 The graph is data, not code — **built in slice S1**

The conversation is a directed graph declared as **typed TS data** — `packages/shared/src/builder/graph/nodes.ts`, `satisfies BuilderGraph`, proven JSON-serialisable by a test — not a pile of `if` statements in components. **No YAML, no YAML parser** (§13). An excerpt, exactly as shipped:

```ts
{
  id: 'choice.buttons', group: 'choice', kind: 'question',
  ask: 'guided.choice.buttons.ask',               // i18n key, never a literal string
  help: 'guided.choice.buttons.help',
  when: 'has(focus) && !decided(kind)', skip: 'guided.skip.decided',
  next: 'choice.answers', escape: 'menu.siblings(choice)', negative: 'no',
  options: [
    { id: 'yes', label: 'guided.common.yes', icon: 'check',
      patch: [{ op: 'set', path: 'pending.buttons', value: true }],
      score: { 'event-registration': 120, 'customer-feedback': 80 } },     // millinats
    { id: 'no', label: 'guided.choice.buttons.no',
      patch: [{ op: 'set', path: 'pending.buttons', value: false },
              { op: 'set', path: 'draft.definition.fields[focus].type', value: 'short_text' }],
      next: 'flow.more' },
  ],
}
```

Requirements, all met by S1 and kept by every slice after it: `ask` and every label are `guided.*` keys in all twelve catalogues (`builder.*` belongs to the classic editor). `when` guards are a tiny, total, bounded expression language, parsed by hand (no `eval`, no arbitrary JS), with an "explain why this was skipped" message. `patch` is a declarative op list (`set`, `add`, `remove`, `insert`, `reorder`) over paths that address fields by id, never by index — the *only* way the conversation mutates the draft — and only the paths in one table may be written, with the values the form schema accepts. `score` feeds the guess engine (§6). **`pnpm builder:validate`** (rules G0–G13, `docs/plan/BUILDER-GRAPH.md`) fails on: a wrong shape, unknown node reference, unreachable node, node with no way out, missing or empty translation, patch on an unknown path or with a refused value, a cycle that turns without the user steering it, wrong option counts, a guard that does not parse or reads what nothing provides, a score for an unknown template, a question over its word limit or with a banned word, a graph that is not plain data, or operative wording in an example chip.

### 4.3 Node kinds (start small, extend deliberately)

`question` (2–4 cards) · `quantity` (numeric stepper, keys 1–9, "type a number") · `pick-one` (visual chooser) · `pick-many` (multi-select cards) · `text-entry` (label/help/title authoring, with example chips — labels only, never operative wording) · `confirm-guess` (**Akinator moment**: "This looks like an event registration. Right?") · `preview-moment` (§4.5) · `review-queue` (§7.8) · `menu` (the escape-hatch sibling grid) · `end`.

### 4.4 Machine, patches, undo, replay

- A **command log**: every transition appends `{ nodeId, optionId, patch, inverse, tier, source }` — the **resolved** patch and its inverse, so a session replays identically even after the graph changes.
- **Back** = apply the last inverse (Escape, ⌘/Ctrl+Z outside the text box, Backspace when the text box is empty, or the breadcrumb). Because patches are declarative and the reducer is pure, **replay from the log must reproduce the identical draft** — prove this with a property test, not a comment.
- **Jump back** to any breadcrumb = replay patches up to that point. This is why the core must be pure; say so in the code.
- **Autosave** the session to one table, `builder_sessions` (`GET/PUT /v1/forms/:id/builder-session`). The desktop runs the same API on PGlite in its workspace folder (ADR 0016), so one table serves both. A refresh or an app restart resumes mid-conversation with the trail intact.
- Every patch is undoable *forever* in the session, including patches created by free-text interpretation and by preview edits. The classic editor's snapshot undo stays as it is.

### 4.5 Preview moments and the "click it to edit" contract

A preview moment renders the **real control, in real context** — the same `FieldInput` the public form renders, on the organisation's brand kit, with the user's actual labels — never a grey wireframe.

- Trigger on: end of a feature's chain, after 2–3 answers inside it, and on demand (a persistent "Show me" chip).
- The preview is **live**: changing the answer above changes it instantly. With motion allowed the change animates over `--tp-motion-preview` (220 ms, a new token) on the brand's `--tp-ease-unfurl` curve — the brand handoff allows only its own two curves; with `prefers-reduced-motion` it swaps with no transition.
- Directly under it, always the same sentence, always tappable — **"Not completely happy with the preview? Click it to edit."** Clicking enters inline editing: handles that step the shape and size, swatches for colour roles, inline rename, drag (with a keyboard twin) to reorder questions or options, shape icons to swap pill / rounded / square / tile — and `tab` / `segmented` once S5 adds them to the form schema.
- Every gesture emits a patch. Inline editing is **not** a separate mode: it is the same reducer with `source: 'manual'`.
- Show a short "why" affordance on each preview (`What Loppa assumed`) listing the last few decisions in plain language with a link back to that question.

### 4.6 Manual-edit reconciliation (the caveat everyone forgets)

A field whose value differs from its guided baseline has been changed by hand — in the preview or in the classic editor; the comparison does not care where. If the guided flow would change it again, **ask**: *"You changed this by hand. Keep your version, or use the guided one?"* Options: Keep mine / Use guided / Show both. Never clobber. The manual value stays; the guided value waits as a proposal.

### 4.7 Copy rules for every question in the graph

Present tense, second person, one idea, no jargon (never "input type", never "field group" — say "How should people answer this?"). At most **9 words in English**, 12 in the other space-separated languages, 24 characters in Chinese and Japanese. Options labelled by *consequence*, not by technical name: "One answer only" / "Several answers allowed". Every node has a one-line `help`. The voice guide is `docs/plan/DESIGN-LANGUAGE.md`; the checkable rules — word limits and a banned-word list **per language** (`builder/graph/voice.json`; Norwegian *skjema* and Danish *skema* mean "form" and are not jargon) — are enforced by `pnpm builder:validate`.

---

## 5. FREE TEXT IS CLASSIFIED BY A LADDER OF FALLBACK ALGORITHMS

At **every** node, a text entry is present ("Or type it — e.g. 'four buttons in a row'"). Interpretation is a strict tier cascade; the first tier that clears its threshold wins; nothing below threshold is ever applied. Each result returns `{ nodeId, optionId, confidence, tier, evidenceSpan, alternatives[] }` — confidence an **integer per mille** — and the UI shows a small, clickable transparency chip: *"read that as 'several answers allowed' — change"*. Full specification: `docs/plan/INTENT-LADDER.md`.

| Tier | Method | Notes / thresholds |
|---|---|---|
| T0 | exact option id / keyword alias | alias tables are data, per language |
| T1 | normalization + token match | case fold, diacritic fold (å→a kept as secondary form, never destructive), punctuation strip, digit words; CJK split into character bigrams |
| T2 | weighted keyword scoring | inverse node-frequency weights from an integer logarithm, per alias; accept ≥ 720 ‰ |
| T3 | fuzzy string match | trigram Dice ≥ 0.62 *and* Jaro-Winkler ≥ 0.80 (exact rationals), or Levenshtein ≤ 2 for words ≥ 6 chars (typos, "buttoms") |
| T4 | gazetteer + regex patterns | quantity (digits or number words in the twelve languages); currency; date; e-mail; phone; org.nr; personnummer (Luhn) |
| T5 | structured parse | "three buttons, pill shape, side by side" → quantity=3, shape=pill, placement=row (all-or-nothing per slot, each slot its own undoable entry) |
| T6 | list extraction from an example | "Red, Green, Blue" or a pasted 1..n list → option set, labels verbatim, count preserved (a pasted list goes through the same paste → IR → detector path as a document) |
| T7 | subtree ranking | path prior + T2/T3 scores; top ≥ 600 ‰ and runner-up ≥ 150 ‰ behind → a `confirm-guess`; else the top 3 as cards |
| T8 | disambiguation, then learning | always safe: 3–6 sibling options as a visual menu. If the user picks one, offer **"Remember 'blabla' as a way to say this?"** → an alias, per organisation, exportable/importable as `aliases.json` (JSON, never YAML — §13). Never captured without consent; never overrides a built-in alias or an option id. |

Alias entries are plain JSON objects, and provenance is a field rather than a comment:

```json
{ "phrase": "blabla", "nodeId": "choice.answers", "optionId": "many",
  "locale": "sv", "source": "user-confirmed", "createdAt": "2026-09-25", "count": 1, "notes": "" }
```

Extra rules: numbers/quantities are never inferred from vagueness ("some" → ask). Negative forms are honoured ("no buttons", "utan knappar", "skip logos") through each node's declared `negative` option. After two consecutive T8 fallbacks, switch to **shopping-list mode**: every sibling as a categorised visual menu. Any tier result is reversible with one click and shows what tier produced it (T0–T3 = "understood", T4–T7 = "I think", T8 = "I asked"). Fuzzy work compares against one node's words and is capped by a comparison budget (20 000 comparisons), not wall time, so the cut-off is the same on every machine; T2's weights come from an integer logarithm, so nothing is generated at build time (`INTENT-LADDER.md`, "No generated index"). A negator reaches only as far as its clause or a contrast word ("not text but buttons"), may follow the word it negates when it ends the clause ("knappar behövs inte"), and one no rule can place blocks a reading instead of being ignored.

---

## 6. THE GUESS ENGINE (the actual Akinator bit)

Maintain a **belief vector** over template recipes. **The recipes are the existing `FORM_TEMPLATES`** (`packages/shared/src/forms/templates.ts`, 23 of them, every string in twelve languages) plus new ones where the brief's list has no match: order/invoice, check-in, donation, address change, exam answer sheet (membership and booking already exist as `member-details`, `booking-request` and `facility-booking`). **Consent form and incident report are exactly what `CLAUDE.md` rule 8 keeps out of the catalogue:** the engine may *recognise* them, but seeding gives structure and bracketed placeholders only, never wording. Recipe priors and score weights are JSON; the questions stay in the templates.

- Each answered node contributes log-odds via `score` weights declared on options, in **integer millinats**; update is pure: `update(belief, nodeId, optionId) → belief`.
- Show the top template when `p ≥ 0.80` — computed from a committed sigmoid table, never a runtime `Math.exp`: **"This looks like an event registration. Right?"** with three-state answers: **Right / Sort of / No** (weights 1.0 / 0.5 / 0.0).
- On "Right": seed a complete draft (sections, questions, design defaults), then continue the conversation only on the gaps. Show what was seeded and let every seeded field be edited inline.
- On "No": demote strongly, pick the next highest-**information** node (biggest expected belief entropy reduction), continue.
- On "Sort of": keep asking, but prefer high-information nodes and note which assumptions are shaky.
- Always expose `why this guess` listing the 3 strongest contributing answers. Never hide the reasoning.

---

## 7. THE IMPORT PIPELINE (paper → form)

Nine stages, each a pure module, each independently testable, each emitting a debug JSON artifact (canonical: sorted keys, integers only) that a test can snapshot. Full specification: `docs/plan/IMPORT-PIPELINE.md`. Stage 1 runs in the author's browser (pdf.js and Tesseract are already there, lazy-loaded; the server never parses a stranger's file — ADR 0004); stages 2–7 run in a Web Worker; the desktop runs the same bundle.

1. **Extract** — PDF: text layer with per-word boxes and font metrics; an AcroForm's fields are mapped by the existing `importAcroFields` first. DOCX: `document.xml` + `numbering.xml` (Word's own list semantics) + styles, read with the platform's `DecompressionStream` and a minimal XML tokenizer that refuses any DTD or entity — no new dependency. Image/scanned PDF: OCR with per-word confidence. Paste: one pasted line per line. Output: the **Layout IR** (`docs/plan/LAYOUT-IR.md`, frozen at `irVersion: 1`, integer and page-relative).
2. **Reassemble** — words → lines → blocks; **column-aware reading order** by recursive XY-cut; strip repeated headers/footers; de-hyphenate line-break splits (keeping the hyphen in "e-post"); expand ligatures; separate footnotes.
3. **Enumerate** — the marker detector, written as a decision procedure (`docs/plan/NUMBERING-RULES.md`). The highest-risk module in the project.
4. **Segment** — question / option / instruction / heading / meta / grid / table, by geometry and markers, not by guesswork.
5. **Classify type** — the scored feature model (§8.4) → `kind` + `validation` proposals with confidence and the three features that drove them.
6. **Map to template + brand** — the imported labels give the guess engine a starting point; for PDF and photo sources, the **paper twin** is born here by filling the existing `PaperAnchor`s, so `documents/paper.ts` writes a filled response back onto the original page.
7. **Score & bucket** — every decision gets a confidence in per mille; buckets: `auto` ≥ 850, `flag` 550–849, `review` < 550. A weighted sum of named contributions in `weights.json`, through the committed sigmoid table; low OCR confidence caps the bucket and never changes the text.
8. **Review screen** — never skipped. *"I read 14 questions. 3 need your eye."* The document on the left (highlighted spans) and the draft on the right. Each `flag`/`review` item has one-tap chips for the top 3 interpretations plus "merge with previous" / "split here" / "this is just text". Tapping a parsed item highlights its source span, and vice versa. Nothing enters the draft until "Use these questions".
9. **Diff on re-import** — hash the file and diff the extraction; match questions by fingerprint, then order and label similarity; apply only additions automatically; **always ask before removing, reordering or rewording**; never touch collected answers.

---

## 8. THE CAVEAT LEDGER

Every entry below is a row in `docs/plan/CAVEATS.md` — `id | symptom | rule | test` — and every §8.1/§8.2 entry has a fixture in `fixtures/numbering/` (`scripts/caveat-fixtures.test.ts` fails if one is missing). Nothing here is optional, and nothing here may be "simplified away". The ledger continues past #45 in `CAVEATS.md` with the traps later slices found.

### 8.1 Numbering traps (highest priority)

1. **`dotted-subnumber-mid-sentence`** — exact case: `1. A thing 12.1 mentions blabla` → one question. A marker is only a marker as the first word of a line; a soft-wrapped line is never a marker line. `12.1` mid-line is never a marker.
2. **`dotted-subnumber-line-start`** — `12.1` *does* start a line → nested sub-item, not a new top-level question. Nest under item 12 if it exists, otherwise accept and flag "check this".
3. **`decimal-not-marker`** — "we have 3.5 million kronor", "no. 12.1 i avtalet", "version 2.0", "§ 4.2" must stay in prose.
4. **`ordinal-not-marker`** — "the 1st of May", "den 3:e", "1. mai".
5. **`sequence-continuity`** — accept a run only if markers increase consistently (1,2,3 / 1,1.1,1.2,2 / i,ii,iii / a,b,c). A jump (2 → 12.1 at the same indent) demotes the whole run to `flag`.
6. **`scheme-change-same-indent`** — arabic → roman at the same indent = a nested list only if it *restarts* (1,2,3 then i,ii,iii); otherwise it is one list with inconsistent formatting → flag.
7. **`single-item-list`** — one marker alone: auto-accept only with indent-band evidence **and** a blank/checkbox/underline inside; otherwise candidate (off by default).
8. **`counter-reset-on-heading`** — a heading or a change of indent band resets counters; a second "1." is a new list, not a duplicate.
9. **`page-break-continuation`** — "…continued on page 2" and lists split across pages keep their numbering and do not restart.
10. **`letter-vs-word`** — "A. Name", "a) Namn" as markers vs "A. Andersson" as a name.
11. **`parenthesised-number`** — "(1)" vs "(the form)" vs "(3 500 kr)".
12. **`nordic-numbering`** — "1)", "1 -", "1:", "1 ." (space before period), NB/DA/SV conventions.

### 8.2 Geometry & text quality

13. `two-column-order` — newsletter layouts must be read column by column, not interleaved.
14. `repeated-header-footer` — page numbers, org name, footer lines must be stripped, not read as questions.
15. `hyphenated-line-break` — "regis-\ntering" → "registering"; "e-\npost" → "e-post".
16. `ligature-and-quote-repair` — "ﬁ" → "fi"; straight vs curly quotes never change a marker test, and are never changed in the output.
17. `table-rows` — a table with a header row is a matrix/grid or a set of labelled fields, not N questions with jumbled text.
18. `checkbox-grid` — a checkbox matrix aligning in columns with a header row → grid question with the right rows/columns; a single row of "☐ Ja ☐ Nej" → boolean.
19. `blank-line-leaders` — "Namn .............." and "Namn _________" are blanks, not prose.
20. `ocr-noise-budget` — per-word OCR confidence propagates: a question whose text is noisy is capped at a lower bucket. Never silently "fix" a proper noun.
21. `layout-shift-within-document` — a document that switches from one-column to two-column mid-page.

### 8.3 Semantic traps

22. `instruction-vs-question` — imperative prose with no blank, checkbox, or colon ("Please read the terms and conditions.") becomes a **note** by default, with a one-tap "make this a question".
23. `heading-vs-question` — "PARTICIPANT DETAILS" is a section, not a field.
24. `label-and-field-split` — "E-post:" on one line with the blank line below must pair into one question.
25. `same-question-repeated` — the same question text in two sections stays two questions; never de-duplicate silently, but offer a "these look the same" chip.
26. `required-inference` — "Obligatoriskt", "required", "*", "(mandatory)" → required; absence of a hint is **unknown**, not "optional" — flag it.
27. `locale-specific-fields` — Swedish personnummer (with Luhn), org.nr, plus international variants; never apply a Swedish validator to a document detected as another locale.
28. `consent-language` — "samtycke", "GDPR", "I agree to…" → consent question with its own visual treatment; the consent text itself is never summarised, shortened or reworded.
29. `number-in-question-text` — "How many guests? (max 8)" — do not create extra questions or options from the numbers; offer `max: 8` as a chip.
30. `option-count-sanity` — a detected single-choice with > 30 options is probably a mis-segmentation → flag with "this looks like a table or two questions".

### 8.4 Type-classification feature set (scored, in `weights.json`)

`hasBlankRun` · `hasCheckboxGlyph` + count + row/column layout · `select-all-that-apply` phrasing · `datePattern` + a date-ish label word · `timeSlotPattern` ("kl. 18:00", "18:00–19:00", table of slots) · `currencyHint` (kr, SEK, EUR, €, belopp, summa, moms) · email/phone/address/personnummer/orgNr gazetteers · `signatureHint` + long blank at page foot · `fileHint` (bifoga, attach, upload) · `consentHint` · `repeatableHint` ("per person", "varje deltagare", "antal" + sub-blocks) · `longPromptNoBlank` (> 120 chars) → instruction · `labelColonThenBlank` → labelled text · `booleanPair` (Ja/Nej, Yes/No) → toggle or radio · `gridAlignment` → grid. Output: `kind`, `validation` proposal, confidence, and the top-3 features that drove it (for the "why" chip).

### 8.5 Design caveats

31. `preview-must-be-real` — never a wireframe; a preview that ignores the brand kit is a bug.
32. `brand-before-build` — if no brand kit exists, offer the theme presets (not `default`, which is Loppa's own look) or a 60-second "your colours and logo" mini-flow; never render in Loppa's own colours inside a user's preview. The Demo AB kit is offered only inside the demo workspace.
33. `placement-slots-not-pixels` — logo/heading/footer go into named slots from the layout shelf (header-left, masthead-centred, corner watermark, footer strip, sidebar rail, card top). Users choose a slot, not an x/y.
34. `print-faithful-mode` — if the form came from paper, keep a print layout faithful to the original and preview both screen and paper.
35. `reduced-motion-and-contrast` — respect `prefers-reduced-motion` and `prefers-contrast`; every new control passes contrast checks in the brand palette (report failures rather than silently adjusting brand colour).
36. `rtl-and-long-strings` — the builder UI and its previews must survive a pseudo-RTL run and German-length labels without truncating a question.
37. `one-decision-per-screen` — no screen may ask two unrelated things; if a screen needs a scrollbar for its primary action at 360 × 640, it has failed review.

### 8.6 Technical / product caveats

38. `determinism` — same input bytes → byte-identical decision JSON (property test over the whole corpus; integers, no `Math.exp`/`log`/`pow` in a decision).
39. `stable-ids` — question IDs never change across edits, re-imports, or reordering, and are never reused; responses and PDF overlays depend on them.
40. `contract-and-parity` — an endpoint *between products* goes into `docs/CONTRACT.md`; the builder's own endpoints are Forms' own, documented by their Zod schemas and the API's OpenAPI, like every other `/v1/forms/*` route. `pnpm contract:check` must pass on all three backends every slice, and browser + desktop must behave identically (the desktop runs the same API on PGlite in its workspace folder, and its test-mode outbox).
41. `no-new-runtime-deps` — any new dependency needs an ADR justifying it; prefer the platform.
42. `perf-budget` — node transition render < 16ms; graph load < 50ms; interpretation < 10ms (a comparison budget); import of a 20-page PDF under 4s on a laptop; no spinner for anything under 150ms.
43. `privacy` — imports are parsed locally and nothing goes to any third party. The source file is kept only when the form keeps its paper twin, in the organisation's own private store (on the desktop, its own disk), and is deletable; extraction artifacts are never stored on the server.
44. `accessibility-of-the-conversation` — the whole guided flow is operable by keyboard alone: **1–9** pick options when the text box is not focused and **Alt+1–9** anywhere in the browser (browsers keep ⌘/Ctrl+1–9 for tabs), ⌘/Ctrl+1–9 as well in the desktop app; Enter accepts; Escape/⌘Z goes back. Announced properly to screen readers; no path requires a pointer.
45. `never-lose-work` — autosave, resume, and a crash-safe session; a refresh mid-conversation returns to the same question with the same trail.

---

## 9. ARCHITECTURE AND FILE LAYOUT (the real paths)

The inventory is done (`docs/plan/PREDICTIVE-BUILDER.md`, "What already exists"); these are the paths chosen, and the ones marked *built* exist:

```
packages/shared/src/                     (@tp/shared — the forms core already lives here)
  builder/            @tp/shared/builder
    graph/            schema.ts paths.ts guards.ts validate.ts nodes.ts voice.json   (built, S1)
    state.ts changes.ts patches.ts fields.ts ids.ts machine.ts session.ts          (built, S2)
    belief/           recipes.json update.ts entropy.ts explain.ts                    (S11)
  interpret/          @tp/shared/interpret — text.ts lexicon.ts ln.ts fuzzy.ts patterns.ts
                      aliases.ts vocabulary.ts ladder.ts, gazetteers/<language>.json,
                      aliases/<language>.json                                 (built, S3; S6)
  import/             @tp/shared/import
    ir/               the Layout IR types and validator                               (S1b)
    enumerate/        the detector — NUMBERING-RULES.md                               (S1b)
    layout/ segment/ classify/ overlay/  pipeline.ts                                  (S7, S9, S12)
  forms/wording.ts    the regulated-word list shared by templates and example chips   (built, S1)
apps/forms/src/screens/builder/
  paper/              extract.ts, ocr.ts (exist) + docx.ts paste.ts import.worker.ts   (S7)
  guided/             Shell, QuestionNode, Cards, Quantity, PreviewMoment, InlineEdit/,
                      Trail, WhyChip, use-keyboard                                     (S4, S5)
  review/             ReviewScreen, SourcePane, DraftPane, Chips                       (S10)
apps/api-forms/src/builder/   builder_sessions, builder_aliases, their routes          (S2, S6)
scripts/              builder-validate.ts (built), caveat-fixtures.test.ts (built)
fixtures/             numbering/ (29, built)  ir/ (3 samples, built)
                      documents/ (the corpus)  sessions/ (recorded conversations)  ladder/
```

Rules: `builder/`, `interpret/`, `import/` are **framework-free and side-effect-free** — enforced by an ESLint block; the UI imports them, never the reverse. Every stage of the pipeline is callable on its own with a plain object in and a plain object out. Bytes are touched only in `apps/forms/src/screens/builder/paper/`.

---

## 10. TESTING AND QUALITY BAR

- **Golden corpus.** `fixtures/documents/`: at least 60 real documents (PDF and DOCX, at least 10 Swedish, some scanned, some two-column, several with tables, checkbox grids and dotted sub-numbering, one with the exact §8.1.1 case, plus clean minimal cases), each with its expected stage outputs, **each one Loppa may redistribute** — its origin and licence in `fixtures/documents/SOURCES.json` (the repository may be public, ADR 0015). Snapshots freeze behaviour; a diff in a snapshot requires an explicit, reviewed update. Until the corpus exists, the 29 hand-authored fixtures in `fixtures/numbering/` are what the stages are held to; each names the slice that turns it green.
- **Determinism property test.** Run every fixture twice (and shuffled) and assert byte-identical output.
- **Replay test.** For 20 recorded guided sessions, replay the command log and assert the final draft equals the recorded one.
- **Invariant tests.** Every question retains non-empty text and a stable ID; every option set has ≥ 2 options; every question is reachable in the preview; a draft is publishable (`definitionProblems()` empty) at every point in the conversation, including after the first answer.
- **Ladder tests.** Per tier, per language: a table of phrase → expected node/option, plus a table of phrases that must **not** resolve and must trigger disambiguation (`fixtures/ladder/`).
- **e2e (Playwright, existing setup).** Implement S1–S6 as user journeys, with keyboard-only variants. At most one `pnpm test:e2e` at a time.
- **No regressions elsewhere.** `pnpm verify`, `pnpm contract:check`, `pnpm builder:validate`, and `pnpm test:e2e` from the first slice with a screen, all green before a slice is done; report the exact commands and results. A green `verify` is not a green `e2e`.

---

## 11. THE PLAN SET — landed in turn 1; keep it true

In `docs/plan/`: `PREDICTIVE-BUILDER.md` (start here), `BUILDER-GRAPH.md`, `INTENT-LADDER.md`, `LAYOUT-IR.md`, `NUMBERING-RULES.md`, `IMPORT-PIPELINE.md`, `CAVEATS.md`, `DESIGN-LANGUAGE.md`, `ROADMAP.md`, and this brief. In `docs/adr/`: 0017 guided builder, 0018 document import, 0019 deterministic intent ladder, 0020 graph as data, 0021 data formats JSON not YAML — all proposed — with notes on the ADRs they amend (0004's "OCR never creates a field", 0006's facets without `next`, 0013's AI provider). `CLAUDE.md` carries the "Guided Builder & Import" rules. Fixtures: `fixtures/numbering/` and `fixtures/ir/`.

A specification the code proves wrong is fixed in the same change as the code — the documents describe what is, and say plainly what is only planned.

---

## 12. WORK ORDER (one PR-sized slice per turn; stop and summarise after each)

> **Order note:** the detector runs as **S1b**, immediately after S1 — it is the highest-risk module, it is blocked only on the frozen IR, and its failure would change the roadmap (the cheap fallback is the paper-twin path: keep the original page as an image and place fields on it, which exists today). If the owner makes the click-through builder the headline (§14 Q7), S1b moves back to S8 and nothing else moves.

- **S1 — Graph as data. ✅ Done** (`48adfba`): schema, paths, guards, validator G0–G13, 15 nodes + menu + end, 77 `guided.*` keys in twelve catalogues, `pnpm builder:validate`, the purity lint block.
- **S1b — Enumerate (pulled forward). ✅ Done:** the IR types and validator; the marker grammar; the indent-band rule; sequence/scheme/counter-reset logic; the verdicts — exactly `NUMBERING-RULES.md`, which the implementation corrected in five places (its opening section lists them). Input: the turn-1 fixtures, synthetic IR only, no PDF parsing. **The enumerate fixtures (every §8.1 caveat, S4, S5 and its two harder forms — the 20 from turn 1, and `letter-vs-word--nested`, which S1b added for a gap it found) are green, including `dotted-subnumber-mid-sentence`, and the debug JSON per document is snapshot-tested** in `fixtures/numbering/debug/`. The §8.2 fixtures belong to stages 2, 4 and 7; each names the slice that turns it green (S7, S9).
- **S2 — Machine. ✅ Done:** pure reducer, patch ops and inverses, log, replay, breadcrumbs, stable ids, sidecar, session autosave (`builder_sessions`, `GET/PUT /v1/forms/:id/builder-session`). Tests: replay determinism, undo of every op, publishable from the first answer and for ever after (every answer from every reachable state), on Postgres and PGlite. Walking the whole graph found four places it could stop or say the wrong thing, fixed in the graph (`CAVEATS.md` #62–#65).
- **S3 — Ladder T0–T4. ✅ Done:** normalisation that points back at what was typed, word lists and 2 295 built-in aliases in twelve languages (every card's label among them), thresholds in integers, T0–T4 with negation and "no number from vagueness" on every rung, and a reason with every question it asks back. Tests: 880 phrase-table rows in twelve languages, must-not-resolve rows among them, determinism and the budget. Writing the tables found seven places where the ladder as first specified would misread, ask needlessly, or could not be built as written, each fixed in `INTENT-LADDER.md` (its closing section lists them) — among them, no generated index.
- **S4 — Builder shell.** The two doors, full-screen conversation UI, keyboard, trail, motion token, the buttons chain end to end.
- **S5 — Preview moment + inline editing.** Real preview, snapping handles, swatches, inline rename/reorder, "changed by hand" + revert, reconciliation; `ChoiceStyle` gains `tab` and `segmented`; `FormSettings.layout` holds the slots.
- **S6 — Ladder T5–T8.** Multi-slot parse, list extraction, group ranking, disambiguation, alias capture/export (`builder_aliases`).
- **S7 — Import extract + reassemble.** PDF text layer and rules, DOCX with real numbering definitions, paste, layout/columns/headers/de-hyphenation, stage debug JSON, worker wiring, IR emission. The 5 reassemble fixtures turn green.
- **S8 — Enumerate, wired to real extraction.** Connect S1b to the extract stage and run the corpus so far.
- **S9 — Segment + classify + confidence.** Question/option/prose/heading/grid/table, the feature model with `weights.json`, buckets, top-feature explanations. The segment and classify fixtures turn green. A grid field type gets its ADR here, or the one-select-per-row fallback stays.
- **S10 — Review screen.** Side-by-side source/draft, highlight linking, one-tap chips, merge/split, note conversion.
- **S11 — Belief engine.** Recipes, integer log-odds, entropy-driven question selection, three-state guesses, seeded drafts (structure only for rule-8 templates).
- **S12 — Convergence + paper twin + re-import diff.** Guided flow over an imported draft asking only about unresolved items; paper overlay; additive-only re-import with confirmation for everything else.
- **S13 — Polish pass.** i18n completeness, keyboard-only e2e, pseudo-RTL, perf budget, `ROADMAP.md` and ADR updates.

---

## 13. WORKING AGREEMENTS

- Read before writing. Cite the exact files you read at the start of each slice. Re-read after any `git switch`.
- Never redesign the repo's structure to fit this brief; fit the brief to the repo — and when it does not fit, fix the brief (§11).
- **Data formats: JSON or typed TS only. No YAML anywhere in application code, and never a YAML parser as a dependency** (ADR 0021; today `yaml` is only a transitive dependency of `@fastify/swagger` and Vite, and nothing imports it). Graph data: typed TS (`nodes.ts`). Aliases, recipe scores, weights, lexicons, gazetteers: JSON. Provenance goes in fields, not comments (`source`, `createdAt`, `count`, `notes`). Pretty-print, keep key order stable, schema-validate on load, and give every user-editable data file a "reset to defaults" recovery path.
- Ask, don't invent, when a decision is genuinely the owner's (§14). Batch the questions; then continue on the parts that are unblocked, on stated assumptions.
- No new runtime dependencies without an ADR. No `eval`, no dynamic JS in guards. No `any` in the core. No skipping the i18n catalogue.
- Behaviour changes to the import heuristics or the ladder require a fixture in the same commit — no exceptions.
- Keep every slice shippable and demoable; if a slice is too big, say so and split it rather than half-finishing two.
- **Gates, run individually** (`format:check`, `typecheck`, `lint`, `test`, `build`), plus `contract:check`, `builder:validate`, and `test:e2e` where a screen changed; paste the results. If a test fails for the environment rather than the code (for example, a container whose Chromium is not the build Playwright expects), prove it by re-running that test against what the container has — never report it as passing, and never as the slice's failure, without that.
- **Commits:** in a cloud session, commit each finished slice to the session's branch, push, and keep one draft pull request open for review; the draft is a place to review, not a request to merge. In a local session, commit only when the owner asks.
- After each slice: update `docs/plan/ROADMAP.md` (status and log), append new caveats to `docs/plan/CAVEATS.md`, fix any specification the code proved wrong, and write a 5-line summary (what changed, why, tests added, what's next, open questions).

---

## 14. OWNER QUESTIONS (asked once; work proceeds on the stated assumption until answered)

1. Which package owns `builder/`, `import/`, `interpret/`, and which app hosts the UI? *Proceeding on:* `@tp/shared` (subpath exports) and `apps/forms`.
2. Is the imported **paper twin** PDF a first-class option alongside the standard response PDF, or the default when the form came from paper? *Proceeding on:* both offered; the paper twin is the default when the source was kept.
3. Consent/GDPR text: may Loppa ever reformat it, or must it be preserved byte-for-byte and rendered as-is? *Proceeding on:* byte for byte.
4. Are learned aliases per install, or a shared team file? *Proceeding on:* per organisation, exportable/importable as `aliases.json` (on the desktop, that is the install).
5. ~~Is there an existing i18n workflow?~~ *Answered by the repo:* one TypeScript catalogue per locale (`apps/forms/src/lib/messages/`), no translation platform; a missing key is a compile error.
6. Which brand-kit constraints must win over the layout shelf? *Proceeding on:* the logo's aspect ratio, the contrast floor and the 44 px tap target.
7. **Priority:** which door is the headline — the document import or the click-through builder? *Proceeding on:* the document import, so the detector runs as S1b.

---

## 15. FIRST ACTIONS OF EVERY SESSION

1. Read `CLAUDE.md` (including "Guided Builder & Import" and "Never mistake a proxy for the thing"), then `docs/plan/ROADMAP.md` to find the next slice and the log of the last one.
2. Read the specification for that slice (`BUILDER-GRAPH.md`, `NUMBERING-RULES.md`, `LAYOUT-IR.md`, `INTENT-LADDER.md`, `IMPORT-PIPELINE.md`, `DESIGN-LANGUAGE.md`) and the code it builds on; cite what you read.
3. Show the plan for the slice before writing code (`CLAUDE.md`, "Working style"): files, schema changes, endpoints with their Zod schemas, tests — and anything in the slice that touches `packages/` or `docs/CONTRACT.md`, said explicitly.
4. Build it test-first where the ledger names the test; run the gates individually; commit per §13.
5. Stop and summarise (§13). One slice per turn.

---

## 16. THE THING TO KEEP IN MIND

Forms are not rocket science, and nothing here needs a model to think for it. What makes this feel magical is the opposite of magic: a graph that has an answer for everything, a ladder that never leaves the user stuck, a preview that is always real, an import that is honest about what it isn't sure of, and a user who is never asked to know anything about forms. Predictability, done thoroughly, is the feature.

---

## What changed from revision 2

Each change is one the first turns found the repository needed; `docs/plan/PREDICTIVE-BUILDER.md` ("Where the brief was fitted to the repository") has the reasoning.

1. **S1b's done-condition** is the enumerate fixtures (20 at the time); the §8.2 fixtures belong to stages 2, 4 and 7 and name the slice that turns them green.
2. **Caveat #40**: `docs/CONTRACT.md` is the contract *between* products; the builder's endpoints are Forms' own.
3. **Commits (§13)**: cloud sessions commit each slice to their branch with one draft PR open.
4. **Keyboard (#44)**: browsers keep ⌘/Ctrl+1–9 for tabs, so the browser uses 1–9 and Alt+1–9.
5. **No brand kit (#32)**: theme presets (not Loppa's own `default`) or the 60-second flow; Demo AB only in the demo workspace.
6. **Motion (§4.5)**: 220 ms on the brand's own `unfurl` curve, because the brand handoff allows only its two curves.
7. **The model (§4.1)**: the existing `FormDefinition` plus a sidecar, not a new `FormDraft`; kinds mapped onto existing field types, grid pending its ADR.
8. **Recipes (§6)**: the existing 23 templates are the recipes; consent form and incident report are structure-only (rule 8).
9. **The ADRs this brief amends** are named: 0004, 0006 and 0013, by the new 0017–0021.
10. **Fixtures**: 29 exist (21 caveats at minimum, plus S4, S5's harder forms and three added traps), not "fifteen or so".
11. **Reconciled with what exists**: the real paths (§9), the graph excerpt as shipped (§4.2), `guided.*` keys, integer arithmetic throughout, the ladder's per-mille thresholds, the one-table autosave, the tile shape as the existing `cards` appearance, S1 marked done, and §15 rewritten for every session rather than the first.
12. **The ladder (§5), after S3**: no `pnpm interpret:index` — an integer logarithm replaces the build step and one node's words need no candidate index; T2 scores per alias; a negator's reach is its clause or a contrast word, it may follow the word it negates, and one no rule can place blocks the reading. `INTENT-LADDER.md` ("What S3 changed in this document") has each, with the rows that lock it.

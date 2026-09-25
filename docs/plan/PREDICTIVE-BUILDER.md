# The predictive builder — plan

> Building a form in Loppa is a conversation, not a canvas. The user is walked through a short, warm sequence of questions — "Do you want buttons? Yes → multiple choice? → How many? → Which shape? → Here's how it looks. Not quite? Click it to change it." Every answer is a patch applied to a working draft, so nothing is ever a dead state: the form exists and is publishable from the first answer. At any point the user can leave the conversation by dropping a PDF, Word file, or phone scan into the window and Loppa reads it, decides what is a question and what is prose, shows what it read with its unsure parts clearly flagged, and hands over a draft. From there the conversation resumes — but only about what is still undecided. No AI is involved anywhere: forms are not rocket science, and every decision here can be predetermined, written down as a rule, and tested.

**Status:** plan, proposed 2026-09-25, from the owner's brief ("Loppa: Guided (Akinator-style) Form
Builder + Document-To-Form Import"), now kept in the repository as `BRIEF.md` (revision 3). Nothing here is built yet. The decisions it depends on are
ADRs 0017–0021; the open questions for the owner are at the end. Slices and milestones are in
`ROADMAP.md` beside this file.

**The plan set:**

| File | What it fixes |
| --- | --- |
| `BRIEF.md` | the owner's brief, revision 3, reconciled with everything below — the mission; these files are the specification |
| `PREDICTIVE-BUILDER.md` (this) | the product: two doors, the conversation, the preview contract, reconciliation, acceptance |
| `BUILDER-GRAPH.md` | the conversation as data: node schema, `when` / `patch` / `score`, validation |
| `INTENT-LADDER.md` | free text → an answer, T0–T8, and the alias file |
| `LAYOUT-IR.md` | the frozen input of every import stage after extraction |
| `NUMBERING-RULES.md` | the list-marker detector, as a decision procedure |
| `IMPORT-PIPELINE.md` | the nine import stages, thresholds, debug JSON, paper twin, re-import |
| `CAVEATS.md` | the ledger: every trap, its rule, its fixture |
| `DESIGN-LANGUAGE.md` | one decision per screen, motion, voice, placement slots, layout shelf |
| `ROADMAP.md` | M0–M6 mapped to slices S1–S13 |

## Non-negotiables

From the brief, and binding on every slice (`CLAUDE.md`, "Guided Builder & Import"):

1. **No AI, no LLM, no ML service, no network call at runtime** for any of this. Rules, weights,
   thresholds and algorithms a person can read and a test can freeze. Same input bytes, same
   output JSON, on every machine.
2. **The guided path is the primary path.** A person who knows nothing about forms produces a
   correct, published form by clicking. Free text is always available, never required.
3. **Never a dead end, never a silent guess.** Every screen has a next step, a back step and a way
   out; below threshold, Loppa asks.
4. **Never destroy user text or user edits.** Imported wording is verbatim; hand edits are
   overrides the guided flow never silently replaces.
5. **The core is pure and headless**: no DOM, no React, no I/O in the decision logic.
6. **The plan lands in the repository before the code at scale** — this set.

## What already exists, and what happens to it

The brief asks that nothing be duplicated. This product already has more of it than the brief
assumes:

| The brief's idea | Already in the repository | What happens to it |
| --- | --- | --- |
| An Akinator-style start | `packages/shared/src/wizard/tree.ts` (sector, then facets; ADR 0006) and `forms/wizard.ts` + `wizard-definition.ts` (the form questions; the server resolves `wizardAnswers` on `POST /v1/forms`) | The guided graph **replaces the form wizard's questions** as the "Start from questions" door (S4). `tree.ts` stays: the same `Wizard` component starts mailings and invoice runs. `wizardAnswers` stays accepted by the API so no client breaks. ADR 0020 records how the graph amends ADR 0006. |
| Template recipes | `forms/templates.ts`: **23 templates**, every string in twelve languages, parsed against `FormDefinition` by `templates.test.ts` | The belief engine (§6) guesses **these**. Recipes add only priors and score weights (JSON), never a second copy of the questions. Missing recipes (donation, address change, check-in, exam sheet, consent form, incident report) are new templates, and two of them are rule 8 (below). |
| `FormDraft` | `FormDefinition` (`forms/definition.ts`), versioned, `schemaVersion: 1`, the only thing the editor, renderer, PDF and CSV read | **No second document model.** The draft is a `FormDefinition` plus a builder sidecar (below). |
| Undo | `apps/forms/src/screens/builder/history.ts` — snapshot undo, 50 deep, coalesced | Stays for the classic editor. The conversation has its own **patch log** (replayable, forever), because snapshots cannot be replayed or explained. |
| Real preview | `builder/FormPreview.tsx` renders the **same `FieldInput`** as the public page | The preview moment **is** this, scoped to one question, on the brand kit. No wireframes can exist because none are written. |
| Control shapes | `ChoiceStyle` (`shape` theme/square/rounded/pill, `size` regular/large, `accent` brand role, `columns`), appearances dropdown/radio/buttons/cards | Inline editing writes **these**. `tile` = the `cards` appearance. `tab` and `segmented` are new presentation-only values (a `packages/shared` change, S5). |
| Paper → form | ADR 0004: AcroForm import (`import-acroform.ts`), manual box placement over a PDF or photo (`paper/`), OCR label suggestions (`ocr.ts`, in the browser), phone scan over the LAN (`PhoneScan.tsx`, `/v1/phone-scans`) | Stage 1 **reuses** `paper/extract.ts` (pdf.js, lazy, in the browser) and `paper/ocr.ts`; an AcroForm short-circuits to `importAcroFields`; the phone scan is the scan door. ADR 0018 records the one reversal: rules may now *propose* questions, behind a review screen that is never skipped. |
| Paper twin | `PaperAnchor` on fields and options, `definition.paper.sources`, `documents/paper.ts` writes answers back onto the original | Stage 6 **fills these anchors** from the layout IR. No new overlay format. |
| Autosave | the classic editor PUTs `forms.draft_definition` 800 ms after typing stops | The conversation autosaves its **session** (log + cursor) to a new table; the draft still saves the way it does today. |
| i18n | `apps/forms/src/lib/messages/<locale>.ts`, `Record<MessageKey, string>`, so a missing key is a **compile error**; lazy per locale | Graph strings are message keys there, under `guided.*` (`builder.*` is taken by the classic editor). |
| Desktop parity | ADR 0016: the desktop runs the same `api-forms` on PGlite in `workspace/database` | "Server: a table; desktop: the workspace folder" is **one table** — it lands in the workspace folder on the desktop by construction. |

## The two doors

The first screen after **New form** has two large cards and nothing else:

- **Start from paper.** Drop a PDF, a Word file or a photographed page, paste text, or scan with a
  phone (the existing LAN scan). Loppa reads it locally (`IMPORT-PIPELINE.md`) and opens the
  **review screen**, which is never skipped.
- **Start from questions.** The guided conversation. Nothing is required first: the brand kit can
  be answered later, and every skipped answer is recorded as "use Loppa's default" so the draft is
  always complete.

"Build it myself" — the classic editor — stays one press away on the questions screen, exactly as
`wizard.advanced` is today. It is not a third door; it is the way out that every screen has.

Both doors produce the same thing: **a draft**, which the same conversation can continue (S6),
the same editor can open, and the same publish button publishes.

## The draft

`FormDraft` in the brief is, in this repository:

```
draft          = FormDefinition                       (unchanged schema, the thing that publishes)
               + forms.title (LocalisedText)           (already a column, not in the definition)
               + BuilderSidecar                        (new, in the session, never published)

BuilderSidecar = {
  provenance:  'guided' | 'import' | 'mixed',
  fields:      { [fieldId]: FieldProvenance },
  retiredIds:  string[],                                (ids ever used in this form — never reused)
  pending:     { [key]: Json }                          (the conversation's working memory, §4.2)
}
FieldProvenance = {
  source: 'guided' | 'import' | 'manual',
  nodeId?, page?, rect? (PaperAnchor), rawText?, confidence?, originFingerprint?,
  guided?:  Json    (the value the guided flow last wrote — the reconciliation baseline)
  proposal?: Json   (a guided value the person has not accepted over their own)
}
```

Why a sidecar rather than fields on `Field`: provenance and overrides are **the builder's**
business. Put on the definition, they would be published into `form_versions`, exported, and
carried by every respondent's copy of the form — to answer a question only the author's screen
asks. The sidecar is keyed by field id, and field ids are stable (below), so it cannot drift.

**Kinds.** The brief's question kinds map onto `FIELD_TYPES`:

| Brief kind | `FieldType` | Notes |
| --- | --- | --- |
| text, paragraph, number, date, time, email, phone, file, signature | `short_text`, `long_text`, `number`, `date`, `time`, `email`, `phone`, `file`, `signature` | as is |
| select-one, select-many, toggle | `single_select`, `multi_select`, `yes_no` | appearance and `ChoiceStyle` carry the shape |
| repeatableGroup | `repeating_group` | ADR 0003 |
| note, section heading | `rich_text`, `section_break` | |
| money | `number` with `decimals: 2` | `CLAUDE.md` rule 5: stored as a decimal string, never a float. A currency unit on the field is a `packages/shared` change the brief implies; S9 proposes it |
| personnummer, orgNr | `short_text` + a named format (`se-personnummer`, `se-orgnr`, …) with checksum validation | new optional `format` property; a format, not a field type, so the CSV and renderer do not change. Never applied to a document detected as another locale (`CAVEATS.md` #27) |
| address | a block of `short_text` fields (street, postcode, city, country) | no composite type; the wizard's existing `keyOf` de-duplication applies |
| consent | `yes_no` with the new `consent` presentation (one checkbox, required) | **the text is the organisation's**, never Loppa's (ADR 0012) — below |
| grid | none yet | `SPEC-forms.md` §3 lists matrix/grid; it is a new field type and needs its own ADR (CSV shape first, as ADR 0003 did). Until then an imported grid becomes one `single_select` per row under a `section_break`, flagged |

Adding to `FIELD_TYPES` is a scope change (its own comment says so). This plan adds **none** until
the grid ADR; it adds two optional, presentation-or-validation properties (`format`, the consent
presentation) and two `ChoiceStyle` shapes. Each is a `packages/shared` change, said so in its
slice.

**Stable ids.** A question's id is created once and never changes: not on rename, not on reorder,
not on re-import. It is seeded from a content fingerprint — `fnv1a64(normalise(label) + '|' +
ordinal + '|' + sectionId)`, base32, prefixed `q-` — so the same import gives the same ids on
every machine, and it is checked against `retiredIds` so a deleted question's id is never handed
to a new one (a response or a paper overlay still points at the old one). Imported questions also
keep `originFingerprint` (the same hash, of the *source* text), which is what re-import matches on.
Existing forms keep the ids they have.

## The conversation

The conversation is a graph of nodes declared as data (`BUILDER-GRAPH.md`). A node asks one thing,
offers two to four large answers (or a stepper, a picker, a text entry), and each answer is a
**patch** — a declarative list of `set` / `add` / `remove` / `insert` / `reorder` operations on the
draft and the sidecar. Patches are the only way the conversation changes anything.

- **The log.** Every step appends `{ nodeId, optionId, patch, inverse, tier, source }`. Back is
  "apply the last inverse". Jumping to a breadcrumb is "replay the log up to there". Because the
  reducer is pure, **replaying the log reproduces the draft byte for byte** — a property test
  proves it (S2), not a comment.
- **Autosave.** The log and the cursor save to `builder_sessions` (one row per form and author;
  `GET/PUT /v1/forms/:id/builder-session`, optimistic concurrency on a version number). A refresh or
  a desktop restart returns to the same question with the same trail. The draft itself keeps
  saving through the existing `PUT /v1/forms/:id/draft`.
- **Publishable from the first answer.** The first answer produces a valid `FormDefinition` with
  at least one question; every later state is valid too. An invariant test walks the graph and
  checks `definitionProblems(definition)` (`forms/helpers.ts`, what publishing already refuses on) is empty at every node (S2).
- **Free text** is offered at every node ("Or type it — e.g. 'four buttons in a row'") and read by
  the deterministic ladder in `INTENT-LADDER.md`. A reading applies only above its threshold, and
  shows what it read in a chip that undoes it in one press.
- **The guess** (§6 of the brief): a belief over the templates, updated by each answer's declared
  scores; at p ≥ 0.80 Loppa asks "This looks like an event registration — right?" (Right / Sort of
  / No). "Right" seeds the template and the conversation continues **only on the gaps**. The
  reasoning is always one press away ("Why this guess": the three answers that moved it most).
  Arithmetic is integer log-odds (ADR 0019), so the guess is the same on every machine.

## The preview contract

A preview moment shows **the real control, in real context**: `FieldInput`, the organisation's
brand kit, the person's own labels. Never a grey box.

- It appears at the end of a feature's questions, after two or three answers inside one, and on
  demand from a "Show me" chip that is always there.
- It is live: an answer above changes it at once — animated when motion is allowed, swapped when
  `prefers-reduced-motion` (`DESIGN-LANGUAGE.md`).
- Under it, always the same sentence, always tappable: **"Not completely happy with the preview?
  Click it to edit."**
- Clicking it is **inline editing on the same reducer** — not a mode. Drag a handle to step the
  corner shape or the size, click a swatch for a brand colour role, click text to rename it in
  place, drag to reorder options or questions, click a shape icon to swap pill / rounded / square
  / tab / segmented / tile. Every gesture is a patch with `source: 'manual'`, in the same log, as
  undoable as any answer.
- Handles **snap to the values the schema allows**: a shape, a size step, a brand role. No pixel
  radius, no size under the 44 px tap target, no free colour — `ChoiceStyle` makes those
  impossible, and inline editing does not reopen them.
- "What Loppa assumed" lists the last few decisions in plain words, each a link back to the
  question that made it.

## Reconciliation: the rule everyone forgets

A field whose current value differs from the sidecar's `guided` baseline **has been changed by
hand** — by inline editing, or in the classic editor; the comparison does not care where. It
wears a small "changed by hand" badge with **Revert to guided**.

If the conversation would change such a field again, it does not. It asks: **"You changed this by
hand. Keep your version, or use the guided one?"** — Keep mine / Use guided / Show both. The
guided value waits in `proposal` until then. "Show both" renders the two side by side as real
previews. Nothing is ever clobbered, and re-entering the conversation after a session in the
classic editor asks the same question for every hand-changed field it reaches — not all at once.

## Wording Loppa does not write

`CLAUDE.md` rule 8 and ADR 0012 hold here with force, because a conversation that offers
"example chips" is exactly the place generated wording would creep in.

- **Consent, declarations, terms, safety and clinical text are the organisation's.** The consent
  node asks for the text (or offers the organisation's own authored texts, when those exist); its
  example chips are *labels* ("I agree to the terms"), never operative sentences; left empty it
  renders the existing amber "to be confirmed" placeholder and **blocks publishing**, as ADR 0012
  decides for every operative sentence.
- **Imported consent text is kept byte for byte** and never summarised or shortened
  (`CAVEATS.md` #28). §14 question 3 asks whether it may ever be reformatted.
- **Templates the guess engine may land on but cannot fill:** consent form and incident report are
  exactly the categories `templates.ts` refuses to ship. The engine may still *recognise* them —
  so the person is not asked twenty questions to discover it — but seeding gives structure and
  bracketed placeholders only, the way the proxy template already does.

## Where the code goes

Proposed, pending §14 question 1 (none of the types depend on the answer):

```
packages/shared/src/                         (@tp/shared — the forms core already lives here)
  import/        ir/  layout/  enumerate/  segment/  classify/  overlay/  pipeline.ts
                 classify/weights.json
  builder/       graph/nodes.ts  graph/schema.ts  graph/validate.ts
                 machine.ts  patches.ts  guards.ts  log.ts  sidecar.ts  ids.ts  api.ts
                 belief/recipes.json  belief/update.ts  belief/entropy.ts  belief/explain.ts
  interpret/     normalize.ts  tokenize.ts  fuzzy.ts  ladder.ts  explain.ts
                 gazetteers/  aliases/<language>.json  index.generated.json  sigmoid.json
apps/forms/src/screens/builder/
  paper/         extract.ts (exists)  ocr.ts (exists)  docx.ts  paste.ts  import.worker.ts
  guided/        Shell.tsx  QuestionNode.tsx  Cards.tsx  Quantity.tsx  PreviewMoment.tsx
                 InlineEdit/  Trail.tsx  WhyChip.tsx  use-keyboard.ts
  review/        ReviewScreen.tsx  SourcePane.tsx  DraftPane.tsx  Chips.tsx
apps/api-forms/src/
  builder/       sessions (builder_sessions), aliases (builder_aliases), routes
scripts/         builder-validate.ts (pnpm builder:validate)  caveat-fixtures.test.ts
fixtures/        numbering/  ir/  documents/ (the corpus)  sessions/ (recorded conversations)
```

- **`packages/shared`, not a new package,** because the brief says to extend the package that
  already holds form authoring, and this one does: `FormDefinition`, the wizard, both importers,
  the templates. Three new subpath exports (`@tp/shared/import`, `/builder`, `/interpret`) keep
  them out of every bundle that does not ask for them; a `bundle-split.test.ts` case keeps them
  out of the public form's chunk the way pdf.js already is.
- **Byte-touching stays in the app.** Reading a PDF needs pdf.js and a photo needs Tesseract, both
  already lazy-loaded in `apps/forms` only, both run in the author's browser (ADR 0004: the server
  never parses a stranger's file). The pure stages run in a Web Worker there; the desktop runs the
  same bundle, so it is the same worker.
- **The purity boundary** is enforced, not remembered: an ESLint `no-restricted-imports` block for
  `packages/shared/src/{import,builder,interpret}/**` forbids React, DOM globals, `node:*`, and
  `Date.now` / `Math.random` (S1).

## Acceptance scenarios

The definition of done; the team demos exactly these, and each is a Playwright journey with a
keyboard-only twin (S13).

**S1 — Click-through only.** From an empty workspace, clicking only (no typing except the form's
own labels), a user produces a published form with: a heading, a logo, a required name field, a
single-choice question with 4 options rendered as pills in the brand colour, an optional comments
paragraph field, and a consent checkbox. Every question they were asked made sense to a
non-technical person. *(The consent checkbox's text is typed by the person or chosen from their
organisation's own authored texts; see "Wording Loppa does not write".)*

**S2 — The buttons chain.** The user answers "Do you want buttons?" → yes → "One answer or
several?" → one → "How many options?" → 4 → "What shape?" → pill → "Where should they sit?" →
under the question, full width. A live preview of the actual control appears after the shape
answer and again at the end, on the real brand background, with the user's real labels.
Underneath: **"Not completely happy with the preview? Click it to edit."**

**S3 — Not happy path.** Clicking the preview opens direct manipulation: drag a handle to change
corner radius and spacing, click a swatch to change colour, click an option's text to rename it
inline, drag to reorder. Each gesture writes a patch. A small badge says *"changed by hand"* with a
**Revert to guided** action. Leaving and re-entering the guided flow asks before overwriting
anything changed by hand.

**S4 — Paste two numbered questions.** The user pastes or uploads `1. Question one` / `2. Question
two` and gets two questions, correctly numbered, correct text, correctly typed as
ambiguous-short-text (flagged "I guessed the answer type — tap to change"). *Locked at the detector
level by `fixtures/numbering/scenario-s4.json`.*

**S5 — The dotted-number trap.** `1. A thing 12.1 mentions blabla` / `2. Something else` produces
**two** questions. `12.1` does not start a new question, does not split the item, and survives in
the label verbatim. *Locked by `fixtures/numbering/dotted-subnumber-mid-sentence.json`, and in its
two harder forms (after a soft wrap, with and without a hanging indent) by `…--wrapped` and
`…--flush`.*

**S6 — Two doors converge.** S5's draft can be walked through the guided flow: Loppa asks only
about unresolved things (answer types, validation, option shapes), never re-asks what the import
already determined, and never reorders the user's questions. *Mechanism: every imported field's
sidecar records which decisions the import made and at what bucket; the graph's `when` guards
read `sidecar.fields[id].decided`, so a decided slot's node is skipped with an explanation
("Already read from your document").*

## Where the brief was fitted to the repository

Each item was a conflict between revision 2 of the brief and the repository. Revision 3
(`BRIEF.md`, "What changed from revision 2") adopts every resolution below, with the owner's
permission of 2026-09-25, so the brief and this plan now agree.

1. **ADR 0004 says OCR never creates a field** and flat PDFs get "not OCR, not inference". The
   brief's import creates questions from text by rule. → ADR 0018 supersedes that sentence, and
   keeps what it protected: a person confirms every question on a review screen that cannot be
   skipped, and wording is copied, never improved.
2. **ADR 0006 replaced `next` with facet sets** and made cycles impossible; the brief's graph has
   `next` and guarded cycles. → ADR 0020: the purpose-level choice keeps ADR 0006's facets (they
   become the belief engine's evidence), and `next` lives only *inside* a feature's short chain,
   where order is the point ("How many?" is meaningless before "buttons?"). ADR 0006's four-press
   promise is restated as a validator bound.
3. **ADR 0013 (proposed) plans an AI provider** for form-from-description and form-from-page. →
   ADR 0019 does both deterministically; ADR 0013 is narrowed to what is left (summaries), still
   the owner's decision, and nothing here depends on it.
4. **`FormDraft` as a new model** → the existing `FormDefinition` plus a sidecar (above).
5. **Kinds that are not field types** → the mapping above; one new type (grid) waits for its ADR.
6. **"Any new endpoint goes into `docs/CONTRACT.md`" (`CAVEATS.md` #40)** — `CONTRACT.md` is the
   *inter-product* contract (Forms ⇄ Mailer ⇄ Sign) and `contract:check` validates only that.
   The builder's endpoints are Forms' own, like `/v1/forms/:id/draft`: they are documented by their
   Zod schemas in `packages/shared` and the OpenAPI the API already serves. `contract:check` is
   still run every slice, and must still pass.
7. **Motion: 220 ms, `cubic-bezier(0.22, 1, 0.36, 1)`.** The repository's tokens are 110/180/320
   ms, and the brand handoff makes `--tp-ease-unfurl` and `--tp-ease-chomp` "the only curves the
   interface is allowed to use" (`packages/tokens/src/compile-web.ts`). → a new duration token
   `--tp-motion-preview: 220ms` (duration is not restricted), on `--tp-ease-unfurl` (curve is). The
   brief's revision 3 adopts this.
8. **⌘1–9 to pick an option.** Every desktop browser takes ⌘/Ctrl+1–9 for switching tabs, and a
   page cannot reliably have them. → in the browser, **1–9** when the text entry is not focused
   and **Alt+1–9** anywhere; in the desktop app, ⌘/Ctrl+1–9 as well.
9. **"Offer the Demo AB kit" when no brand exists.** Demo AB is the demo organisation's identity,
   including its name. → offer the theme presets (`minimal`, `garden`, `bold`, `midnight`) and
   the 60-second "your colours and logo" flow; the `default` preset is Loppa's own look, which
   `CAVEATS.md` #32 forbids inside a user's preview, so it is not offered there. The Demo AB kit is
   offered only inside the demo workspace.
10. **"Imports are processed locally; nothing is uploaded anywhere"** — parsing is local, but ADR
    0004 decided the source PDF **is kept** in the organisation's own private upload store,
    because the paper twin writes answers back onto it. → nothing goes to any third party; the
    file goes to the organisation's own Loppa (on the desktop, its own disk) only when a paper
    twin is kept, and it is deletable. The purge job that makes "deletable" automatic is already
    an open item on `LAUNCH-CHECKLIST.md`.
11. **"S1b is done when every §8.1/§8.2 fixture is green."** §8.1 is the detector's; most of §8.2
    (columns, running headers, hyphenation, tables, checkbox grids, OCR noise) belongs to stages 2,
    4 and 7, which S1b does not build. → every fixture names the slice that turns it green
    (`turnsGreenIn`); S1b turns the 20 enumerate fixtures green, S7 the reassemble ones, S9 the
    segment and classify ones.
12. **`fixtures/` at the repository root is not formatted by Prettier.** Prettier would put every
    word object of the layout IR on twenty lines; the fixtures are written one word per line so a
    diff of a fixture reads like a diff of the document. `scripts/caveat-fixtures.test.ts`
    validates their structure instead.
13. **"Don't commit, push, tag, or open a PR unless explicitly asked"** (revision 2, §13) against
    a cloud session's standing instruction to commit to its branch. → revision 3: a cloud session
    commits each finished slice to its branch and keeps one **draft** pull request open — a place
    to review, not a request to merge. A local session commits only when asked.

## Questions for the owner

`BRIEF.md` §14, each with the assumption work proceeds on until it is answered:

1. **Which package owns `builder/`, `import/`, `interpret/`, and which app hosts the UI?** *Proceeding
   on:* `@tp/shared` (subpath exports), and `apps/forms` (the desktop hosts the same bundle). S1
   built `@tp/shared/builder` on it.
2. **Is the paper twin a first-class response PDF beside the standard one, or the default when the
   form came from paper?** *Proceeding on:* both are offered, and the paper twin is the default for
   an imported form that kept its source (the README already promises "a form made from paper
   comes back as that paper").
3. **Consent/GDPR text: may Loppa ever reformat it, or is it preserved byte for byte?** *Proceeding
   on:* byte for byte, rendered as-is; only its container (the checkbox, the box it sits in)
   follows the brand.
4. **Are learned aliases per install, or a shared team file?** *Proceeding on:* per organisation
   (`builder_aliases`), exportable and importable as `aliases.json`; on the desktop that is the
   install.
5. ~~Is there an i18n workflow the graph strings must follow?~~ *Answered by the repository:* a
   TypeScript catalogue per locale (`apps/forms/src/lib/messages/`), no translation platform; a
   missing key is a compile error. The graph's strings are there, under `guided.*` (S1).
6. **Which brand-kit print/design constraints beat the layout shelf?** *Proceeding on:* the logo's
   aspect ratio, the contrast floor (`packages/tokens` contrast guard) and the 44 px tap target are
   hard; everything else in the shelf is a preference.
7. **Which door is the headline?** *Proceeding on:* the document import — so the detector runs as
   **S1b**, immediately after S1, because it is the highest-risk module, it is blocked only on the
   IR, and its failure would change the roadmap (the fallback is the paper-twin path: keep the page
   as an image and place fields on it, which exists today).

Three questions this plan raised are settled by revision 3 of the brief:

- **Motion** (item 7 above): 220 ms (`--tp-motion-preview`) on the brand's `unfurl` curve.
- **Grid questions**: the one-select-per-row fallback stands until S9, which either writes the
  grid field type's ADR (CSV shape first) or keeps the fallback.
- **Commits**: each slice on the session branch, one draft pull request (item 13 above).

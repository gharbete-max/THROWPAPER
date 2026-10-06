# S13 — Polish

**Status:** the plan for slice S13 (`ROADMAP.md`), written before its code (non-negotiable 6),
2026-10-05. Its row: twelve-language completeness, keyboard-only twins for acceptance S1–S6,
pseudo-RTL, the performance budget, and the roadmap and ADRs brought up to date.

Reading the acceptance scenarios against what is built turned up one thing the row does not name:
**acceptance S1 cannot be met.** The conversation has no way to name the form, to ask for a
paragraph rather than a line, or to make a box to tick. So S1 is built first, as S13a, and the
rest follows it.

| Part | Builds | Its tests |
| --- | --- | --- |
| S13a | Acceptance S1 by clicking alone: the form's name, a paragraph, a box to tick (graph version 7) | e2e S1 and its keyboard twin; the graph, ladder, session and validation tests below |
| S13b | Keyboard twins for S3 and S5; the German-length and mirrored runs (`CAVEATS.md` #36) | e2e |
| S13c | The rest of the performance budget (#42); twelve-language completeness | timing tests; e2e for the spinner; a catalogue test |
| S13d | `ROADMAP.md`, `PREDICTIVE-BUILDER.md` and ADRs 0017–0021 brought up to date; the owner asked to accept the ADRs | — |

## S13a — Acceptance S1, by clicking alone

> From an empty workspace, clicking only (no typing except the form's own labels), a user produces
> a published form with: a heading, a logo, a required name field, a single-choice question with 4
> options rendered as pills in the brand colour, an optional comments paragraph field, and a
> consent checkbox.

What each part is, and whether it can be made today:

| S1 asks for | Is | Today |
| --- | --- | --- |
| a heading | the form's title: the public page's `h1` (`PublicForm.tsx`: "the document's name is the heading") | **no** — the conversation never names the form; it stays "Untitled form" |
| a logo | the brand kit's logo, placed by "Where should your logo go?" | yes, given a kit with a logo (a file chosen on the Brand kit screen: a click) |
| a required name field | "Signing people up" adds it | yes |
| one answer, 4 options, pills, brand colour | the buttons chain; a choice's accent is the brand's own by default | yes |
| an optional comments paragraph | `long_text`, not required | **no** — "No, people type an answer" always makes `short_text` |
| a consent checkbox | `yes_no` with the consent presentation, its words the person's own (`BRIEF.md` §4; rule 8) | **no** — the schema has no such presentation, and the conversation cannot make a yes/no |

### The form's name: `flow.title`

A text entry, "What is your form called?", between the guess and the brand: every edge that went
to `brand.start` from the guess (`guess.confirm`'s last branch, `guess.seeded`) goes to
`flow.title`, which goes on to `brand.start`. So the masthead the brand questions preview carries
the form's real name. It writes `draft.title` in the author's language (a `localised` path
already); its three example chips are names, held to rule G13 like the question chips. It has no
`when`: the guided path reaches it once, and starting again from "What is this form for?" is
starting again. A form read from a document is not asked (its walk goes to the brand as before,
acceptance S6 unchanged). It is not a menu entry: the editor names a form, as it always has.

### A paragraph, and a box to tick: `text.kind`

"Do you want buttons?" → **"No buttons"** (was "No, people type an answer": a box to tick is not
typed, so the card says only what it decides) → **"How should people answer?"**:

| Card | Makes | Detail line |
| --- | --- | --- |
| A line of text | `short_text` (what "no" made before) | For a name, a number or a few words. |
| A few sentences | `long_text` | For comments or a longer description. |
| A box to tick | `yes_no`, appearance `checkbox` | One box beside your words, ticked or not. |

Each card also sets `pending.buttons` to false, so a later jump into the choice chain is never
asked to shape options the question no longer has. The node is in group `text` — what is typed,
or ticked, as an answer — so it is never answered ahead of its turn (a sentence at "Do you want
buttons?" reads only the choice group, exactly as before: no row of the phrase tables moves). Its
`when` is `has(focus) && !decided(kind)`; it goes where the preview goes (the next question of a
walk, the brand at a walk's end, else "Add another question?"). Its three cards are aliased in all
twelve languages (rule `uncovered`), and each language's phrase table gains rows for them.

### The box to tick: a `yes_no` appearance

`YES_NO_APPEARANCES` gains `checkbox` (a `packages/shared` change): one box, its label beside it;
ticked is `true`, not ticked is `false`. **Required means it must be ticked** — the meaning HTML
gives a required checkbox, and the only one a box can have, since a box that is not ticked has
still been answered. `validateSubmission` refuses `false` for a required box (`validation.tick`,
"Tick the box to go on", in twelve languages); a dropdown, radio or buttons yes/no is unchanged.
The public form draws it as a checkbox; the editor offers it as "Box to tick"; the PDF of a
submission still says yes or no. The words beside the box are the person's own, typed as the
question's label (rule 8, ADR 0012: Loppa never supplies consent wording).

The import maps a question read as consent (`CAVEATS.md` #28) to this presentation, as the brief's
table always said it would ("consent is `yes_no` with a consent presentation"): `review/fields.ts`
gives it `appearance: 'checkbox'`, its text byte for byte as before.

### Graph version 7, and the sessions recorded before it

Version 7 is `flow.title`, `text.kind` and "No buttons". A session recorded against version 6
still replays: the log holds resolved changes, not the edges that caused them. The recorded
session moves to version 7, and the version-6 recording is kept beside it
(`fixtures/sessions/buttons-chain-v6.json`) and replayed too, so "a conversation recorded by one
build replays in every later one" is held for a real earlier build, not only the current one.

### The journeys

`e2e/acceptance-s1.spec.ts`: an administrator chooses a logo on the Brand kit screen, then from
New form → Start from questions answers by clicking alone, typing only the labels: Signing people
up; the guess past; the form's name; the organisation's look and the logo's place; "Which day
suits you?", needed, buttons, one answer, 4, pill, under the question; another question:
"Comments", optional, no buttons, a few sentences; another: the consent sentence, needed, no
buttons, a box to tick; that's everything; open it in the editor; publish, with its confirmation.
Then the public form: the name as its `h1`, the logo, the name field required, four pills in the
brand's colour, a paragraph box, and a box to tick — sending with the box unticked is refused, and
ticked it goes. Its twin does the same by keyboard alone: digits, Enter, Escape, Tab, and typing
only the labels. The kit is put back afterwards.

## S13b — Keyboard twins, and the long and mirrored runs

The acceptance journeys and their twins as they stand:

| | Pointer | Keyboard alone |
| --- | --- | --- |
| S1 | `acceptance-s1.spec.ts` (S13a) | `acceptance-s1.spec.ts` (S13a) |
| S2 | `guided-builder.spec.ts` (the buttons chain) | `guided-builder.spec.ts` (on a small phone) |
| S3 | `guided-builder.spec.ts` (not happy with the preview) | `guided-builder.spec.ts` (S13b) |
| S4 | `review.spec.ts` | `review.spec.ts` |
| S5 | `review.spec.ts` | `review.spec.ts` (S13b) |
| S6 | `review.spec.ts` | `review.spec.ts` |

A twin moves focus only with Tab (a helper presses it until the control it wants has focus, and
fails past a bound), and acts only with keys. S3's twin edits the preview with the inline panel's
buttons (shape, size, accent), renames an answer in its box, moves it with Move down, takes
"Revert to guided" and Back, and meets the reconciliation question — the drag's twin is Move up
and Move down (#44). S5's twin pastes by keyboard (the clipboard's Ctrl+V into the box), and
settles the review with its keys.

**#36, long and mirrored.** Two runs of the whole guided chain at phone width (360 px): one in
German (`de-DE`, the longest of the twelve catalogues), one mirrored (`dir="rtl"` on the document,
English words). Each, at every question, checks that nothing is wider than the screen, that every
answer card is on the first screen, and that **no text is cut**: no element that clips its
overflow holds text wider or taller than its box. The mirrored run checks too that the answer
cards' text starts at the right.

## S13c — The budget, and twelve languages

**#42.** Twenty pages under 4 s and the ladder's comparison budget are held already. The rest:

- **Graph load < 50 ms**: checking the graph (G0–G14) and building one language's vocabulary for
  the ladder, from a fresh copy (no cache), the median of five runs. `packages/shared`.
- **Node render < 16 ms**: in the built app, from an answer's press to the next question on
  screen — the machine's step and React's render together — the median over the buttons chain,
  measured in the page with `performance.now()`. e2e.
- **No spinner under 150 ms**: the waiting picture (`Loading`) is shown only after 150 ms — a CSS
  delay, no timer — so a quick load never flashes it. e2e: a session answered after 50 ms never
  shows it; one answered after 600 ms does.

**Twelve-language completeness.** A key missing from a catalogue is already a compile error. What
nothing caught is a string left in English: `messages.test.ts` gains a check that a translation
equals the English only where the test lists that key for that language — a product name, a
placeholder, a loanword the language uses ("Status", "Logo", "Minimal"). Reading the list once
found one wrong: Danish "Brand" (the brand kit's title) means *fire*; it becomes "Udseende", as
Swedish says "Utseende".

## S13d — The roadmap and the ADRs

`ROADMAP.md` (the S13 row, M6's demo, the log), `PREDICTIVE-BUILDER.md` (S1 as built; the
acceptance table's twins), `BUILDER-GRAPH.md` (version 7), and each of ADRs 0017–0021 read against
what was built, with a "Since this was written" note where the build went further or differently.
They stay *proposed*: accepting them is the owner's, and the PR asks.

## As built

**S13a** (`8f64b08`) as planned, and it found three things: a required box left unticked passed
(`CAVEATS.md` #128); the form's name would not have been saved (#129); and every uploaded image was
broken in development and in e2e, since the preview server never proxied `/public/assets/`.

**S13b.** The twins for S3 and S5 are built. S3's opens inline editing with E and does every
gesture by key: the shape, size and colour buttons, an answer renamed in its box, Move down twice
for the drag, "Revert to guided", Back, and "Keep mine" at the reconciliation. S5's starts from
"New form" by Tab and Enter, types the paste and moves through the review with the arrows; S4's
twin now starts the same way. The long and mirrored runs (#36) found two real faults. German's "Wie
viele Auswahlmöglichkeiten?" pushed its own question mark off a phone (#130). On a mirrored page,
the next question slid in from the side the reader had passed (#131). A third test freezes the
arrival at its first frame and checks its side in both directions. Every check that would catch
these was shown to fail with its fix taken out.

**S13c.** The budget, as measured here with the e2e servers running:
- An answer's next question is on the page in a median of 8 ms over the buttons chain.
- The slowest press is the first, about 33 ms: the guess chooses its first question while the
  page's code is still cold.
- The graph loads in 12–30 ms.
- The waiting picture's delay is a token, `--tp-wait-unshown` (`packages/tokens`).

Each check was shown to fail when broken:
- the render budget, set to half a millisecond;
- the waiting picture, without its delay (it was then seen 18 ms after it was put up).

The catalogue check found three strings left in English: Danish "Brand" (fire) and "Download PDF",
and Spanish "Minimal" (#132).

**S13d.** `ROADMAP.md`, `PREDICTIVE-BUILDER.md` and `BUILDER-GRAPH.md` are brought up to date, and
each of ADRs 0017–0021 has an "As built" section. That section says where the build went further
or differently:
- the fourth schema addition;
- the corpus's documents, eleven of sixty then and fourteen now;
- photographs not yet through the stages;
- the session bound that replaced a transition budget.

Three sentences that had been wrong since M0 are corrected in place: the `Wizard` component never
started mailings or invoice runs (ADRs 0006, 0017 and 0020). The ADRs stay *proposed*, and PR #147
asks the owner to accept them.

**Since (2026-10-06):** the owner delegated every remaining decision ("Make all the decisions, pick
the path that seems most logical"), and ADRs 0017–0021 were accepted under it, with ADR 0004 noted
as superseded in part and ADR 0006 as amended.

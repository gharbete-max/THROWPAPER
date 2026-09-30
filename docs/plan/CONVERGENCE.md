# Convergence, the paper twin, and re-import (S12)

The two doors meet: a form read from a document can be walked by the conversation, asking only what
the document left open (acceptance scenario S6, `PREDICTIVE-BUILDER.md`); a PDF it was read from
comes back filled in, as that paper; and reading the same form again adds what is new and asks
before it removes anything (`IMPORT-PIPELINE.md`, stage 9). Three commits, in this order: S12a,
S12b, S12c. This is the plan each is built to; where the build changes it, the section says so.

## S12a — the conversation over an imported form

### What the import decided

"Use these questions" records, for every question it adds, the decisions the document made, in the
question's sidecar (`FieldProvenance.decided`, the record `decided(slot)` already reads, S6):

| Slot | Decided by the import when |
| --- | --- |
| `kind` | always: the review screen does not let a question through until its type is settled — by a chip, Accept, or stage 7 at `auto` |
| `required` | the document said so either way: "(required)", an asterisk the legend explains, "if applicable" (#26). Said nothing: open |
| `options` | a choice whose options were printed (a grid's columns are its rows' options). A choice given placeholder options: open |
| `shape`, `placement` | never: paper has no button shapes |
| `validation` | never yet: the form schema has no format check to decide (below, "Not in S12") |

The review item keeps whether the document spoke about required (`requiredKnown`), apart from what
it said: "not required" and "said nothing" both leave a question optional, but only one is decided.

### The walk

Graph version 6 adds group `import`:

- **`import.walk`** — "Go through the questions from your document?" (Loppa asks only what your
  document did not say.) *Yes, one at a time*: focus on the first question to walk, and walk it.
  *No, they are right as they are*: on to the brand, or "Add another question?".
- **`import.next`** — "Go on to the next one?" after each walked question, while there is one.
  *Yes, the next question* / *No, stop here*. Stopping is always one press.

Which question is next is the machine's, like the guess: after every step it writes
`pending.toWalk`, the first question **after the one in focus**, in the form's own order, that came
from a document and has a slot still open that the walk asks (`required`; for a choice, `options`,
`shape` and `placement`). Headings, text and repeating groups are not walked. In the form's order,
after the focus: so the walk never reorders anything, never visits a question twice, and a question
added by hand after the imported ones ends it. A patch reads it as `{ $toWalk: true }`.

A walked question goes through the chain every question goes through — `text.required`,
`choice.buttons` … `choice.preview` — and each node already passes by a decided slot, saying
"Already decided" (S6). Three guards change so the chain also serves a question that is a choice
before the conversation met it:

- `choice.count`, `choice.shape`, `choice.placement` ask when "yes, buttons" was answered **or the
  question in focus has options**; a question with none passes by with "This question has no
  answers to choose from", and "You chose no buttons" is said only when that was said
  (`CAVEATS.md` #122). `choice.answers` passes an imported question by with "Already decided".
- The shape a question takes shows it as buttons (or cards, for tiles): a shape on a dropdown would
  change nothing anyone could see (#123).
- `choice.preview` goes on to `import.next` while a walk is going and a question is left; at the
  walk's end, to the brand if it is not decided, else "Add another question?". After the brand, a
  form with questions already (seeded or imported) goes to "Add another question?", not "What do
  you want to ask?".

"Use these questions" takes the conversation to `import.walk` (its step's `to`), passing by it to
the brand, or "Add another question?", when nothing is left to walk. The top menu offers the walk
too. **The review screen then opens the conversation, not the editor** (added while building: the
editor had no way into the conversation, so the walk could only have been reached by typing its
address). "Build it myself" is one press from every question of it.

### Tests

- `builder/walk.test.ts`: the S5 draft (two short questions, required said nowhere) walked — asked
  "Must everyone answer this?" twice, never a type or options, never reordered, then the brand and
  "Add another question?"; what the import records; a choice with printed options asked its shape
  and where, not its options, and shown as buttons; one without, asked how many; headings passed;
  nothing to walk; a question added by hand ends it; "No, stop here"; "No, they are right"; a
  rebase mid-walk goes on from the focus; Back and replay exact at every step.
- `machine.test.ts`: the walk over every answer from every reachable state now also starts from an
  imported form, and reaches `import.walk` and `import.next`.
- `review.test.ts`: `requiredKnown` from what the document said, through a merge and "just text";
  what each question decides; through the machine to the walk.
- `e2e/review.spec.ts`: acceptance S6 by pointer, and by keyboard alone.

## S12b — the paper twin from an import

A PDF read by the review comes back filled in, as that paper (`PREDICTIVE-BUILDER.md`, owner
question 2: the paper twin is the default for an imported form that kept its source). Everything
that writes answers onto a page exists already (ADR 0004, `apps/api-forms/src/documents/paper.ts`):
it needs the file kept with the form, `definition.paper.sources`, and a box on the page for each
question and each option. A Word file or a paste has no page, and gets neither.

### The boxes (`@tp/shared/import`, `anchors.ts`)

Pure, from the reading's layout (`IMPORT-PIPELINE.md`, stage 6), in layout units (1/10 000 of the
page), a box a question's answer is written into:

1. **A PDF's own form field**: its widget, exactly (the review item of a field is `field:<name>`,
   and the screen passes each widget by name; `review/fields.ts`, `placementOf`).
2. **Its blank runs** ("______", "……", ".........."), **after its own label**: the blank part of
   the label's last word if the blank is glued to it ("Adress:______", its width shared out by
   character as `CAVEATS.md` #58 shares a run's), then the blank words that follow on its line; or
   a line of nothing but blanks under it. After its label, not every blank on its lines: two
   questions on one line each have their own (#124).
3. **Its checkboxes** (`☐ ☑ ☒ □ ■ ▢ ○ ● ◯ ◻ ◼`, the glyphs `isCheckboxWord` reads): their union
   after the label — a choice's answer is the box ticked.
4. **Otherwise**: from the right edge of the label's last word to its column's right edge, on
   the label's line, a line high; with no room there, a line's height under it. (A drawn rule under
   the label is not in the Layout IR, which keeps only that there is one; the fallback is where the
   rule is.)

Each option's box is its own checkbox: the checkbox glyph nearest before the option's first word
on the line that holds it, else nearest after it; the options are found in order, each after the
one before. A grid's row is a question whose options are the columns: the row is found by its
words before its first checkbox, and each column's checkbox on that line, left to right, is its
option's. A table (a repeating group) has no box that could hold its rows, and gets none, as
`paper.ts` already says. A heading or a text gets none.

A box becomes a `PaperAnchor` (`paperAnchor`): `page` counts across every source the form keeps
(so a second document's pages follow the first's), `x`, `y`, `w`, `h` are the box ÷ 10 000.

### Keeping the file

"Use these questions", for a PDF, first keeps the file with the form (`POST /v1/forms/:id/paper`,
the editor's own route), then adds the questions, their boxes and the new source in the same one
step (`importQuestions`' `source`: Back takes all three away). If the file cannot be kept, nothing
is added and the screen says so; trying again is one press, and keeps the same key (the store is
content-addressed). A file kept whose questions then cannot be saved stays in the store with
nothing naming it, as one the editor's paper import keeps and the author then discards does: the
route stores bytes and no row, and the upload sweep reaches only rows (`uploads/lifecycle.ts`). A document over `MAX_PAPER_PAGES` pages is
refused as it is read, as the editor's paper import refuses it.

A form keeps at most `MAX_PAPER_PAGES` documents (`Paper.sources`). Built as planned, the next
one's questions would have been refused whole, every time — a press that could never work. A form
already keeping that many adds a PDF's questions without their places on it, and the review says
so before the press (`roomForPaper`, `review.paperFull`); nothing is uploaded.

### Tests

- `anchors.test.ts`: pages read from pasted text and from a numbering fixture — a blank run on its
  own line, a dotted leader in full stops and in ellipses, two blanks on one line (each question its
  own), a blank glued to its label, the blank line under a label, checkboxes as a question's answer
  and as each option's (before it and after it), a grid's rows and columns, the fallback to the
  column's edge, nothing for a line the layout lacks; and every box of every question, option and
  grid row in every layout fixture within its page (over a hundred boxes); a blank run inside a
  word (`blankRuns`) found exactly where the line hints find one, over every word of those
  fixtures.
- `review.test.ts`: `importOf` with a paper gives each question and option its anchor, offset by
  the pages the form already keeps; a PDF form field's widget exactly, over what is printed; a
  grid's rows; nothing for a Word file or a paste; `roomForPaper` at the schema's own limit.
- `imported.test.ts`: the paper source added in the import step, undone by Back and replayed;
  appended to the sources the form keeps; left alone by an import without one; a key the form
  could not keep refused whole.
- `e2e/paper-twin.spec.ts`: a PDF with printed blanks read, its questions added and published; the
  organisation's copy of a response is the paper, each answer inside the box its question was given
  and on the line of its own printed label (a shifted box fails it: checked by mutation). A file
  that cannot be kept adds nothing, says so, and the same press works once it can. A form already
  keeping twenty documents adds the questions, says so first, and uploads nothing.
- The paper journeys share one reader (`e2e/pdf-read.ts`, moved from `paper-roundtrip.spec.ts`) and
  a PDF of printed lines (`linesPdf`, `e2e/pdf.ts`).

## S12c — importing the same form again

Stage 9 as `IMPORT-PIPELINE.md` specifies it: the same bytes, nothing to do; otherwise new questions
matched to the draft's by their origin fingerprint, then by label similarity near their place;
additions applied, each a step; removals, reorders and reworded labels listed and asked about, one
decision each; collected answers never touched. Planned in detail when S12b lands.

## Not in S12

- **A format check** (personnummer, organisation number): stage 5 proposes one (#27), but the
  form schema has no check to put it in. Adding one reaches the public form, the API's validation
  and every export — a decision of its own, not a side effect of an import.
- **Stage 6's template match** ("This looks like a membership form — right?" after an import):
  the belief engine (S11) reads the conversation's answers, and an import answers none of its
  questions. Reading imported labels into the belief is for after S12.

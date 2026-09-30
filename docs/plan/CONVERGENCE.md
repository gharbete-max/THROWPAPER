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

For a PDF (not a Word file or a paste, which have no page): "Use these questions" keeps the file
with the form (`POST /v1/forms/:id/paper`, as the editor's paper import does), sets
`definition.paper.sources`, and gives each question the box it will be written into
(`IMPORT-PIPELINE.md`, stage 6): the union of its blank run, checkboxes or rule; failing those, from
the label's right edge to its column's right edge on the label's line. Each option's anchor is its
checkbox. A PDF's own form field's anchor is its widget. Anchors are fractions of the page, from the
reading's layout units. Then a filled response comes back as that paper, which `documents/paper.ts`
already writes (ADR 0004). Planned in detail when S12a lands.

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

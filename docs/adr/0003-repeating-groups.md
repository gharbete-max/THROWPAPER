# ADR 0003 — Repeating groups, and what a CSV can still be afterwards

**Status:** accepted
**Date:** 2026-09-15

## Context

A form cannot ask the same question a variable number of times. "Add a guest", "add a reading",
"one row per item inspected" all have the same shape, and none of them can be built: `FIELD_TYPES`
is a flat list, a submission is a flat `Record<string, unknown>`, and the export is one column per
field.

It is the gap that matters most for what this product is actually for. START-HERE describes forms,
**inspections**, **measurements** and registrations; three of those four are lists by nature. An
inspection with a fixed twelve rows is a worksheet, not an inspection.

SurveyJS calls it `paneldynamic` (`docs/adr` note: see the importer added in the previous phase,
which reports it as having no equivalent here). Their taxonomy is a useful checklist and their
name is a reasonable one; the design below is ours, because the constraint that shapes it — the
CSV — is ours.

## The decision that determines everything else: how it exports

START-HERE's Done-means list says **"The CSV opens in Excel with Swedish characters intact."** Not
"is machine-readable" — opens, in Excel, and is usable by the person who asked for it. That rules
out the obvious answers.

Three options, and why two of them lose:

**A JSON blob in one cell** is lossless and useless. A column containing
`[{"name":"Alva"},{"name":"Björn"}]` is not something a treasurer can sort, count or sum, and the
export exists so that they can.

**One row per entry** — denormalising, so a submission with three guests becomes three rows — is
worse than it looks. It breaks the one invariant the whole product is built on: **one submission is
one row, one reference, one admission card, one check-in.** `submissions_org_reference_idx` is
unique. The door scans a reference and marks that submission present. A CSV where a reference
appears three times is a CSV that disagrees with the database about what a submission is.

**So: numbered columns.** `guests_1_name`, `guests_1_meal`, `guests_2_name`, and so on.

The objection to numbered columns is that the column set then depends on the *data* — you cannot
know how many columns you need until you have read every submission. That objection is fatal, and
it is what the next decision removes.

### `max` is required, so the columns stay a function of the form

A repeating group **must** declare a maximum number of entries. Not "may"; must.

That single constraint turns the column set back into a pure function of the definition, which is
what every other part of this codebase already assumes: `exportColumns(definition)` takes a
definition and nothing else, the grid draws its headers before any row arrives, and the report
renderer lays out a page from the form rather than from the answers.

It is also the honest thing to make an author decide. "How many guests may somebody bring" is a
question with a real answer — a room has a capacity — and a form that shrugs at it produces an
export nobody can open. A cap of **20** is enforced by the schema, because a group that could
repeat a hundred times is a spreadsheet wearing a form, and the product for that is a spreadsheet.

Columns for entries that nobody filled in are empty, exactly like an unanswered optional question.

## The rest of the decisions

### One level, and no page breaks inside

A repeating group contains ordinary fields. It may not contain another repeating group, and it may
not contain a `page_break`.

Nesting is refused because the export above cannot survive it — `guests_2_children_3_name` is a
column heading nobody reads — and because the recursion would infect the schema, the renderer and
the validator for a feature nobody has asked for. `page_break` is refused because a page is a
property of the form, and "page three of entry two" is not a place.

`section_break`, `rich_text` and the other presentational types **are** allowed inside: a heading
above each entry is exactly what a repeated block usually needs.

### The data shape is an array of objects

```
{ "guests": [ { "name": "Alva", "meal": "veg" }, { "name": "Björn", "meal": "standard" } ] }
```

Keyed by the child's own key, not by a flattened one. The flattening happens in the export, where
it is a presentation concern, and nowhere else — so the answer a respondent gave and the answer
the API returns have the same shape they would have if the CSV did not exist.

Child keys must be unique **within their group**, not globally: `guests[].name` and a top-level
`name` are different questions and both are reasonable. The export key is built by combining them,
which is where a collision would actually matter.

### `showWhen` inside a group sees only its own entry

A child field's visibility rule may reference earlier children **of the same entry**, and nothing
outside it.

The alternative is incoherent rather than merely hard: "show the dietary question when the name is
answered" has an obvious meaning per entry and no meaning at all across entries. Referencing a
top-level field from inside a group is refused for the same reason it is refused between pages —
`Condition` already requires the referenced field to appear *earlier*, which is what makes cycles
impossible by construction rather than by a detector.

### `required` means at least one entry

`required: true` on the group means `min` is at least 1. `min` and `max` are the entry count;
`required` on a *child* is per entry, and only applies to entries that exist.

## Consequences

- `Field` becomes two unions rather than one: the variants that may appear inside an entry, and
  those plus the group itself. That is a mechanical refactor of one large `discriminatedUnion`, and
  it is the reason this is a phase and not an edit.
- `answerableFields`, `validateSubmission`, `exportColumns` and the row flattener each grow a case.
  The renderer grows an add/remove control; the builder grows a nested editor.
- Sixteen or so new message keys across twelve catalogues, per rule 4.
- The report and print CSS need a repeated block, which is the part most likely to surprise.

## Deferred, deliberately

**A guest is not a registrant.** The obvious next question for an AGM is whether each entry in a
"guests" group should get its own admission card and its own check-in — and under this design it
does not, because the submission is still one row with one reference. That is the right default:
an entry is an *answer*, not a person with a ticket.

Making entries independently admissible is a different feature with its own model — it needs a
per-entry identity, a per-entry QR, and an answer to "what does the door do when the member arrives
and the guest does not". It should not be reached by quietly giving repeating groups a second
meaning. When somebody asks for it, it is its own ADR.

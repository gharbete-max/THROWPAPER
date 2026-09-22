# ADR 0006 — One wizard across verticals, by composing blocks

**Status:** accepted 2026-09-22 — the direction is the owner's, decided on paper the same day
**Date:** 2026-09-22

The product is to cover forms across verticals — real estate, AGM/EGM, small business, trades, and
misc events — through an Akinator-style flow: *what business are you in* (including **none**, which
is what covers misc events), then a multi-select matrix of what the form should contain, then a
composed result, then easy-or-advanced customisation. Community sharing of forms is wanted later.

This ADR records that direction, says which part of the existing model survives it, and names the
one guarantee that does not.

## Composition, not retrieval

The objection this will meet is that a wizard "will not scale to millions of forms". It was made
against this project before, and it is aimed at the wrong thing: **selecting one leaf from a
library** of millions. That is retrieval, and a wizard is a bad way to do it — twenty questions
gets you a million leaves only if every question is perfectly balanced, and the person answering
has to already know which leaf they want.

This is not that. **You author blocks, and the millions are combinations.** A few dozen authored
blocks compose into more forms than anybody will ever need, and the wizard's job is to pick a
handful of them, not to navigate to one of a million. Adding a vertical adds blocks, not depth.

Record it here because the objection is reasonable-sounding, will be raised again, and has a
one-sentence answer.

## What already exists, and stays

`packages/shared/src/wizard/tree.ts` **already composes.** This is not a new model:

- `WizardOption.contributes` — what choosing an option adds.
- `WizardTree.keyOf` — how an item identifies itself, so the same thing contributed by two
  branches appears once. The reason is in its own comment at `tree.ts:60`: *"two paths can both
  ask for an email address; a form with two email boxes on it is a form somebody fills in twice
  and then queries."*

**Both stay exactly as they are.** Deduplication is the load-bearing part of composition, and it is
already written, already tested, and already right.

## What changes: `next` becomes a set

`WizardOption.next` names the one question that follows. `collect()` and `currentQuestion()` both
walk it, one answer at a time, so **the order of questions is a property of the data**. That is
the right shape for a decision tree and the wrong shape for facets: "does it need payment" and
"does it need a signature" are independent, and making one of them come second is an invention.

So `next` is replaced by a **question set selected by sector** — order-independent facets. The
sector answer chooses which facets apply; the facets are then answered in any order, multi-select.

## What is lost: `everyPath()`, and the promise it carried

`everyPath()` (`tree.ts:142`) enumerates every complete run. It is the proof behind two promises in
`packages/shared/src/forms/wizard.test.ts`:

- a run **finishes** — a tree that loops is caught and named rather than hung on;
- a run takes **at most four presses**.

Enumeration is 2ⁿ once an answer is multi-select, so it cannot survive. Three cheaper invariants
replace it:

1. **Every question is reachable** from its sector.
2. **Every contributed key resolves** to a real block.
3. **No combination produces a duplicate key** — the `keyOf` guarantee, checked across facets
   rather than along a path.

**Two things must be said honestly about that trade**, because a replacement that quietly drops a
promise is worse than no replacement:

- **Cycles stop being possible rather than being detected.** A set has no `next` to point backwards
  through, so the loop check is not lost, it is made unnecessary. That is a real improvement.
- **The four-press promise is genuinely lost** and must be restated, or it disappears without
  anybody deciding to drop it. It becomes a **bound on the number of facets a sector may select** —
  the same promise, expressed against the new model, and testable in one line. Whoever implements
  this is to write that test first.

Three of the existing tree tests — "no dead ends", "can reach every question it defines", "gives
every option a distinct id" — are already invariant-shaped rather than path-shaped, and survive
untouched. The change is smaller than the paragraph above makes it sound.

## Trades and law: structure only

Trades and law are **safety-critical and legal wording**, which `CLAUDE.md` rule 8 forbids this
project from generating. A checklist that omits a step is worse than no checklist, and a clause
that is nearly right is worse than a blank.

Those verticals ship **structure with explicit bracketed placeholders**, exactly as the proxy
template already does. The block says what belongs there; a human writes what it says. This is not
a limitation to be engineered around later — it is the decision.

## Community sharing is the owner's question, not engineering's

Sharing forms between customers means **public user-generated content**, and that flips a
classification the project currently relies on. `PRE-LAUNCH-AUDIT.md` Phase 0 concluded the DSA
does not apply **because there is no public UGC**. Introducing it brings, at minimum:

- notice-and-action,
- a published point of contact,
- moderation terms,
- a contribution licence — who owns a shared form, and what the product may do with it.

**This ADR does not decide that.** It records that the feature carries those obligations, so the
decision is taken deliberately rather than discovered after launch. It belongs beside the other
owner decisions in `LAUNCH-CHECKLIST.md` §3.

## What may be borrowed, and what may not

Nothing ships unverified.

- **`surveyjs/survey-library` (MIT; Creator, PDF and Dashboard are separate commercial products)
  — do not adopt.** It would replace a builder and renderer that are already translated into
  twelve languages, already server-rendered, and already have print CSS and a PDF pipeline. Take
  its **question-type taxonomy as a checklist** and its **JSON schema as an import target** —
  worth more to a community catalogue than a rendering engine, and `importSurveyJson` already
  exists.
- **`FormBold/html-form-examples-templates` (MIT, no attribution required)** — useful as field-list
  *content* when authoring blocks. Not code.
- **`formml/formml` (MIT)** — skip. The Zod `FormDefinition` already covers what it offers.
- The other repositories suggested are irrelevant to a TypeScript stack or actively wrong for it.
  One is a bulk-mail script, which is the opposite of `CLAUDE.md` rule 7 and of
  marknadsföringslagen.

## Consequences

- `packages/shared/src/wizard/tree.ts` gets a **breaking change** — a shared package, and a
  lead-owned conflict zone. It is why this ADR exists before the diff.
- `wizard.test.ts` loses its path-based tests and gains invariant ones, **including the restated
  four-press bound**.
- The wizard entry in `Forms.tsx` and `wizardAnswers` on `POST /v1/forms` keep their shape: answers
  remain a list of option ids. The contract does not move.
- Adding a vertical becomes authoring blocks and naming which facets its sector selects. No new
  depth, no new code.

## Decided

Compose, do not retrieve. Keep `contributes` and `keyOf`. Replace `next` with sector-selected facet
sets. Replace `everyPath()` with three invariants **and a restated four-press bound**. Trades and
law ship bracketed placeholders. Community sharing waits for an owner decision on the DSA
obligations it carries.

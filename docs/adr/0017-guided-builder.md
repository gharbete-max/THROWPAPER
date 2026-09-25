# ADR 0017 — The guided builder: a conversation that patches a real draft

**Status:** proposed — the direction is the owner's brief of 2026-09-25; §14 of that brief (the
questions in `docs/plan/PREDICTIVE-BUILDER.md`) is open
**Date:** 2026-09-25
**Amends:** ADR 0006 (the form wizard's questions are replaced; `tree.ts` stays for other surfaces)
**Depends on:** ADR 0019 (deterministic reading of free text), ADR 0020 (the graph as data),
ADR 0012 (wording Loppa does not write)

## Context

The owner wants the classic builder — an empty canvas, a palette of field types, a properties
panel — replaced as the way in by a **guided, predictive, click-through conversation**: short
questions, large answers, a confident guess at what the form is, and a live preview that can be
clicked to edit. Somebody who makes one form a year must be able to publish a correct form by
clicking.

The repository already went part of the way. ADR 0006 made the wizard the default start ("a few
narrow questions, and the form falls out of the answers"), and `wizard-definition.ts` resolves a
run of answers into a `FormDefinition` on the server. What it cannot do is the rest of the brief:
configure a question after it exists (buttons? how many? which shape?), show the result as it is
built, let a hand edit and a guided answer coexist, or resume after a refresh. Its answers produce
fields once and then hand over to the editor.

## Decision

1. **The conversation is the primary door** ("Start from questions"), beside "Start from paper"
   (ADR 0018). The classic editor stays one press away on every screen, as today.
2. **One document model.** The draft is the existing `FormDefinition` (and the form's title), plus a
   **builder sidecar** kept in the session and never published: provenance per field, the guided
   baseline for reconciliation, pending proposals, retired ids, the conversation's working memory.
   No `FormDraft` type is introduced.
3. **Every answer is a patch** — `set`, `add`, `remove`, `insert`, `reorder` on paths that address
   fields by id — and patches are the only way the conversation, free text and inline editing
   change anything. The log stores each resolved patch and its inverse; **replaying it reproduces
   the draft byte for byte**, which a property test proves.
4. **The draft is publishable from the first answer.** An invariant test holds
   `definitionProblems()` empty at every node.
5. **Inline editing is the same reducer** with `source: 'manual'`. Handles snap to what
   `ChoiceStyle` allows; no pixel radius, no size under the tap target, no free colour.
6. **Reconciliation by comparison, not by bookkeeping.** A field whose value differs from its
   guided baseline has been changed by hand, wherever that happened. The conversation never
   overwrites it; it asks — Keep mine / Use guided / Show both — and parks the guided value as a
   proposal.
7. **Stable ids.** Fingerprint-seeded once, never recomputed, never reused (the sidecar's
   `retiredIds`), because responses and paper overlays point at them.
8. **The guess** is a belief over the existing `FORM_TEMPLATES`, in integer log-odds (ADR 0019),
   shown at p ≥ 0.80 with Right / Sort of / No and its reasons. Templates that rule 8 keeps out of
   the catalogue (consent forms, incident reports) may be recognised but seed structure and
   bracketed placeholders only.
9. **Sessions persist** in `builder_sessions` (`GET/PUT /v1/forms/:id/builder-session`); the desktop
   runs the same `api-forms` on PGlite (ADR 0016), so the same table is its workspace storage.
10. **Where it lives:** the pure core in `@tp/shared` (`/builder`, `/interpret`); the screens in
    `apps/forms/src/screens/builder/guided/`.

## Consequences

- `packages/shared` gains two subpath exports and, in S5, three presentation-only schema additions
  (`ChoiceStyle` shapes `tab` and `segmented`, `FormSettings.layout`). Old definitions parse
  unchanged; `schemaVersion` stays 1.
- `apps/api-forms` gains one table and two routes. They are Forms' own and are documented by
  their Zod schemas, not in `docs/CONTRACT.md`, which is the inter-product contract.
- The form wizard's questions (`forms/wizard.ts`) stop being the "new form" start once S4 ships;
  `wizardAnswers` on `POST /v1/forms` keeps working (`CAVEATS.md` #56). The generic `Wizard`
  component and `tree.ts` stay for mailings and invoice runs.
- Two undo systems exist side by side: the editor's snapshot history (unchanged) and the
  conversation's patch log. Both are needed: snapshots cannot be replayed or explained.

## Rejected alternatives

- **Use an LLM to build the form from a description** (ADR 0013's `form-from-description`).
  Rejected for this door: its output differs between runs and model versions, so no test can
  freeze it (determinism); the desktop app works offline and a model does not (parity); every
  form would cost a provider call (cost); the description, and the answers it implies, would leave
  the machine and the privacy page's "no transfers" answer would change (privacy); and a wrong
  field cannot be traced to a rule anybody can read or fix (testability). The conversation gets
  the same result from about a dozen presses, every one of which is explainable.
- **A new `FormDraft` model** as the brief sketches. Rejected: a second document the editor,
  renderer, PDF, CSV and paper overlay do not read would need a converter in each direction, and
  the converter is where wording and ids would be lost.
- **Keep the ADR 0006 wizard and add configuration questions to it.** Rejected: its model is
  "answers contribute fields"; configuring an existing field, previewing, reconciling hand edits
  and replaying need patches on a draft, which is a different model.
- **Replace the classic editor.** Rejected: it is the way out that "never a dead end" requires,
  and it is how people who build forms every week work.

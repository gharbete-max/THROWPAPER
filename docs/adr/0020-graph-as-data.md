# ADR 0020 — The conversation is a validated graph of data

**Status:** proposed — the direction is the owner's brief of 2026-09-25
**Date:** 2026-09-25
**Amends:** ADR 0006 — keeps its facets for choosing what a form is; adds ordered chains for
configuring one question; restates its four-press promise as a bound on chains

## Context

The guided builder (ADR 0017) asks a sequence of questions whose order sometimes matters and
sometimes does not. "How many options?" means nothing before "Do you want buttons?"; "Does it need
payment?" and "Does it need a signature?" are independent.

ADR 0006 (accepted) removed `next` from the wizard for exactly the second case — "making one of
them come second was an invention nobody decided on" — and replaced it with facets selected by a
sector, which also made cycles impossible. It recorded that a promise was lost with the path
enumeration ("at most four presses") and restated it as a bound.

The brief asks for a directed graph with `next`, `when` guards, declarative patches, scores, and a
build-time validator — and allows guarded cycles (the "add another question?" loop).

## Decision

1. **The conversation is data**: one TypeScript module of plain data (`builder/graph/nodes.ts`,
   `satisfies BuilderGraph`, proven JSON-serialisable by a test), rendered by components that never
   decide what comes next. The schema, the node kinds, and the `when` / `patch` / `score` semantics
   are `docs/plan/BUILDER-GRAPH.md`.
2. **Both of ADR 0006's shapes, each where it is right.** The purpose question (`flow.start`) and
   the feature menu keep facet semantics: independent, answerable in any order, reached through
   menus. **Ordered `next` exists only inside a feature's chain** (buttons → one or several → how
   many → shape → placement), where the order is the meaning.
3. **`when` guards are a small, total language** parsed by hand into an AST: paths, comparisons,
   `&&` `||` `!`, and four functions (`answered`, `decided`, `count`, `has`). No `eval`, no
   `Function`, no arithmetic, bounded length and depth; every guard carries a plain-language reason
   shown when its node is skipped.
4. **The validator** (`pnpm builder:validate`, also a test inside `pnpm verify`) rejects: unknown
   references, unreachable nodes, nodes without a way out, missing or empty translations in any of
   the twelve locales, patches on paths the schema does not have, cycles that turn without the
   person steering them or have no exit, option counts outside 2–4 (or 2–8 for choosers), unparsable
   guards, unknown templates in scores, questions over nine words or with banned words, and
   operative wording in example chips.
5. **ADR 0006's four-press promise, restated again:** from the start of any feature, the longest
   chain without a guard to a preview or the end is at most **six** nodes (rule G11), and the first
   answer of the whole conversation already yields a publishable draft.
6. **Cycles** are allowed only when steered by an answer and with an exit (G6); a step budget in
   the machine (500 transitions per session) turns a validator bug into an error instead of a hang.

## Consequences

- ADR 0006 gains a note pointing here. `wizard/tree.ts` and its tests are unchanged: the generic
  `Wizard` still starts mailings and invoice runs.
- Adding a question to the conversation is adding data and twelve translations, and the validator
  says what is missing.
- Components get simpler and dumber by design; the machine (S2) owns every transition.
- Graph versions change over time; logs store resolved patches, so old sessions replay unchanged.

## Rejected alternatives

- **Let an LLM decide the next question.** Rejected: a conversation whose next step is generated
  cannot be validated for dead ends or replayed from a log (determinism, testability), would need a
  network on the offline desktop (parity), and would send what people are building to a provider
  (privacy, cost).
- **A statechart library (XState and the like).** Rejected: a dependency (ADR 0021's rule and
  `CAVEATS.md` #41), and its guards and actions are functions — code in the data — which is what
  this decision exists to keep out.
- **YAML or JSON as the source format.** Rejected for now in favour of typed TypeScript data: YAML
  needs a parser dependency (ADR 0021); JSON has no comments and no type checking at the point of
  writing. The serialisability test keeps JSON available if a server ever has to deliver the graph.
- **Conditionals in components.** Rejected: the graph could no longer be validated or walked by a
  test, and "why was I asked this?" would have no answer.

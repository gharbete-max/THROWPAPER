# ADR 0019 — Reading free text and guessing templates by rules, in integers

**Status:** proposed — the direction is the owner's brief of 2026-09-25
**Date:** 2026-09-25
**Narrows:** ADR 0013 (AI assistance) — the builder and the importer do not use it

## Context

Two parts of the brief interpret imprecise human input: the **text entry** at every node of the
conversation ("four buttons in a row", "flerval", "utan knappar"), and the **guess** at what kind of
form is being built ("This looks like an event registration — right?"). ADR 0013 (proposed) had
pencilled in an AI provider for this kind of job. The brief forbids it outright: no AI, no LLM, no
ML service, no network call at runtime; same input, same output, on every machine.

"Same output on every machine" is stricter than it sounds. JavaScript's `Math.exp`, `Math.log` and
`Math.pow` are not required to be correctly rounded, and engines differ in the last bit. A
threshold compared against a floating-point probability can therefore flip between Chrome, Safari,
Node and the desktop's Electron — rarely, which is the worst kind of rarely.

## Decision

1. **A ladder of deterministic methods** reads free text (`docs/plan/INTENT-LADDER.md`): exact and
   alias match, normalised token match, weighted keywords, fuzzy match (trigram Dice and
   Jaro-Winkler, Levenshtein for long words), gazetteers and patterns, a multi-slot parse, list
   extraction, ranking within the current group — and, when nothing clears its threshold, a visual
   menu. Nothing below threshold is applied; every applied reading is one press from undone and
   shows what it read.
2. **Integers in every decision.** Confidences are per mille; ratios are compared by
   cross-multiplication; belief is integer log-odds in millinats. Logarithms needed for keyword
   weights are computed **with integers** — a fixed-point series, exact far beyond the rounding
   (`interpret/ln.ts`) — so no floating-point function is in a decision and nothing needs
   generating at build time. (This read "once, at build time, into a committed, freshness-tested
   index" until S3 built the ladder: the integer logarithm does the same job with no build step,
   and learned aliases need weights computed at runtime anyway; `INTENT-LADDER.md`, "No generated
   index".) The
   sigmoid used for display and the p ≥ 0.80 test is a **committed lookup table**
   (`packages/shared/src/interpret/sigmoid.json`, −8000 to +8000 millinats in steps of 50, shared by the ladder, the importer's scores and the belief engine), not a runtime `Math.exp`.
3. **Learning without a model.** When the menu resolves an input, Loppa offers to remember the
   phrase as an alias — only on the person's press, per organisation, exportable and importable as
   `aliases.json` (ADR 0021). Learned aliases never override built-in ones or option ids.
4. **The guess** is a belief over `FORM_TEMPLATES`, updated only by `score` weights declared on the
   graph's options, three-state (Right / Sort of / No at 1.0 / 0.5 / 0.0), with the next question
   chosen by the largest expected reduction in belief entropy — computed from the same table — and
   the three strongest contributing answers always shown.
5. **ADR 0013 is narrowed**: its `form-from-description`, `form-from-page`, `suggest-validation`
   and `map-scanned-fields` tasks are done by these rules and by ADR 0018's pipeline. Whatever is
   left of it (summarising responses) remains the owner's decision and nothing here depends on it.

## Consequences

- Every behaviour change to the ladder — an alias, a gazetteer word, a threshold — needs a row in
  the phrase tables in the same commit (`CLAUDE.md`, "Guided Builder & Import").
- The phrase tables are per language, for twelve languages: real translation work in S3 and S6.
- The ladder will say "I asked" more often than a model would. That is the intended trade: an extra
  press is recoverable, a confident misreading is not.
- Chinese and Japanese are tokenised as character bigrams; the fuzzy tiers mean little there, and
  the menus carry more of the load.

## Rejected alternatives

- **An LLM, or a hosted NLU service,** to read the text entry. Rejected: output that changes with
  the model version cannot be frozen by a test (determinism); the desktop works offline (parity);
  a call per keystroke-burst is a cost per author (cost); what people type about their forms would
  leave the machine (privacy); and a wrong reading would have no rule to point at (testability).
- **Embeddings, even local ones.** Rejected: a model file of tens of megabytes in a bundle that
  budgets kilobytes, float similarity scores that are not reproducible across engines, and no human
  can read why two phrases are "close".
- **A trained classifier** (naive Bayes, logistic regression) for the kind of an imported question.
  Rejected in favour of hand-set named weights in `weights.json`: the same arithmetic, but every
  number is chosen and reviewed by a person and has a feature name beside it.
- **Floating-point probabilities** with an epsilon. Rejected: an epsilon only moves the boundary
  where engines disagree; it does not remove it.

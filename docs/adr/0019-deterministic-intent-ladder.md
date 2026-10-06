# ADR 0019 — Reading free text and guessing templates by rules, in integers

**Status:** accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical", given in the session that built it, after every slice was built and green) — proposed 2026-09-25 from the owner's brief; built in S3, S6 and S11
(PR #147, "As built" below)
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
   (`packages/shared/src/interpret/sigmoid.json`, −8000 to +8000 millinats in steps of 50, shared
   by the ladder and the importer's scores), not a runtime `Math.exp`. The belief engine, which
   needs e^x over a whole belief rather than one sigmoid, has an **integer exponential** instead:
   `expMicro` (`interpret/exp.ts`), 10⁶·e^(−x) by the same 40-digit series the table was made
   with, which also needs no build step.
3. **Learning without a model.** When the menu resolves an input, Loppa offers to remember the
   phrase as an alias — only on the person's press, per organisation, exportable and importable as
   `aliases.json` (ADR 0021). Learned aliases never override built-in ones or option ids.
4. **The guess** is a belief over `FORM_TEMPLATES` (and two structure-only recipes rule 8 keeps
   out of the catalogue), updated only by `score` weights declared on the graph's options,
   three-state (Right / Sort of / No at 1.0 / 0.5 / 0.0), with the next question chosen by the
   largest expected reduction in belief entropy — computed with the same integers — and the three
   strongest contributing answers always shown. As built in S11 (`docs/plan/BELIEF.md`), a score
   is normalised over its node's scored options, `P(option | recipe) = e^score / Σ e^score`,
   rather than added as it stands: only then can a question's answers be weighed against each
   other, which choosing the question that tells most requires.
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

## As built (S13, 2026-10-05)

All five decisions are built as written:
- **The ladder, T0–T8**, in twelve languages (S3, S6). Every card's label is among its aliases. The
  phrase tables run every row, and must-not-resolve rows sit beside them.
- **No floating point in a decision:**
  - `interpret/ln.ts`, an integer logarithm;
  - `interpret/exp.ts`, an integer exponential;
  - `interpret/sigmoid.json`, 321 values from −8 000 to +8 000 millinats in steps of 50.
- **The guess** (S11, `docs/plan/BELIEF.md`): a belief over 25 recipes (the 23 templates and the two
  rule 8 keeps structure-only), shown at 800 per mille.

Three things are worth knowing:
- **The ladder's budget is a count of comparisons, not a clock.** A pathological input spends it and
  asks, the same way on every machine (`CAVEATS.md` #42). The clocks are only in tests.
- **The guess questions' yes, no and not sure are written once per language** (`aliases/answers.json`),
  not once per question.
- **Graph version 7's "How should people answer?" is in the text group** (S13), so a sentence at
  "Do you want buttons?" reads exactly what it did before; no phrase-table row moved.

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

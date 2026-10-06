# ADR 0021 — Data files are JSON or typed TypeScript, never YAML

**Status:** accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical", given in the session that built it, after every slice was built and green) — proposed 2026-09-25 from the owner's brief (§13); followed throughout
S1–S14 (PR #147, "As built" below)
**Date:** 2026-09-25

## Context

The guided builder and the importer are driven by data a person edits: the conversation graph,
alias tables (including an organisation's learned aliases, exported and imported as a file),
template recipes, gazetteers, heuristic weights. The brief's first draft suggested YAML for some of
these; its revision rules YAML out, with reasons.

An inventory at the time of writing (`pnpm ls -r --depth 0 | grep -i yaml`) found **no direct YAML
dependency** in any package. `yaml@2.9.0` is present only transitively — through `@fastify/swagger`
in `apps/api-forms` (server side, for its own OpenAPI output) and through Vite (build time).
Nothing in application code parses YAML.

## Decision

1. **Data files are JSON, or typed TypeScript data.** The graph is typed TS (`nodes.ts`,
   `satisfies BuilderGraph`, proven JSON-serialisable by a test). Aliases, recipe scores, weights,
   lexicons and gazetteers are JSON. (There is no generated index: S3 computes the logarithm in
   integers instead — ADR 0019.)
2. **No YAML in application code, and never a YAML parser as a dependency** — direct, or imported
   from a transitive package. Prettier's YAML formatting is a development tool and is not imported.
3. **JSON data follows house rules:**
   - **Provenance is a field, not a comment** (`source`, `createdAt`, `count`, `notes`).
   - **Stable key order and sorted entries**, two-space indentation, so a diff is readable and the
     same data always produces the same bytes.
   - **Schema-validated on load** (Zod), with the first error reported by path.
   - **A recovery path for every user-editable file**: "Reset to defaults" and, on the desktop, the
     malformed file moved aside rather than deleted — a bad hand edit never bricks the builder.
     (S6: an organisation's learned aliases live in the database, on the desktop too, so there is no
     file to hand-edit; an imported file is validated and refused whole, with its first problem,
     before anything is stored, and "Remove all" is their reset to defaults.)
4. **`fixtures/`** are JSON too. They are hand-authored with one layout-IR word per line for
   reviewable diffs, excluded from Prettier (which would spread each word over twenty lines), and
   validated for structure by `scripts/caveat-fixtures.test.ts` instead.

## Consequences

- `JSON.parse` is the only parser, and it behaves identically in the browser, in Node and in the
  packaged desktop app; an exported alias file opens anywhere without a parser on the user's
  machine.
- JSON has no comments. Where a data file needs explanation, it goes in a `notes` field or in the
  document that specifies the file.
- `CLAUDE.md` carries the rule, so a later session does not reintroduce YAML.

## As built (S13, 2026-10-05)

The rule held. The data files are JSON, each with a test that its bytes are exactly what its entries
format to:
- the aliases in twelve languages, and the guess questions' shared answers;
- `belief/recipes.json`;
- the classifier's `weights.json` and lexicons;
- the gazetteers;
- `sigmoid.json`;
- the phrase tables, the numbering, re-import and session fixtures.

No `package.json` lists a YAML parser. An organisation's learned aliases live in its database, are
exported and imported as `aliases.json`, and are refused whole, with their first problem, when they
are wrong.

## Rejected alternatives

- **YAML for readability.** Rejected: a parser dependency with a history of surprising coercions
  (the "Norway problem": `no` read as `false` — in a product whose Norwegian locale is `nb-NO`), a
  second syntax for the same data, and an exported file the user's machine may not read.
- **TOML, JSON5, or JSONC.** Rejected: each needs a parser that is not in the platform.
- **Let an LLM maintain the alias and weight tables.** Rejected with the rest of ADR 0019: the
  tables are the audit trail of every decision, and a person must be able to say who changed a
  number and why.

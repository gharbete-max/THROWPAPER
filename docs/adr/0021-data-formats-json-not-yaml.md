# ADR 0021 — Data files are JSON or typed TypeScript, never YAML

**Status:** proposed — the rule is the owner's brief of 2026-09-25 (§13)
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
   lexicons, gazetteers and the generated index are JSON.
2. **No YAML in application code, and never a YAML parser as a dependency** — direct, or imported
   from a transitive package. Prettier's YAML formatting is a development tool and is not imported.
3. **JSON data follows house rules:**
   - **Provenance is a field, not a comment** (`source`, `createdAt`, `count`, `notes`).
   - **Stable key order and sorted entries**, two-space indentation, so a diff is readable and the
     same data always produces the same bytes.
   - **Schema-validated on load** (Zod), with the first error reported by path.
   - **A recovery path for every user-editable file**: "Reset to defaults" and, on the desktop, the
     malformed file moved aside rather than deleted — a bad hand edit never bricks the builder.
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

## Rejected alternatives

- **YAML for readability.** Rejected: a parser dependency with a history of surprising coercions
  (the "Norway problem": `no` read as `false` — in a product whose Norwegian locale is `nb-NO`), a
  second syntax for the same data, and an exported file the user's machine may not read.
- **TOML, JSON5, or JSONC.** Rejected: each needs a parser that is not in the platform.
- **Let an LLM maintain the alias and weight tables.** Rejected with the rest of ADR 0019: the
  tables are the audit trail of every decision, and a person must be able to say who changed a
  number and why.

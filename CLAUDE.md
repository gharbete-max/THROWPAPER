# CLAUDE.md

Monorepo containing **two independent products** plus the packages they share. Read
`docs/CONTRACT.md` first, then the spec for whichever product you are working on. Do not paste
specs into this file.

```
apps/forms      Product A — forms, inspections, measurements, reports
apps/mailer     Product B — email campaigns
apps/api-forms  Product A backend
apps/api-mailer Product B backend
packages/tokens Design tokens as JSON. Compiled to CSS vars / inline email styles / print CSS
packages/i18n   Translation catalogues and locale utilities
packages/ui     Headless + styled primitives, including the data grid
packages/calc    Formula AST, statistics library, chart definitions
packages/shared  Types and Zod schemas, including the CONTRACT schemas
```

## Rules that apply to every session

1. **The two products never import each other.** `apps/forms` may not import from `apps/mailer`
   or its database. They talk only through the HTTP contract in `docs/CONTRACT.md`. If you find
   yourself wanting a direct import, the contract is missing something — change the contract.
2. **Each product must run standalone.** `apps/forms` with the mailer switched off falls back to
   direct SMTP. `apps/mailer` works with audiences uploaded by CSV and no forms app at all.
3. **API-first, token auth.** Every screen calls a documented endpoint. Bearer + refresh, not
   cookie-only, so native clients can follow later.
4. **No hard-coded colours, fonts, spacing or user-facing strings.** Colours and type come from
   `packages/tokens`; text comes from `packages/i18n`.
5. **Exact arithmetic.** Money, quantities and measurements use decimal or bigint. Never floats.
6. **Locale-aware sorting.** ICU collation (Swedish sorts å ä ö after z; Danish and Norwegian
   sort æ ø å). Numeric columns sort on the numeric column, never a formatted string.
7. **Nothing sends or deletes without a confirmation step**, and every outbound action has a
   test mode.
8. **Do not generate legal, clinical, tax or safety-critical wording.** Templates come from a
   human. See the deferred list in each spec.

## Commands

```
pnpm dev:forms      pnpm dev:mailer
pnpm verify         # format + typecheck + lint + test + build across the workspace — must pass before a phase is done
pnpm db:migrate     pnpm db:seed
pnpm contract:check # validates both apps against docs/CONTRACT.md schemas
pnpm test:e2e
```

## Demo data

`pnpm db:seed` must always leave both products fully demonstrable: a brand kit, ~200 contacts
across three audiences, one event with registrations, one inspection template with completed
inspections, one measurement dataset with results, and three email templates. A broken seed
blocks demos — keep it current with the schema.

## Working style

- Plan mode before every phase. Show the plan before writing code.
- One phase per branch. `pnpm verify` and `pnpm contract:check` pass before a phase is done.
- Batch your questions rather than asking one at a time.
- If a change touches `packages/` or `docs/CONTRACT.md`, say so explicitly — the other track
  depends on it.

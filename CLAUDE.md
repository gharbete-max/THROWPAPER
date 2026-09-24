# CLAUDE.md

Monorepo containing **three independent products** plus the packages they share. Read
`docs/CONTRACT.md` first, then the spec for whichever product you are working on. Do not paste
specs into this file.

```
apps/forms      Product A — forms, inspections, measurements, reports
apps/mailer     Product B — email campaigns
apps/api-forms  Product A backend. Sends PDFs to Sign over CONTRACT §5 when SIGN_API_URL is set
apps/api-mailer Product B backend
apps/sign       Product C — signing. The signer's page: open a link, read the declaration, sign
                by typing or drawing, or decline (en/sv). No sender screens yet
apps/api-sign   Product C backend. Own database (append-only, hash-chained trail) on Postgres or
                PGlite, CONTRACT §5.1–5.5 (per-organisation declarations), typed and drawn signing by link, PAdES seal + audit
                page on completion (development certificate); serves the page
apps/desktop    Loppa desktop (Windows, macOS): hosts Forms and Sign side by side, each on its own
                embedded Postgres (PGlite) and loopback port, offline first. Not a product; it
                imports only @tp/api-forms/desktop and @tp/api-sign/local (docs/adr/0016)
packages/tokens Design tokens as JSON. Compiled to CSS vars / inline email styles / print CSS
                / native tokens. Owns the contrast guard
packages/i18n   Translation catalogues and locale utilities, incl. ICU collation
packages/ui     One `cn()` class-name helper. The shared data grid is deliberately not in v0.1
                — see its own src/index.ts
packages/calc   Calculation errors and propagation, exact money, the ledger
packages/shared Types and Zod schemas, including the CONTRACT schemas
packages/signing The signing model: levels, envelopes, the audit-trail state machine, hashing
```

Descriptions above are of what a package **contains**, not what it is planned to contain, and a
description changes in the same PR that changes the package. Two of them were written from intent
and survived long enough to be planned around; a data grid that does not exist is worse than no
entry at all.

## Rules that apply to every session

1. **The products never import each other.** Forms, Mailer and Sign (`docs/adr/0009`) may not
   import from one another or each other's databases; `eslint.config.js` enforces it. They talk
   only through the HTTP contract in `docs/CONTRACT.md`. If you find yourself wanting a direct
   import, the contract is missing something — change the contract.
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
9. **Internal names stay `throwpaper` / `@tp/*`** by owner instruction. Only user-facing strings
   say Loppa. **Never mass-rename** — a sweep across package names, imports and identifiers is a
   large diff that buys nothing a user can see.

## Commands

```
pnpm dev:forms      pnpm dev:mailer      pnpm dev:sign
pnpm --filter @tp/desktop start        # the desktop app, unpackaged
pnpm --filter @tp/desktop package:win  # installer + portable .exe (a zip when not on Windows)
pnpm --filter @tp/desktop package:mac  # .dmg for Apple Silicon and Intel (a zip when not on a Mac)
pnpm verify         # format + typecheck + lint + test + build across the workspace — must pass before a phase is done
pnpm db:migrate     pnpm db:seed
pnpm contract:check # validates all three backends against docs/CONTRACT.md schemas
pnpm licence:check  # every installed dependency is permissive (docs/adr/0015)
pnpm test:e2e
```

## Demo data

`pnpm db:seed` (and the desktop's "open with demo data", which runs the same `seedDemo`) writes,
today: the Demo AB organisation with an admin and an operator, its brand kit, one event with ~200
registrations through a published form, a draft form shared with the admin, and a form in the
bin. That is what it **contains**. The target it must grow into as the products do: ~200 contacts
across three audiences, an inspection template with completed inspections, a measurement dataset
with results, and three email templates — none of which has a table yet. A broken seed blocks
demos — keep it current with the schema.

## Working style

- Plan mode before every phase. Show the plan before writing code.
- One phase per branch. `pnpm verify` and `pnpm contract:check` pass before a phase is done.
- Batch your questions rather than asking one at a time.
- If a change touches `packages/` or `docs/CONTRACT.md`, say so explicitly — the other track
  depends on it.

## Never mistake a proxy for the thing

This project's recurring defect is not a kind of bug, it is a kind of **reading**: something cheap
is checked and the expensive thing is assumed. It has happened four times, each time convincingly.

- A suite that **skipped** printed `SKIPPED` and exited **0**, so it read as nineteen passing tests.
  `scripts/run-e2e.ts` now exits 2. **A green `verify` is still not a green `e2e`** — `verify` does
  not run the suite at all.
- A **background command's** exit code was read as `pnpm verify`'s. It was the wrapper's. **Never
  trust a backgrounded exit code** — re-run in the foreground, or read the log.
- `pnpm verify` is a serial `&&` chain. Its exit 1 tells you only the **first** step that failed.
  When it fails, run `format:check`, `typecheck`, `lint`, `test` and `build` **individually**, or
  you will fix one thing and discover two more.
- A file was read at `691d40a`, the checkout moved to `main`, and the earlier read was asserted as
  current. It was two commits stale and the claim was wrong. **A measurement carries the commit it
  was taken at, and any `git switch` invalidates every prior read.** Re-read after switching.

The same shape one layer up, and the reason this section exists before any agent fan-out:

- **`.claude/` is ignored by prettier, eslint and vitest**, because nested worktrees hold a second
  full copy of the source. So `pnpm verify` **from the parent checkout does not examine anything
  inside a worktree**. An agent working in a worktree runs its gates _inside that worktree_; the
  parent's green says nothing whatever about the agent's work.
- e2e is a **shared, unshareable** resource: one Postgres, fixed ports, and `restart.spec.ts` alone
  takes 1.5 minutes. **At most one `pnpm test:e2e` at a time**, ever. Two concurrent runs produce
  flake that looks exactly like a real regression.

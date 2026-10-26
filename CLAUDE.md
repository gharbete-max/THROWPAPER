# CLAUDE.md

**Start with `docs/MAP.md`** — a one-page router (vision, rules, where to look per area, commands,
quirks, current state). Open the other documents only for the area you are working on.

**`docs/VISION.md`** is the owner's own words — open it for the why, not every session. Loppa is a lightweight helper in the office, not Acrobat: a room of
three independent catchers (Documents, Spreadsheets, Presentation & planning) with **Documents**
built and finished first. Its four parts are **Forms, Scan, Sign and Send**, around a **summary and
translation centre** that runs a local model on the person's own computer (ADR 0023, 0025). Spreadsheets
and Presentation & planning are floating placeholders; nothing more is built for them yet. Where an
older document disagrees with the vision, the vision wins.

**`docs/HANDOVER.md`** — open it for the history of decisions: the state, the order of work and the owner's decisions of
2026-10-12. The code is two products (Forms, Sign) and the desktop that hosts them, plus the packages they share,
which together serve the Documents catcher. Read `docs/CONTRACT.md` next, then the spec for
whichever app you are working on. Do not paste specs into this file.

```
apps/forms      The Documents catcher's screens (forms, scan, sign, send, invoices, the AI centre) and the
                room (/room). Earlier events/door/ledger screens stay in place, out of the room — never
                deleted unasked. `src/screens/` has one folder per part: room, scan, send, sign, forms,
                ai, plus `earlier/` (the old events screens) and `shell/` (login)
apps/api-forms  Forms' backend: forms, submissions and their PDFs, the PDF routes (`src/pdf/`,
                `routes/pdf*.ts`; page work keeps nothing), send/campaign/mail, invoicing, phone scan, the
                guided builder's saved conversations
apps/sign       Signing: the signer's page (open a link, sign by typing or drawing, or decline)
apps/api-sign   Sign's backend: own database, CONTRACT §5.1–5.7, PAdES seal + audit page
apps/desktop    Loppa desktop (Windows, macOS): hosts Forms and Sign on embedded PGlite and loopback ports,
                offline first; runs the AI centre (`src/ai/`, ADRs 0023–0025: one model through a pinned
                llama-server, one resident at a time) and Add-ons and updates (`src/addons/`, ADR 0026:
                the AI program, the AI pack, the update check; GitHub only, on a confirmed press). Not a
                product: imports only @tp/api-forms/desktop and @tp/api-sign/local (ADR 0016)
packages/tokens Design tokens as JSON → CSS vars / email styles / print CSS; the contrast guard; the room's colours
packages/i18n   Catalogues and locale utilities (ICU collation)
packages/ui     One `cn()` helper
packages/calc   Calculation errors, exact money, the ledger
packages/shared Types and Zod schemas incl. the CONTRACT; pure cores, one subpath each: `/builder`, `/interpret`,
                `/import` (the guided builder, free-text rules, document import and the digital copy — no AI,
                ever), `/summary` `/quoted` `/ai` (the AI centre's pure parts: manifests, tasks, checks,
                quoting), `/payable` (supplier-invoice rules), `/api` (request schemas)
packages/signing The signing model: levels, envelopes, the audit-trail state machine, hashing
```

Descriptions are of what a package **contains**; change one in the PR that changes the package. Finer
detail: `docs/MAP.md` (where to look) and each package's `src/index.ts`.

## Rules that apply to every session

1. **The products never import each other.** Forms and Sign (`docs/adr/0009`) may not
   import from one another or each other's databases; `eslint.config.js` enforces it. They talk
   only through the HTTP contract in `docs/CONTRACT.md`. If you find yourself wanting a direct
   import, the contract is missing something — change the contract.
2. **Each product must run standalone.** `apps/forms` sends mail itself (direct SMTP or its own
   provider). Mailer was never built; its stubs were removed (ADR 0026 #6) and mail is built inside Send.
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
pnpm dev:forms      pnpm dev:sign
pnpm --filter @tp/desktop start        # the desktop app, unpackaged
pnpm --filter @tp/desktop package:win  # installer + portable .exe (a zip when not on Windows)
pnpm --filter @tp/desktop package:mac  # .dmg for Apple Silicon and Intel (a zip when not on a Mac)
pnpm verify         # format + typecheck + lint + test + build across the workspace — must pass before a phase is done
pnpm db:migrate     pnpm db:seed
pnpm contract:check # validates all three backends against docs/CONTRACT.md schemas
pnpm licence:check  # every installed dependency is permissive (docs/adr/0015)
pnpm bundle:budget  # after a build: Forms' entry, stylesheet and total, gzipped. CI runs it; verify does not
pnpm builder:validate # the guided builder's graph against rules G0–G14, with all twelve catalogues, and its built-in aliases
pnpm corpus:build   # the import corpus's PDF and Word files from scripts/corpus/documents.ts, by LibreOffice (soffice)
pnpm test:e2e
```

## Demo data

`pnpm db:seed` (and the desktop's "open with demo data", which runs the same `seedDemo`) writes,
today: the Demo AB organisation with an admin and an operator, its brand kit, one event with ~200
registrations through a published form, a draft form shared with the admin, a form in the bin, and
two draft forms standing for documents brought in ("Membership application (from a PDF)",
"Inspection (from a Word file)"). The desktop's demo also leaves one message waiting in To send (the
filled membership PDF attached). That is what it **contains**. Beside it, `fixtures/demo/` holds
the files a person drops in: a PDF with fields of its own (blank and filled), a three-page PDF to
arrange, an invoice picture, a CSV for Send/batch and a sample document in Swedish and English for
the summary centre; the corpus in `fixtures/documents/` has the imported PDF and Word originals. Not
in the seed, and why: a signing request (`signing_requests.envelope_id` is NOT NULL and Sign has its
own database), a batch draft (a list is read in the browser and kept nowhere), and To send on the
web edition (it has none). Still to come: an invoice with a standing monthly charge. A broken seed
blocks demos — keep it current with the schema.

## Working style

- Plan mode before every phase. Show the plan before writing code.
- One phase per branch. `pnpm verify` and `pnpm contract:check` pass before a phase is done.
- Batch your questions rather than asking one at a time.
- If a change touches `packages/` or `docs/CONTRACT.md`, say so explicitly — the other track
  depends on it.

## Guided Builder & Import

The owner's brief is `docs/plan/BRIEF.md`; the plan is the rest of `docs/plan/` (start at
`PREDICTIVE-BUILDER.md`), and where the two disagree the plan wins and the brief is fixed. The
decisions are ADRs 0017–0021, accepted on 2026-10-06. ADR 0018 supersedes only ADR 0004's "never
creates a field"; ADR 0004 still governs the editor's classic paper import (boxes drawn by hand).

- **Six non-negotiables.** (1) In the builder and the import: no AI, no LLM, no ML service, no network call at runtime
  (the local summary model lives in the Documents centre, ADR 0023, and never decides anything here or runs in `packages/shared/src/{builder,interpret,import}`, VISION §9): rules,
  weights and thresholds a person can read and a test can freeze; same bytes in, same JSON out, on
  every machine. (2) The guided path is primary: a form can be built and published by clicking
  alone; free text is optional. (3) Never a dead end, never a silent guess: below threshold, ask.
  (4) Never destroy user text or edits: imported wording is verbatim, hand edits are overrides the
  guided flow never overwrites. (5) The core is pure and headless. (6) The plan lands before the
  code at scale.
- **The purity boundary.** `packages/shared/src/{builder,interpret,import}/` import no React, no
  DOM, no `node:*`, and call no `Date.now`, `Math.random`, `Math.exp`, `Math.log` or `Math.pow` in a
  decision: integers, per mille, millinats, committed tables. Bytes are touched only in
  `apps/forms/src/screens/forms/builder/paper/`.
- **i18n.** Every graph string is a `guided.*` key in all twelve catalogues in
  `apps/forms/src/lib/messages/` — never a literal. `pnpm builder:validate` fails on a missing one.
- **Data formats: JSON or typed TS, never YAML** (ADR 0021). No YAML parser as a dependency, ever.
  Provenance in fields, not comments; stable key order; schema-validated on load; a reset-to-defaults
  path for anything a user can edit.
- **The caveat ledger is test-first.** Every row of `docs/plan/CAVEATS.md` names its test; a
  §8.1/§8.2 row names a fixture in `fixtures/numbering/`, and `scripts/caveat-fixtures.test.ts`
  fails if it is missing. Write the fixture before the code that makes it pass. A fixture whose
  `status` is `green` is run through its stage there — output compared whole, debug artifact
  against `fixtures/numbering/debug/` — so marking one green is a claim the test checks.
- **A behaviour change to the ladder or the import heuristics needs a fixture in the same
  commit** — a phrase-table row, a numbering fixture, a corpus document. No exceptions: a changed
  threshold with no fixture is an unreviewed guess.

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

## Skills in the checkout

`.claude/skills/` holds `ponytail` (with `ponytail-review`, `-audit`, `-debt`, `-gain` and `-help`),
`impeccable` and `ui-ux-pro-max`, copied at pinned commits so every session has them from the
checkout with nothing to install. `.claude/skills/SOURCES.json` records where each came from, its
licence and its one patch, and `scripts/skills.test.ts` holds each folder to its hash.

- **They advise; this file decides.** Where a skill disagrees with this file — ponytail's "no
  fixtures", a design skill's taste against `DESIGN.md` and `docs/plan/DESIGN-LANGUAGE.md` — this
  file wins.
- **Never update one in place** (`npx impeccable update`, a hand edit): copy it again from its
  upstream commit, apply the recorded patch, and record the new commit and hash.
- `impeccable` fetches its engine binary on first use (see `SOURCES.json`); without the network it
  reads `DESIGN.md` itself. Give it a target, e.g. `--target apps/forms`.

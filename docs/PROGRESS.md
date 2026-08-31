# Progress

Session state for Claude Code. When a session gets heavy, write here and start fresh from this
file — START-HERE.md §Running it with Claude Code.

## Phase 0 — Skeleton · done except deployment

**Shipped**

- pnpm workspace: `apps/{forms,mailer,api-forms,api-mailer}`, `packages/{tokens,i18n,ui,calc,shared}`.
- TypeScript strict base config, ESLint 9 flat config, Prettier, Vitest at the repo root.
- `pnpm verify` = typecheck → lint → test → build across the workspace.
- `packages/shared/contract` — every endpoint in `docs/CONTRACT.md` as a Zod schema plus a
  manifest, and `pnpm contract:check` validating both apps' registries against it.
- `packages/tokens` — token JSON, `TokenSet` type, and the **web** compiler only.
- `packages/i18n` — locale fallback chain, translation completeness, ICU collation.
- `packages/calc` — typed error values (`#DIV0`, `#UNIT`, `#MISSING`) that propagate.
- `packages/ui` — `cn()` only. The shared grid is A4 and deliberately not in v0.1.
- `apps/api-forms` — Fastify, Zod-validated env, Drizzle + Postgres, first migration
  (`organisations`), `/health` that actually probes the database, seed script.
- `apps/api-mailer` — Fastify, `/health`. Scaffold only, per START-HERE §parallel tracks.
- `apps/forms` and `apps/mailer` — Vite + React 19 shells rendering entirely from token CSS
  variables and reporting backend health.
- Docker Compose Postgres 16 with an ICU `sv-SE` locale, and GitHub Actions CI running verify,
  contract:check, format:check, migrate and seed against a real Postgres service.

**Deferred, and why**

- **Deployment to the real hosting target.** Phase 0 says deploy on day one. It is not done
  because decision 4 (hosting region, email provider region) is unanswered — see below.
- **Email and PDF token compilers.** Phase 1. Doing them now would mean guessing at the renderer.
- `pnpm test:e2e` is a passing no-op until phase 3 gives it a public form to drive.

**Assumptions to check**

- Stack picked without asking: Vite + React 19 for the apps, Fastify 5 for the APIs, Drizzle ORM
  over postgres.js, Zod 3, Vitest. `SPEC-forms.md` §7 says "a modern meta-framework"; a split
  SPA + API was chosen instead because `CLAUDE.md` lists `apps/forms` and `apps/api-forms` as
  separate apps and rule 3 requires API-first with bearer tokens.
- Default locales are `sv-SE` and `en-GB`. Two languages must be chosen at the start (START-HERE
  §In scope) — confirm these are the two.
- Package scope is `@tp/*`.

**The five decisions from START-HERE.md, still unanswered**

1. Who is the first real user?
2. Which segment first? (recommendation in the doc: Events & registrations)
3. One builder or two? (if one: build sequentially, Sendwork stays a scaffold)
4. Hosting region and email provider region?
5. What would make you stop?

Phases 1–5 should not start before 2 and 4 are answered. 4 blocks the rest of phase 0.

## Phase 1 — Tokens across three targets · done

**Shipped**

- `packages/tokens/src/compile-email.ts` — `toEmailStyles()`. Resolved literal values and table
  layout, never a custom property. Tested for the absence of `var(`, flex and grid.
- `packages/tokens/src/compile-pdf.ts` — `toPrintCss()` with `@page` size, margins, running header
  and page-number counters, plus `toPdfHeaderTemplate()`/`toPdfFooterTemplate()`. Chromium ignores
  `@page` margin boxes, so both routes are generated from the same tokens.
- `packages/tokens/src/fonts.ts` — `@font-face` blocks with the Inter bytes inlined as data URIs
  (`@fontsource/inter`, latin + latin-ext). This is what makes å ä ö render instead of boxes.
- `packages/tokens/src/units.ts` — px arithmetic for the two targets that cannot use `calc()`.
- The PDF target is exported from `@tp/tokens/pdf`, **not** from the package root, because it reads
  font files from disk. Keeping it off the main entry point is what stops `node:fs` reaching the
  browser bundles.
- `scripts/proof/` — one card definition rendered through all three compilers, written to
  `proof-out/` as a side-by-side page. `pnpm tokens:proof --primary '#ff0000'` moves all three.
- `scripts/proof/proof.test.ts` — the checkpoint as a test: one token change must reach web CSS,
  email HTML and a real Chromium-rendered PDF, and the Swedish text must survive PDF text
  extraction with å ä ö intact.
- CI installs Chromium; the root `scripts/` directory is now typechecked (it was not before).

**Checkpoint result**

Passed. `#1f4b99` → `#ff0000` reaches all three, and Chromium computes `rgb(255, 0, 0)` for the
heading in print media. PDF text extraction returns `Välkommen till Vårmötet` and `åäöÅÄÖ`
unmangled, with the running header and `1 / 1` page number present.

**Deferred, and why**

- **Brand Kit editor**, theme presets and the Custom CSS panel — all A3. Phase 1 is the compilers.
- **The native compiler.** `SPEC-shared.md` lists four targets; START-HERE phase 1 asks for three.
  Nothing in v0.1 consumes it.
- Deployment still blocked on the hosting/email region decision.

**Assumptions to check**

- Email engine is **React Email**, PDF engine is **Playwright Chromium** (both chosen deliberately;
  Playwright is reused for phase 3 e2e).
- The React Email components live in `scripts/proof/`, not in a package. They move to a real home
  when Sendwork's block editor (B4) needs them — `packages/tokens` stays framework-free.
- Inter is the only family with embedded font files. Any other family falls back to the host's
  system fonts, which is the correct degradation but means a Brand Kit font picker (A3) must warn.

## Next

Phase 2 — auth, org, event. Magic link, bearer tokens, roles, audit log, event CRUD, app shell
and the language configuration. Blocked on nothing; the hosting decision blocks deployment only.

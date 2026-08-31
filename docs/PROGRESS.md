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

## Next

Phase 1 — tokens across three targets. The riskiest bet in the product: one token change must
visibly reach web, PDF and email, proven on a throwaway side-by-side page before anything else
is built.

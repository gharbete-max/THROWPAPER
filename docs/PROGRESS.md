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

## Phase 2 — Auth, organisation, event · done

**Shipped**

- Schema: `users`, `login_tokens`, `refresh_tokens`, `audit_log`, `events`
  (`0001_auth_and_events.sql`). Only token **hashes** are stored — a leaked database yields no
  working sessions.
- Magic link → `POST /v1/auth/token` → bearer + refresh. Access tokens are 15-minute HS256 JWTs;
  refresh tokens are opaque, hashed, and **rotate on every use**. Presenting an already-rotated
  token revokes the whole family.
- `POST /v1/auth/magic-link` answers identically for known and unknown addresses, and is
  rate-limited. There is a test asserting the two responses are byte-identical.
- Roles: **admin and operator only**. The role is read from the database on every request, not
  from the token, so a demotion takes effect immediately.
- Events: list, read, create, patch, and **archive — never delete** (rule 7). `registrationOpen`
  is computed from capacity and the closing date, never stored.
- Event text is per-locale JSONB from the start, with `missingLocales` on every response driving
  the completeness indicator.
- Every mutation writes an audit row through one `recordAudit()` helper.
- OpenAPI generated from the Zod schemas at `/openapi.json` (`SPEC-forms.md` §7).
- `apps/forms`: login, magic-link callback, authenticated shell with a **language dropdown driven
  by the org's supportedLocales**, events list and event editor with one field per locale.
- `packages/i18n` gained `pickText()`, `missingLocales()` and a translation catalogue, so no
  user-facing string is hard-coded (rule 4). `packages/shared` gained `api/`.

**The repository seam**

Handlers depend on `Repositories` interfaces, never on `db`. Rotation, reuse detection,
single-use links, role checks, audit writes and capacity rules are all tested against in-memory
fakes, so `pnpm verify` is meaningful without Docker. One database-backed smoke test covers the
migration and the Drizzle round trip; it **skips with a named reason** when no Postgres answers,
and always runs in CI.

Writing the fake surfaced a real defect: it mutated rows in place, so the audit log's `before`
snapshot aliased the `after`. Postgres would never have done that. The fake now copies on read and
replaces on update.

**Deferred, and why**

- SSO — `SPEC-shared.md` calls it optional and nothing in v0.1 needs it.
- Multi-tenancy. One organisation row; no switching UI.
- The other three roles and the permissions matrix — A14.
- Honeypot and CAPTCHA — they belong with the public form in phase 3.
- Deployment, still blocked on the hosting/email region decision.

**What CI caught that local runs could not**

The first CI run failed: `env.ts` requires `JWT_SECRET`, and a local `.env` was quietly supplying
it. Two real problems behind one symptom.

- `server.ts` imported `db/client.js` at module scope, which imports `env.ts`. So a test that
  injected its own repositories still had to satisfy the full production environment — the seam
  was leaking. The database module is now imported lazily, and only when no repositories were
  passed in.
- A migration or seed script has no business requiring a signing secret. `JWT_SECRET` is now
  optional in `env.ts`; `main.ts` refuses to start the server without it.

Verified by deleting the local `.env` and reproducing the failure before fixing it.

**Assumptions to check**

- Launch locales are `sv-SE` and `en-GB`, driven entirely by `organisations.supported_locales`.
- Refresh tokens live in `localStorage`, access tokens only in memory. A token in `localStorage`
  is readable by any script on the page, so the short-lived one never goes there.
- `JWT_SECRET` has **no default** — the server refuses to start without one of at least 32
  characters. `.env.example` carries a development value that must not reach production.
- Admin edits events; operators read them. If that split is wrong, it is one line in
  `routes/events.ts`.

## Next

Phase 3 — form builder and the public form (1.5–2 weeks, the longest phase). The small field set
from START-HERE, drag-and-drop, versioning, the public renderer with the language dropdown,
translations, validation, save-and-resume, and the submissions table with export.

If phase 3 runs past two weeks, START-HERE says the field set is too big — cut it.

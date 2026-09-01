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

## Phase 3a — Form definitions and the builder · done

Phase 3 lands as three merges rather than one 1.5–2 week branch, so a defect surfaces after days
rather than at the end.

**Shipped**

- `packages/shared/src/forms/` — the field union as a discriminated Zod union, pinned to a
  `schemaVersion`. Exactly the **thirteen** v0.1 types from START-HERE and no others.
- Helpers: `pagesOf()` (splits on page breaks, ready for 3b's multi-page renderer),
  `answerableFields()`, `duplicateKeys()`, `translatableTexts()`, `definitionCompleteness()`,
  `definitionProblems()`.
- Schema: `forms` (mutable head — slug, scheduling, autosaved draft) and `form_versions`
  (immutable published snapshots). `0002_forms.sql`.
- Routes: form CRUD, draft autosave, publish, version list, version restore.
- Builder in `apps/forms`: palette · canvas · properties, dnd-kit reordering with a **keyboard
  sensor** (drag-and-drop that needs a mouse is not an accessible way to build a form), autosave
  debounced to one request per typing burst, a translation tab covering every text property per
  locale, and version history with one-click restore.

**Decisions worth knowing**

- **A submission will reference the version it was filled against**, so editing a form can never
  retroactively change what somebody answered. There is a test asserting the published snapshot
  is unaffected by later draft edits.
- **Publishing is blocked on missing required translations unless explicitly overridden.** The
  override is recorded both on the version row and in the audit log, so "who shipped it
  half-translated" stays answerable. Labels and option labels are required; help text and
  placeholders are not.
- **Autosave is deliberately not audited.** It fires constantly and would bury the entries that
  matter. Publishing is the auditable act.
- `rich_text` stores plain text, not HTML — HTML here would be a stored-XSS surface on a public
  page.
- `forms.published_version` is denormalised from `form_versions`. Without it, listing forms costs
  a query per row just to render "v3".

**Deferred**

Everything in `SPEC-forms.md` §3 outside the thirteen types: matrix, rating, linear scale, file
upload, photo capture, signature, repeatable groups, lookups, computed fields, and conditional
logic. Adding a field type is a scope change, not a detail.

**Next**

3b — the public renderer, validation on both sides, save-and-resume, and capacity enforcement.

## Phase 3b — The public form · done

**Shipped**

- `packages/shared/src/forms/validate.ts` — **one validator, run on both sides**. The server is
  authoritative; the client copy only produces feedback before submit.
- Public endpoints, no bearer token: `GET /public/forms/:slug`, `POST /public/forms/:slug`,
  save-and-resume, and resume-by-token. Rate-limited, with a honeypot on submit.
- `submissions` table (`0003_submissions.sql`) with a partial unique index on
  `(form_id, email) where status = 'complete'`.
- Public renderer at `/f/:slug`, code-split so anonymous visitors never download the app shell.
  Multi-page via page breaks, per-field errors, hidden fields prefilled from the query string.
- Save-and-resume: opaque token, stored hashed. The link is shown with a copy button **and** sent
  through the `MailTransport` seam from phase 2 — console today, a real provider in phase 4.
- Seed now produces the demo form plus **200 registrations** with Nordic names, per START-HERE.

**Decisions worth knowing**

- **Validation issues are message keys plus parameters, never sentences.** A hard-coded English
  string would break rule 4 and reach a Swedish visitor untranslated.
- **The honeypot answers a bot as though it worked.** Telling it that it was detected only teaches
  whoever wrote it to try something else.
- **An unpublished form is a 404 to the public.** Whether a draft exists is not their business.
- **Answers for fields not in the definition are dropped, not stored.** A stray key is a stale
  client or someone probing; neither belongs in the export.
- **`rich_text` renders as text, never HTML.** Operator-authored content on an anonymous page.
- Capacity and duplicate control are checked **inside** the write, not before it.

**The concurrency test, and what it does and does not prove**

Two simultaneous submissions for the last place: exactly one wins. I verified the test is not
vacuous by deliberately inserting an `await` between the capacity check and the insert — it then
failed with `[201, 201]`, two people admitted to one place — and removing it again.

That proves the **handler** has no check-then-act gap. The database-level guarantee is the
transaction and `select … for update` in the Drizzle repository, and **only CI exercises that**,
because Docker is still not installed here.

**Deferred**

Conditional logic and page branching, tokenised per-recipient links, per-token duplicate control,
CAPTCHA (the honeypot and rate limits are in; CAPTCHA is A14).

**Next**

3c is done — see below.

## Phase 3c — Submissions table and export · done

Third and last merge of phase 3. **Phase 3 is complete.**

**Shipped**

- `GET /v1/forms/:id/submissions` — the answers plus the published definition needed to label
  them, and the version each was filled against.
- `packages/shared/src/forms/export.ts` — `toCsv()` and `toSheetRows()`, unit-tested without a
  browser.
- Submissions table with TanStack Table: client-side sort, global filter, column chooser. **Not**
  the grid from `SPEC-shared.md` — START-HERE says use a library and defer the real one to A4, and
  v0.1 is ~200 rows.
- CSV and XLSX export, from the rows the table is currently showing.

**The acceptance criterion**

START-HERE's Done-means list includes "The CSV opens in Excel with Swedish characters intact". On
Windows, Excel reads a CSV as the system code page unless the file starts with a **UTF-8 BOM**, so
`Öberg` arrives as `Ã–berg`. The BOM is emitted and there is a test asserting `charCodeAt(0)` is
`0xFEFF`. The separator defaults to `;`, which is the list separator Excel expects in Sweden, and
is configurable.

**Formula injection**

A public form takes text from anyone, and a cell beginning `=`, `+`, `-` or `@` is **executed**
when the operator opens the file. Those cells are prefixed with a tab, which neutralises them
without changing the visible text. Tested for all four leading characters. This was not in the
plan; it is a real hole that opens the moment untrusted text reaches a spreadsheet.

**Export parity, made structural**

Exports run from the table's current sorted, filtered, visible-column state rather than re-querying
the server. Parity is then true by construction instead of by a second implementation agreeing
with the first.

**Deferred**

Server-side sort, filter and pagination; saved views; grouping and subtotals; PDF export. All A4.

## Phase 4a — Admission PDF, signed QR, bulk generation · done

First of two merges for phase 4. Needs no email provider.

**Shipped**

- `documents/qr-token.ts` — `<reference>.<signature>`, HMAC-SHA256 truncated to 16 characters.
  Short on purpose: a dense QR fails to scan on a cheap phone in bad light at a door. The key is
  derived from `JWT_SECRET` via HKDF, so there is no second secret to manage but a leaked QR key
  cannot mint access tokens. **Verification is offline** — no database round trip — which is what
  makes phase 5's check-in work on a flaky venue network.
- `documents/admission.ts` — the branded card, rendered in the **attendee's** locale from
  `submissions.locale`, on `@tp/tokens/pdf` from phase 1. QR embedded as inline SVG so it stays
  vector at print size.
- `documents/render.ts` — Playwright Chromium, browser reused across a bulk run rather than
  relaunched 200 times.
- `jobs/worker.ts` and the `jobs` table (`0004_jobs.sql`) — durable queue with attempts, backoff
  and an idempotency key (`SPEC-forms.md` §7). A table plus a polling worker, not pg-boss.
- `documents/store.ts` — `DocumentStore` with a local implementation and expiring signed links.
- Routes: single PDF, bulk enqueue, job status, signed download.

**Decisions worth knowing**

- **A failing document does not lose the run.** It is recorded and the bulk job continues. A job
  that aborts at row 137 of 200 is worse than useless to an operator with an event tomorrow.
- **The download route is deliberately not behind the bearer guard** — a browser following a link
  cannot attach an Authorization header. The signature and expiry are the access control, because
  a ZIP of 200 registrations is personal data and an unguessable URL is not protection.
- **Bulk is keyed on form + published version**, so asking twice returns the running job rather
  than starting a second Chromium marathon.
- An unknown job kind fails permanently rather than retrying: a deployment mistake is not a
  transient fault.

**Deployment consequence**

Playwright moved from a root devDependency to a real dependency of `apps/api-forms`. **The deploy
image now needs Chromium** — roughly 400MB plus a memory floor. This is the first phase to change
what the deployment must contain.

**Stopgap, named**

`SPEC-forms.md` §7 wants S3-compatible storage with signed URLs and virus scanning. No object store
is chosen yet, so generated ZIPs go to a local directory behind `DocumentStore`. The S3
implementation is the obvious next one and nothing above that interface changes for it.

**Next**

4b is done — see below.

## Phase 4b — SES, domain verification, real email · done

**Phase 4 is complete.**

**Shipped**

- `mail/provider.ts` — `MailTransport` widened into **`MailProvider`**: `from`, `html`,
  `attachments`, a returned `messageId`. One mail seam, not two; `auth/mail.ts` re-exports it so
  the magic link and resume link callers are unchanged.
- `mail/ses.ts` — Amazon SES `eu-north-1` (Stockholm). SES has no attachment field in the simple
  API, so anything with a PDF is assembled as raw MIME: `multipart/mixed` around a
  `multipart/alternative`, RFC 2047 encoded subject, base64 wrapped at 76 characters.
- `mail/domain-verification.ts` — live SPF, DKIM and DMARC checks over `node:dns/promises`, each
  returning what was found and **what to paste into DNS**.
- `mail/send-job.ts` — sending runs as a **job, never from a request handler**
  (`SPEC-mailer.md` §8), keyed so a retry cannot double-send.
- `email/templates.tsx` — confirmation and operator notification on **`toEmailStyles()`**, phase
  1's email compiler used for real for the first time. The React Email components moved out of
  `scripts/proof/` as 3a said they would.
- `sending_domains` and `messages` tables (`0005_sending_domains.sql`). The message log is
  `SPEC-mailer.md` §5's "per-recipient log of exactly what was rendered and sent", and what B11's
  bounce webhooks will attach to.

**The rule with no override**

`SPEC-mailer.md` §6: "Refuse to send from an unverified domain — no override." `assertSendable`
takes no `force` parameter, and there is a test asserting its arity so nobody adds one absent-
mindedly. All three records must pass — a domain with SPF alone is exactly the setup that lands in
spam. Console and memory providers are exempt, because there is no domain reputation to burn in
development.

**Two corrections to things that had become false**

- `messages.send` was deferred to "phase 4". Phase 4 built the sending path **inside Formwork**,
  so it is now B6. 
- `delivery.webhook` was deferred to "phase 4" too; it waits for Sendwork's bounce handling in
  B11.

Left alone, `pnpm contract:check` would have cheerfully printed both lies on every run.

**Deferred**

Bounce and complaint handling beyond recording the message (B11), suppression lists, campaigns,
warm-up, and the `POST /v1/messages` contract endpoint.

**What is still unproven**

Every email test uses the memory provider. **No message has been sent through SES**, because that
needs AWS credentials and a verified domain. START-HERE's phase 4 checkpoint — does mail reliably
land in real inboxes — is therefore **not met yet**, and cannot be until:

1. SES **production access** is granted (a request to AWS; a new account only delivers to verified
   addresses until then), and
2. a real sending domain has SPF, DKIM and DMARC published.

The code refuses to send until step 2 is true, which is the correct behaviour and also means the
checkpoint fails closed rather than silently.

## Phase 5 — Check-in · done

**v0.1 is code-complete.** The loop closes: a form is filled in → a record exists → a branded PDF
comes out → an email is queued → somebody is checked in at the door.

**Shipped**

- `check_ins` table (`0006_check_ins.sql`) with a **unique index on `submission_id`**. One row per
  attendee, enforced by the database rather than by a handler remembering to look first.
- `submissions.revoked_at` — START-HERE says the door must reject "duplicates **and revoked
  entries**". Revoking is not deleting: the record and its audit trail stay, and the person is
  refused *with a reason*.
- `POST /v1/events/:id/check-ins` — accepts a scanned token or a typed reference and always
  answers 200 with a decision: `admitted`, `already`, `revoked`, `wrong-event`, `not-found`,
  `bad-signature`.
- `GET /v1/events/:id/attendance` and `POST /v1/submissions/:id/revoke`.
- Check-in screen with `@zxing/browser` (code-split), a always-present reference field, and a
  deliberately enormous verdict — readable at arm's length in bad light with a queue waiting.
- Attendance report: counts, attendee list, no-show filter, CSV through 3c's writer so the BOM and
  the formula guard come along unchanged.

**Idempotent, and tested for it**

`already` is a normal 200 carrying the original timestamp, not an error. A scanner that retries
after a dropped response must not turn one attendee into a failure in front of a queue — that is
what START-HERE means by "idempotent, because that is what makes an offline mobile scanner cheap".

The concurrency test was checked for vacuity the same way 3b's was: inserting an `await` between
the lookup and the insert makes it fail with `['admitted', 'admitted']` — one card admitting twice
— and removing it makes it pass.

**Decisions worth knowing**

- Token verification runs **before any query**, so a forged card costs nothing to refuse.
- A correctly-signed card for a different event returns `wrong-event`, not `bad-signature` — the
  difference matters to whoever is standing there.
- Revoking after arrival does not erase the arrival. That happened.
- A revoked registration is **not** a no-show: nobody was expecting them.
- Operators can work the door; only admins can revoke.

**Deferred**

Offline queueing in the browser (the endpoint is idempotent, which is what makes that cheap
later), session selection, waiting lists, badge printing, and the report builder (A9).

## Next

**v0.1 is code-complete.** Phases 0–5 are merged and `main` is green. The loop closes: a form is
filled in → a record exists → a branded PDF comes out → an email is queued → somebody is checked
in at the door.

### What is not done, and none of it is code

From `START-HERE.md` §Done means, in the order these block each other:

1. **Deploy it.** Phase 0 said "deployed to the real hosting target... day one, not at the end".
   That never happened, and it now blocks everything below. The image needs **Chromium** (phase 4a
   made Playwright a runtime dependency), and the hosting region still has to be picked.
2. **SES production access.** A new account only delivers to verified addresses. Until AWS grants
   it, the phase 4 checkpoint — "does email reliably land in real inboxes" — cannot be tested at
   all. It is a request with a turnaround, so it is worth starting before it is needed.
3. **HTTPS**, or the check-in camera will not open on a phone. `localhost` is exempt; a phone on
   your network is not.
4. **A real user runs a real event.** START-HERE: "the only criterion that matters."

### Outstanding in the code

- **No end-to-end suite.** `pnpm test:e2e` has been a passing no-op since phase 0, and the message
  claiming it arrives "in phase 3" was still there after phase 5 shipped. A real suite needs a
  running stack — Postgres plus both apps — which CI has and this machine does not. The honest
  version: it should drive the public form in a browser against a live server, and it does not
  exist yet.
- **The local `DocumentStore` is a stopgap.** `SPEC-forms.md` §7 wants S3-compatible storage with
  signed URLs and virus scanning; generated ZIPs currently go to a directory on disk.
- **Nobody has run this stack end to end.** Every database path is proven by CI and unit tests,
  never by a person clicking through it. That is the single largest gap between "tests pass" and
  "it works", and phase 5 of START-HERE anticipates it: *run a real event and fix what breaks.*

### After that

`docs/ROADMAP.md` describes Track A phases A2–A14 and the whole of Track B. **Do not start them
from the roadmap.** START-HERE is explicit that the specs are seductive and that v0.2 scope comes
from watching the first real user work around the tool:

> Ask the user what they actually did outside the tool — spreadsheet exports, manual chasing,
> things they worked around. That list, not this document, is your v0.2 scope.

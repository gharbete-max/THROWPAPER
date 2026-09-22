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
3. One builder or two? (if one: build sequentially, Mailer stays a scaffold)
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
  when Mailer's block editor (B4) needs them — `packages/tokens` stays framework-free.
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

- `messages.send` was deferred to "phase 4". Phase 4 built the sending path **inside Forms**,
  so it is now B6. 
- `delivery.webhook` was deferred to "phase 4" too; it waits for Mailer's bounce handling in
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

## Deployable — one image, two modes · done

The first thing phase 0 was supposed to do and the last thing actually done. `docs/DEPLOY.md` is
the operator's copy; this is what changed and why.

**Shipped**

- `Dockerfile` — multi-stage, on `mcr.microsoft.com/playwright:...-noble`. The browser is a
  **runtime** dependency since 4a, so a slim Node base would produce an image that boots happily
  and fails the first time somebody asks for a PDF. Runs as `pwuser`, not root.
- `SERVE_APP` — the API serves the built app as well, so one container is the whole product. A
  `setNotFoundHandler` falls back to the app shell for client routes and leaves `/v1/`,
  `/public/`, `/demo/`, `/health`, `/openapi.json` and every non-GET answering as an API.
- `DEMO=true` selects the in-memory build from the same image, so the demo and the real thing
  cannot drift apart into two artefacts.
- `docs/DEPLOY.md` — host requirements, the environment table, and the ordered list of things
  that must happen before a real event.

**Proven by building it, because nobody here has Docker**

CI builds the image and then runs it: `/health` must report `"mode":"demo"`, and both `/` and
`/f/varmotet` must return the app shell. A Dockerfile that is never built is a guess, and the one
machine this repo is developed on has no Docker, no Postgres and no psql.

**The boundary is tested, not assumed**

`serve-app.test.ts` pins the fallback rules — the failure it exists to prevent is invisible in
development, where Vite serves the app on its own port and this code path never runs. It surfaces
in production as a form link returning JSON to somebody who was sent it.

**What opening the page found, and the code review did not**

Three defects, none of which any existing test could have caught:

1. **The container served a dead app.** The bundle calls `/api/v1/...` because in development Vite
   proxies that here and strips the prefix. There is no proxy in a container, so every request came
   back as the app shell and the form reported that it did not exist. The server now strips `/api`
   itself — the same rule as the proxy, in one more place. A page that renders and then fails
   everything is worse than one that will not start, because it looks like it works.
2. **`node dist/main.js` had never worked.** The `start` script has been in `package.json` since
   phase 0, but tsup left the `@tp/*` packages external and those publish TypeScript source, so it
   could only ever have run under tsx. They are bundled now, and the container runs `node`, with no
   pnpm or corepack in the runtime path.
3. **The first smoke test threw away its own evidence.** The container exited about four seconds in
   and the step reported a column of refused connections and nothing else, because `bash -e` exited
   before reaching `docker logs`. It now traps and prints the logs whatever happens, and fails
   early with a clear message when the container is gone.

   That change immediately paid for itself. The next run printed the real reason, which was neither
   of the causes worth guessing at: demo mode was **refusing to start**, exactly as designed,
   because the image is `NODE_ENV=production` and a demo has to be asked for twice. The guard was
   right and the callers were wrong — including the demo command in `docs/DEPLOY.md`, which would
   have failed the same way the first time anybody ran it.

The suite now covers the `/api` prefix, and removing the rewrite fails it.

**Verified by hand, in container shape**

Served the built app from the built API and registered *Åsa Öqvist* through the public form in
Swedish — two pages, a select, a number field — and got reference `80HR-7496` back. That is the
first time the product has been driven end to end in the shape it will actually ship in.

The demo banner also follows the public form's language switcher now, rather than the signed-in
session's locale. It was announcing "Demo mode" in Swedish over an English form, on the one page
members of the public ever see.

**Still not deployed.** An image is not a deployment. The host, the region and the domain are
decisions, and they are the user's.


## A15a and A3a — the form looks like the customer · done

Two phases driven by the owner's description of the product: a form and email site with heavy
customisation and prebuilt templates, of which the AGM work is one segment.

### A15a — choice appearance

There were no radio buttons at all. `single_select` was always a dropdown, `multi_select` always
checkboxes, `yes_no` always a dropdown, and appearance was not something an author could set.

Now each has its own vocabulary — dropdown/radio/buttons/cards, checkboxes/buttons/cards,
dropdown/radio/buttons — enforced by the schema, so `cards` on a yes/no question is refused rather
than ignored. Presentation only: the stored value, the CSV column and every existing submission are
untouched, and old definitions are defaulted rather than required, which is why `schemaVersion`
stays at 1.

Every variant is a `fieldset` with a `legend` and real inputs. Buttons and cards are restyled
radios, never divs with click handlers. The first attempt hid the input with `opacity: 0` — the
version that mostly works and that some tools treat as hidden; it uses the clip technique instead.

### A3a — the Brand Kit

There was no brand kit at all: no table, no endpoint, no editor, and `default-tokens.json` compiled
in at build time. Every organisation would have had identical colours.

- `brand_kits`, one row per organisation, the token set as a JSON document. **No row means the
  shipped defaults**, so nothing needed backfilling and an organisation that never chooses is not
  frozen on whatever the product looked like the day it signed up.
- `GET`/`PUT`/`DELETE /v1/brand-kit`. Admins write, operators read, and reset deletes the row
  rather than storing a copy of the defaults.
- Applied to the app, the public form, the admission PDF and both emails. Those last three already
  took tokens as a parameter and were simply being handed the defaults.
- The public form response carries the brand, so an anonymous visitor gets a branded page in one
  request with no flash of the wrong palette.

**Contrast is advisory, and that is a decision.** Colours are checked as you type, because a
warning that arrives after you commit is a reprimand rather than help. But an unreadable choice is
never refused: declining to store somebody's brand would be the tool overruling the customer about
their own colours. Saying nothing would be negligent; refusing would be obnoxious.

Writing the checker turned up two genuine defects in the shipped palette. `warning` sat at 4.44:1
where 4.5 is required — fixed. The border sits at 1.36:1 where a boundary wants 3, and is left
alone deliberately: reaching 3 needs a heavy grey around every input, and the visual direction is
flat and quiet. A test pins that one advisory so it stays a decision rather than becoming an
oversight.

**Validation is about the output formats, not fussiness.** Colours are hex only — `red`,
`rgb(...)` and `var(--x)` are refused — and font stacks may not contain quotes. These strings are
interpolated into an inline `style` attribute in email and into print CSS, where an unescaped
quote ends the attribute early.

The demo organisation carries the owner's palette (Deep Midnight, Saddle Brown, Cognac, Parchment,
Brushed Gold; flat, small radius, no shadow). The shipped defaults stay neutral, because they are
what a *new customer* starts from. Making the palette the product default instead is a one-file
change if that is wanted.

**Verified by using it**: the public form renders in the palette, the editor's two columns work,
and typing an unreadable text colour immediately raises two warnings, enables Save, and turns the
preview unreadable — while the editor around it stays legible, which is why the preview is scoped
rather than applied to the page.


## A3b — image upload and the logo · done

The dependency both image fields and a useful template gallery were waiting on.

**Content-addressed, because a logo is public.** Generated documents get a signed URL that expires,
because a bulk export of 200 registrations is personal data. A logo is painted on a public form
that anybody can open, so an expiring URL would break the page for the people it is for while
protecting nothing. These are keyed by the SHA-256 of their own bytes instead: the URL never
changes so it can be cached forever, the same file uploaded twice costs one copy, and the key
cannot encode anything the uploader chose.

**The format is read out of the bytes.** The filename and the declared content type are both
written by whoever is uploading, so neither is evidence. A file called `logo.png`, announced as
`image/png`, containing `<script>`, is a stored cross-site scripting attack the moment it is
served from the app's own origin — so PNG, JPEG, WebP and GIF are identified by their magic
numbers, and the type the file is *served* with comes from that reading. Responses carry
`nosniff` and a `default-src 'none'; sandbox` policy so a browser cannot second-guess it either.

**SVG is refused, separately and on purpose.** An SVG is a document: it carries script, event
handlers and external references, and sanitising it properly is a project in itself. It gets its
own error code so the message can say *why* and name a way forward, rather than leaving somebody
to conclude the upload is broken.

**A logo may only be a path into this asset store.** Not an arbitrary URL. A brand kit is written
by a customer and ends up in `src` attributes on a public page and in email; accepting any URL
would let one organisation point every form it publishes at a third-party host, leaking every
visitor's IP address to it and handing whoever controls it the ability to change what the form
appears to say.

**Verified against a running server**, not only in tests: a real PNG uploaded and served with the
right headers; HTML named `logo.png` and declared `image/png` refused; an SVG refused with its
own message; an external URL refused as a logo; and the uploaded mark rendered on the public form
in place of the organisation name.

Two things found while building it. The client sets `content-type: application/json` on every
request, which silently breaks a multipart body — the browser has to set that header itself
because only it knows the boundary. And the first version of the upload test read the boundary
from one `Response` and the body from another; each generates its own, so the server got a body
it could not parse.


## A15b — images inside a form · done

Two things, both of which the owner named: pictures in a form, and choices that are pictures.

- An `image` field. Presentational, so it collects nothing — added to `PRESENTATIONAL_TYPES`,
  which means validation, CSV export and submissions all exclude it from **one** place rather than
  three that could disagree.
- An optional picture on every choice option, shown by the `cards` and `buttons` appearances from
  A15a and ignored by a dropdown, which has nowhere to put one.

**Sources are asset paths, never URLs** — the same rule as a logo, and for the same reason: a form
definition is written by a customer and rendered on a public page, so an arbitrary URL would leak
every visitor's IP address to a third-party host and let whoever runs it change what the form
appears to show. Extracted as `AssetPath` in `packages/shared` so the brand kit and form
definitions cannot drift apart on it.

**Two accessibility decisions worth naming.** Alt text on an image field is translatable but
**not required**: an empty alt means "decorative, skip this", which is right for a banner, and
requiring it would push people to type something rather than nothing — a screen reader announcing
"image" repeatedly is worse than silence. And an option's picture is rendered with `alt=""`
because the label beside it already names the choice; reading both would say everything twice.
The label stays required even when there is a picture, because the answer that lands in the CSV is
the label, and an image-only choice cannot be read aloud, searched or exported.

The `ImagePicker` is shared by the brand editor and the builder, so "pick a picture" does not
behave differently depending on the screen. It surfaces the server's own message verbatim: "SVG is
not supported, upload a PNG instead" tells somebody what to do next, "upload failed" does not.

**Verified by using it**: a banner uploaded and placed at the top of the demo form respecting its
`maxWidth`, three real PNGs put on the meal options as cards, one chosen by clicking the card, and
the registration submitted — reference `KQNR-2NZ9`, with `veg` stored, not the image path.


## A16 — the template gallery · done

Six prebuilt forms, chosen when a form is created.

**Copied, never referenced.** The template is deep-copied into the draft. If a form kept a
reference, improving a template later would silently rewrite forms that people are already filling
in — and in the same process, the first author to edit theirs would mutate the shipped catalogue
for everybody who picked it afterwards. A test asserts that editing a form leaves the template
untouched.

**Code, not database rows.** A template ships with the product and has to stay valid as the field
schema moves. A seeded table would drift the moment a field type gained a required property, and
nothing would notice until an author picked that template; `templates.test.ts` parses every one
against `FormDefinition`, so the build finds out instead. Another test creates a form from every
template and publishes it with no edits — a template that needs fixing before it can be published
is not a template, it is homework.

**What is deliberately not here, and why.** `CLAUDE.md` rule 8 and `SPEC-forms.md` §8: no legal,
clinical, tax or safety-critical wording. That rules out most of what a template gallery reaches
for first — incident and accident reports, medical intake, consent and waiver forms, tax
declarations, employment contracts. Those need a human who is accountable for the words, and a
plausible-looking one written here would be worse than none: somebody would send it out.

What ships is the operational middle — event registration, contact enquiry, customer feedback,
course sign-up, booking request, member details — and the gallery says on screen that legal,
medical and tax forms are absent on purpose. A word-list test fails the build if a new template
reaches for those categories. It cannot prove absence and does not pretend to; what it does is
make the boundary a decision rather than something that erodes one well-meaning template at a
time. **It caught its own author**: a description reading "no fees or terms" tripped it, and the
right fix was to reword rather than to soften the check.

**Every template is bilingual**, and a test proves it. A half-translated template is worse than an
English-only one, because the author cannot tell which strings are theirs to finish.

**Verified by using it**: picked Customer feedback from the gallery, which prefilled the title,
created the form, published it untouched, and got a working feedback form — a 1–5 rating as a
button strip, two free-text boxes, a Yes/No radio pair and a conditional email field, in the
organisation's palette. Three clicks from "New form" to something publishable.


## Builder usability · done

The owner said the form builder was not working well. It was not, and using it for five minutes
showed why. This is what was wrong and what changed.

**You could not write the question without changing tabs.** The properties panel led with `Key` —
a machine name like `full_name` — and the label, the actual question text, lived only on the
translation tab. So the first thing an author saw was a database field, and the thing they came to
write was hidden. The label is now first, in the language being worked in, and the key is folded
into an *Advanced* disclosure at the bottom. The translation tab still carries every locale, which
is what it is for.

**There was no way to see what you were building.** You laid out abstract rows and found out what
they looked like by publishing. There is now a preview, and it renders the **same `FieldInput`
component the public page does** — lifted out of `PublicForm` for the purpose. A preview with its
own renderer is worse than none, because it drifts and then nobody trusts it. It is interactive, it
follows the selected field onto its own page, and it says plainly that nothing is saved.

**The palette buried the form.** Fourteen equally-weighted full-width buttons in a column, ~900px
tall on a narrow screen — you scrolled past every field type before reaching your own form. Now
three labelled groups of wrapping chips. A test asserts every field type appears in exactly one
group, so adding a type forces a decision rather than silently dropping it from the palette.

**A new field always landed at the end.** Adding a question in the middle of a long form meant
scrolling to the bottom and dragging it back. New fields now land directly after the selected one,
and the palette says so.

**Reordering was drag-only.** Fine with a mouse, awkward on the phone half of this will be used
on. Every row now has up and down buttons.

**Rows disguised unfinished work.** A field with no label showed its machine key, which looks like
a name. It now says *Needs a question*, and required fields are marked, so the list can be scanned
for what is unfinished instead of finding out at publish time.

### Two defects found on the way

- **`fieldType.image` had no translation**, so the palette had been showing the literal string
  `fieldType.image` to anybody building a form since A15b shipped. Nothing catches a missing
  key — the app compiles and the tests pass; it only appears on a screen somebody opens. There is
  now a test driven by `FIELD_TYPES` itself, so a new field type without a label fails the build.
  Mutation-checked by renaming the key: it fails.
- **Every form in the list said "Edit event"**, including a feedback form, because the forms screen
  borrowed the events string.


## Builder fixes: remove, defaults, sorting, pages · done

Reported: removing parts of a form did not work, sv-SE warnings for no reason, sorting and layout,
and pages that end in a completion step.

### Remove did not work, and neither did three other things

`window.confirm` **returns `false` without showing anything** in an embedded browser — a desktop
app's webview, an in-app browser, anything that suppresses native dialogs. So the guarded action
silently did nothing.

It was not only Remove. The same call was quietly disabling **archiving an event**, **restoring a
version** and **overriding an incomplete publish**. Four features that looked like ordinary
buttons and did nothing at all, and nothing in the codebase could have told us: the app compiles,
the tests pass, and the failure only exists in the browser the customer happens to use.

`CLAUDE.md` rule 7 requires a confirmation step. It does not require a native dialog, and a native
dialog turns out to be the one implementation that cannot be relied on. There is now a real
`<dialog>` in the product's own styling, Escape cancels, focus starts on the safe option. Removing
a field confirms **in place** instead — it is frequent and small, and a modal each time would be
exhausting — but still takes two deliberate clicks on two different buttons.

A test bans `window.confirm`, `alert` and `prompt` from the app source and names the offending
file. Mutation-checked.

### Warnings for doing the normal thing

A new field arrived with `label: {}` — immediately missing in every locale. Add three fields and
the header read "sv-SE: 3 missing · en-GB: 3 missing" before anybody had done anything wrong.
Warnings that fire for normal use are warnings people learn to ignore, which makes the real ones
useless too.

New fields, sections, text blocks and choice options now arrive with a default in **every language
the organisation publishes** — "New question", "Option 1" — read straight from the message
catalogue. The form stays publishable, the completeness indicator stays meaningful, and the
placeholder says what is left to do.

### The machine name kept coming first

Fixed for field labels last time; the same fault was still in the **options** editor, which showed
`option.value` while the wording people read lived on the translation tab. Option text is now
first, in the language being viewed, with the value folded into a disclosure — and options can be
removed, which they could not be before.

Also: the inline label and help text now edit **the language being viewed**, not the
organisation's default. Writing to the default meant an author working in English typed English
into the Swedish slot and watched their text vanish behind a fallback.

### Pages

Back and Save on the left, forward on the right, the way every multi-step form works — the actions
used to sit in one left-aligned row where "Next" fell between "Back" and "Save". The last page's
action is the submit and says so, defaulting to **Complete**.

**Not "Sign".** A signature carrying legal weight is a regulated feature this product does not
have (`SPEC-forms.md` §8), and a button reading "Sign" would be claiming one. An author who wants
different wording sets `submitLabel`, which every template already does.

A duplicate "Page 1 of 2" introduced while moving the actions was caught by looking at the page.


## Builder: live preview, inline editing, optional translation · done

Three changes, all asked for, all the same idea — put the thing you are editing next to the thing
it affects, and stop presenting optional work as required.

**The preview is the right-hand side of the screen, always on.** It was a tab you switched to,
which meant the answer to "what does this look like?" cost a click — and an answer that costs a
click is one people stop asking for. It is sticky, so it stays in view while the field list
scrolls past it, and it still renders the same `FieldInput` the public page does.

**The field editor opens inside the field's own row.** It was a panel elsewhere on the page: on a
narrow screen it sat below the entire list, so editing the second of twenty questions meant
scrolling past the other eighteen to reach its settings. Selecting a row now expands it in place
and selecting it again closes it.

**Translation is a plus, not a tab.** Every locale of every string used to live on a parallel
"Translation" tab, which made translation feel compulsory: a second language existed for the
organisation, so every field was incomplete until somebody filled it in, whether or not they ever
meant to publish in it. Each text now shows one box for the language being worked in, with a
`+ sv-SE` beside it. Languages that already have text stay visible — the plus is for adding a
language, not for finding one.

Two consequences worth stating:

- **New fields seed one locale, not all of them.** The previous fix filled every supported locale
  with the same placeholder, which silenced the warning and created a worse problem: an
  untranslated English form would have shown a real respondent the words "New question". A missing
  locale falls back when rendered, which is what makes leaving it alone a real choice.
- **A language is only reported incomplete once somebody has started writing in it.** A locale
  with no text anywhere is one nobody asked for. This is the same decision as the plus, read back.

**Verified by using it**: the editor opens inside the selected row and leads with the question
text in the language being viewed; the preview sits to the right and stays there; a new field
offers `+ sv-SE` and reveals a second box when pressed; and a form written only in one language
reports nothing missing.


## Builder: duplicate a field, and a phone that fits · done

Found by looking rather than by being told — the builder had been rebuilt three times in a row
without anybody opening it on a phone.

**Two mobile defects, both introduced by the rebuild.** At 375px the field row measured 389px and
pushed the whole page sideways, and the up/down buttons came out **16×22px** — a third of the 44px
target every other control in this product meets, on the device where reordering by drag is
hardest. On a narrow screen the label now takes the full width and the actions wrap beneath it,
where there is room for them to be a real size. Zero overflow, nothing under 44px.

**Duplicate a field.** Long forms repeat themselves — five questions with the same five options, a
block of contact details asked once per guest — and rebuilding each by hand is where a builder
starts to feel like data entry. The copy lands directly below the original with a new id and a new
key, because two fields sharing a key silently merge their answers into one column and nobody
finds that until the export.

`uniqueKey` was generalised to do it, and pinned by tests: a copy of `email_2` is `email_3`, not
`email_2_2`. (Its old body contained `type.replace(/_/g, '_')`, which had never done anything.)

**Dead code from the last three rounds** removed: the two tab-row styles and the logo preview
style left behind when those components were replaced, and four message keys nothing referenced.


## Touch targets belong to controls, not wrappers · done

The public form was audited on a phone the way the builder had just been. It came out well — no
horizontal overflow, every input at 16px so iOS does not zoom on focus — with one exception, and
the exception was interesting.

**The language switcher measured 67×20px.** It is the first thing a Swedish speaker reaches for on
a page that opened in English, and it was less than half a tappable target.

The cause was the rule, not the control. The 44px minimum was written as `.field input`,
`.field select`, `.field textarea` — so it only protected controls somebody had remembered to wrap
in a `.field`. The language switcher is a bare `select` in a header. A rule that only protects the
controls you remembered is not a rule, so it is now written against `button`, `input`, `select`,
`textarea` and `summary` themselves, with checkboxes and radios exempted (they size themselves;
their labels carry the target) and bare selects given the same padding as wrapped ones.

That immediately found a second one: the column manager on the submissions grid, a `<summary>` at
21px. Nobody had reported either.

Verified after: on the public form and in the builder at 375px, **zero controls below 44px and zero
horizontal overflow**, and the desktop builder unchanged — the compact up/down buttons keep their
22px there, where a mouse is doing the pointing.


## Icons and button styling · done

Asked for: icons, stylised buttons, real arrows, everything following the theme, and no gradients.

**Icons are inline SVG using `currentColor`.** That last part is the whole design. An icon takes
the colour of the text beside it, so it is themed by the Brand Kit for free and `CLAUDE.md` rule 4
— no hard-coded colours — holds structurally rather than by anybody remembering. Change the brand
and every icon follows. No icon font (a network request, and a missing glyph until it arrives) and
no images (they cannot change colour).

Stroked at a uniform weight, sized in `em` so an icon matches whatever text it sits beside, and
`aria-hidden` because every icon here sits next to its own label — announcing both would make a
screen reader say everything twice. An icon-only control names itself with `aria-label`.

**A test proves every field type has an icon**, driven by `FIELD_TYPES`, so adding a type forces
the decision instead of leaving a blank chip somebody finds on screen. Same guard as the message
catalogue, for the same reason.

**Buttons are flat and token-driven.** No gradients — the stated direction is quiet, and a gradient
is also the one treatment that cannot follow a customer's palette without being recomputed. Since
darkening cannot be derived from a token, hover swaps the frame rather than mixing a colour the
customer never chose. Focus rings are the secondary colour, on every control rather than only
buttons.

The literal `→`, `↑` and `⠿` characters are gone, replaced by real arrows and a grip that scale
and colour with everything else.

**Two things the icons themselves forced:**

- Adding icons widened the field rows until *Remove* wrapped to a second line. Duplicate is now
  icon-only and Remove keeps its word — a copy is safe and repeatable and its icon reads
  universally, while a delete should say what it is rather than ask somebody to recognise a glyph
  before destroying something.
- That compaction then dropped Duplicate to 40px on a phone. It is 44px there again; the narrow
  version is a mouse affordance only.

**One knowingly left:** the sort buttons in the submissions grid are 34–42px wide because a column
header can only be as wide as its column. They are 44px tall and fill their column, and forcing
the width would break the table. Recorded rather than quietly ignored.


## Total customization: sliders, type, logo colour, link fields · done

**Everything is a slider now.** Corner radius, border thickness, spacing, button and field height,
form width, text size, line height, heading scale — each with a live preview beside it. A number
box asks somebody to guess what 6 looks like; a slider next to the thing it changes lets them find
the answer by moving it.

Two new tokens carry the sizing: `controlHeight` and `contentWidth`. Both defaulted in the schema,
so a brand kit stored before they existed still parses.

**The 44px floor survives customisation, but only where it matters.** An author who wants a dense
desktop form gets one — 32px controls are ordinary with a mouse. Under `@media (pointer: coarse)`
the floor comes back: a control too small to hit reliably is broken however deliberately it was
chosen, and the person filling in the form did not choose it.

**Typography**: font family from a list of stacks that are already on the machine — no web fonts,
because a downloaded typeface means a request before the form can be read, a flash of unstyled
text, and a third party told about every visitor. Plus size, line height, heading scale, and
bold / italic / underline for question labels as three toggle buttons.

**A logo now sets the button colour.** Uploading one reads the colour it is mostly made of and
offers it as the primary, replacing the shipped blue.

The naive version of this is wrong in two ways, and both are handled: "most frequent pixel" picks
the *background* — a logo on white is mostly white — so transparent, near-grey and near-black or
near-white pixels are discarded; and anti-aliasing splits one colour across dozens of
near-identical values, so the rest are bucketed coarsely and the winner averaged over its real
members. Verified against the demo logo: Deep Midnight at 95% share, correctly ignoring the gold
bar and the transparent ground.

It is **offered, not applied**. Reading a colour out of an image is a good guess and still a guess;
silently repainting somebody's product the moment they upload a file is the kind of helpfulness
that feels like a bug.

**A `link` field.** The author gives a URL and a label, and somebody filling in the form can open
it — terms, a price list, directions — without losing what they have typed. It opens in a new tab
for exactly that reason, with `rel="noopener"` so the opened page cannot navigate the form away.
`http` and `https` only: an author-supplied `javascript:` href on a public page is script execution
against every visitor, and there is a test for each scheme.

### Asked for and not done yet

**Per-field size overrides.** The sizing here is global — every button and field takes the same
height. Setting them individually needs a per-field style object on the definition and is the
larger half of the job.

**Bold, italic and underline inside a text block.** Currently theme-level, applying to question
labels. Doing it per span means a rich-text representation and an editor for it.


## Per-field width, rich text, and a resizable builder · done

The two things the last round left out, plus the layout work that makes them usable.

**Per-field width.** A field can take a full row, a half or a third, so first name and surname sit
side by side instead of stacked down a column. Named fractions rather than pixels: a pixel width is
a promise the layout cannot keep on a phone, and the author would be the last to find out. Every
width collapses to full below 600px — two columns on a phone is two cramped columns, not a layout.

The demo form now puts name and email on one row, which is what a real registration looks like.

**Bold, italic and underline inside a text block**, as `*bold*`, `/italic/` and `_underline_`, with a
toolbar that wraps whatever is selected.

The obvious implementation is to store HTML and render it with `dangerouslySetInnerHTML`. That
hands every form author script execution on a public page, and sanitising HTML properly is a
library plus a permanent obligation to keep up with it. So the content stays a plain string and a
parser turns it into spans carrying three booleans — **the worst an author can produce is bold
text**, and `<script>` typed into a box comes out as the literal characters. There is no sanitiser
because there is nothing to sanitise, and a test says so.

An unpaired marker stays literal: `2 * 3 = 6` is arithmetic far more often than somebody forgetting
to close a bold, and swallowing the rest of the line into a style would be the wrong guess.

**A resizable builder.** The divider between the field list and the preview is draggable, and
remembered per browser in `localStorage` — how one person likes to work, not something about the
organisation, so it should not follow them onto a colleague's screen. It is a `separator` with
arrow-key support as well as a drag handle: a resize nobody can do without a pointer is a resize
half the people cannot do. Neither pane can be squeezed below a usable width.

A form with long labels wants a wide preview; a form being reordered wants a wide list. Both are
the same person ten minutes apart, which is why the split is theirs to set rather than ours to
guess.


## A form from paper · done

The request was a scanner and a PDF editor inside the forms app — photograph a page, make it a
PDF, add radio buttons, extract the text, sign. `docs/adr/0004-old-forms-on-paper.md` had already
argued that the thing people want is *their old form, running here*, and that an importer answers
that better than an editor because its output is a form this product can actually run. This is
the file half of that importer; the mapping half (`importAcroFields`) landed with #74.

**From paper**, beside Import in the builder. A PDF or a set of photographs. A PDF made by a form
tool declares its fields, and they arrive as questions — text, tick box, radio group, list,
signature — each with its place on the page; a push button or a read-only field is listed as
skipped, with the reason, exactly as the SurveyJS importer does. A photograph, or a PDF that is
only a picture, arrives as pages. The file is read in the browser first and described — pages,
fields, skipped — before anything is stored; the button under that description is rule 7's
confirmation, and nothing reaches the server until it is pressed.

**The paper view.** A form with paper has two views of the same field list. The list is the one
that existed; the paper is every page, stacked, with a box on it per question. Dragging on empty
paper draws a box and asks what kind of answer it takes; on a digital PDF the printed words just
left of the box are offered as its label, verbatim, because rule 8 forbids improving what the
document says. Boxes are buttons — the keyboard reaches them, arrows move them, Shift resizes —
so placement is not pointer-only. Selecting one opens the same `FieldProperties` as the list.

**Anchors are fractions of the page**, not points or pixels: the same anchor is right on a
thumbnail, a phone photograph and, later, the original at native size. A field with an anchor is
an ordinary field with one extra optional property, so every form built from scratch is unchanged
and `schemaVersion` stays at 1. This touches `packages/shared`.

**In the browser, lazily.** `pdfjs-dist` is a megabyte and exists for one button, so it is loaded
with `import()` from one module and `bundle-split.test.ts` now refuses a static import of it
anywhere. The server never draws a stranger's PDF: it stores the bytes in the private upload
store, 10 MB and 20 pages at most, judged by magic bytes rather than filename, and hands them back
only through `GET /v1/forms/:id/paper/:key` — authenticated, scoped through the form, and only
for a key the current draft lists. That list is the ownership record; there is no new table.

**Never "scan" and never "sign."** The first would promise edge detection and OCR this does not
do; the second claims a legal act (`SPEC-forms.md` §8). The drawn signature field is what a PDF's
signature field becomes, and it is described as it always was.

**Deliberately not built.** OCR on photographs (the author types the label; Tesseract is a
follow-up if photographs turn out to outnumber PDFs). Edge detection and deskew (a phone camera's
document mode does this before the file exists). Writing answers and the drawn mark back onto the
original — the next phase; the anchors are what make it a rendering job. Purging source files: they
live in the same content-addressed store as respondent attachments, which nothing purges yet
either, and that gap is already on the launch checklist. The seed gets no paper, because a
`paper` block pointing at a file that is not on disk would be a broken demo.

## Answers back onto the paper · done

The other half of "a form from paper": for a submission of a form that has paper, **the
original page with the answers written in their boxes** — `GET /v1/submissions/:id/paper.pdf`,
and a Paper button per complete row on the Submissions screen. ADR 0004 calls it overlay
output and holds it for the document that must be submitted as itself; that is what it is for.

**Chromium draws, pdf-lib composites.** pdf-lib's own fonts are WinAnsi and would throw on a
Russian surname, and embedding a family that covers CJK is a bigger job than the feature — while
text in twelve languages is already solved in `render.ts`. So the answers are rendered as an
overlay: one transparent page per paper page, same size in points, each answer positioned at its
anchor. pdf-lib (new, server only, pure JS) copies the source PDF's pages and draws the overlay
over each. A photographed page needs no compositing: the photograph is the overlay page's
background, and that page is the output page. `renderPages` is `render` without the A4 chrome —
`preferCSSPageSize`, no margins, no running header.

**What is written.** The answer, verbatim, in the respondent's language: option labels rather
than stored values, dates and numbers through `Intl`, a tick in a box the size a tick box
arrives as and the word Yes/No in any larger one, the drawn mark as an image in its box. A field
with no anchor was never on the paper and is not drawn.

**The version they filled in, not the draft.** An author who redraws a box a month later must
not move an answer on paper that was already returned, so the definition comes from
`submission.formVersionId`. Access is the admission card's: the sheet carries everything the
person wrote.

**Not built, on purpose.** Bulk generation (the admission job's shape, when somebody needs two
hundred). Sending the sheet to the respondent — a privacy decision, since it carries all of
their answers, and therefore a privacy-page decision. Repeating groups on paper: no box can
hold N entries. Flattening the original's own form widgets: they stay, and the answers are drawn
over them, which is what a pen would do.

## Reading a photographed page · done

Phase one offered a drawn box the printed words beside it — on a digital PDF, where pdfjs hands
the text over. A photograph has no text layer, so the author typed every label. Now a
photograph is read with Tesseract, in the browser, and gets the same offer.

**A suggestion, never a field.** ADR 0004 rules out guessing questions from a scan: a form that
asks slightly the wrong questions is worse than one the author drew. OCR here creates nothing.
The author draws a box; the words next to it are offered, verbatim (rule 8); a box beside
nothing readable simply keeps its default label. The read happens the first time a box is drawn
on a page — several seconds and a language model the first time — not on load, because a page
nobody draws on should cost nothing. A failed read is logged and otherwise silent: it is a
convenience, and the author types the label as they would have anyway.

**From this origin, and nowhere else.** `tesseract.js` defaults its worker, WebAssembly core and
language data to a CDN, and the content security policy is `'self'` with no CDN, on purpose.
So all three are copied out of `node_modules` into `public/ocr/` by `scripts/ocr-assets.ts`
before Vite runs — the language models arrive through `pnpm install` as `@tesseract.js-data/*`
packages, so a build needs no network it did not already need — and the folder is gitignored:
45 MB of binaries in git is a file somebody will edit. The photograph never leaves the browser.
Excluded from the PWA precache with the PDF reader; `bundle-split.test.ts` refuses a static
import of either.

**One CSP change.** `script-src` gains `'wasm-unsafe-eval'`: Chromium will not instantiate
WebAssembly under a bare `'self'`. It permits WebAssembly compilation and nothing else — not
`eval`, not `Function` — which is why it is not `unsafe-eval`. `security-headers.test.ts` pins
the exact directive.

**Not built.** Automatic field detection; deskew or crop; reading respondents' uploads;
server-side OCR.

## Straightening a photographed page · done

A phone photograph of a form is taken at an angle, with the table around it. Until now it was
stored as it was: the boxes were drawn on the skewed picture and the filled sheet came back
skewed. Now, between choosing the photograph and pressing "Replace this form", four handles
sit on the picture and the author drags them onto the page's corners; on confirm the page is
lifted out flat and upright.

**By hand, not by detection.** What a scanner app finds automatically it finds wrongly on a
dark table, at the cost of an 8 MB computer-vision library; a person puts four handles on four
corners in as many seconds. The handles start on the picture's own corners, so doing nothing
keeps the photograph as it is, and "Use the whole picture" puts them back. A handle dragged
across the opposite edge makes a bow-tie, which is not a page: the outline turns red and the
confirm waits. Handles are buttons — arrows move them, Shift moves further — so straightening
is not pointer-only.

**The maths is forty lines.** A flat page photographed at an angle is a projective transform
of the page: eight numbers, and four corner correspondences give exactly eight equations
(`warp.ts`, direct linear solution with partial pivoting). Every output pixel is mapped back
into the photograph and sampled bilinearly — a plain loop over `Uint8ClampedArray`, DOM-free,
so the test paints a skewed white quadrilateral on a dark picture and checks that all four
corners of the result are paper. The output is capped at 1600 px on the long side, which is
enough for OCR and for anchors and turns an 8 MB phone JPEG into a few hundred KB — the
private store and the 10 MB cap both prefer it. JPEG, because it is a photograph.

**Not built.** Automatic edge detection; whitening or contrast filters; re-cropping a page
after import.

## L0 — Reconcile state + real e2e baseline · done

First phase of the local/ngrok track. No product code changed; this is what was measured on
2026-09-21 so that L1–L7 start from evidence rather than from `docs/HANDOVER.md` as it read at #67.

**Repository state, observed**

- `origin/main` = `691d40a` (merge of PR #81, `claude/paper-crop`). Fourteen PRs after #67.
- Open PRs: five dependabot bumps (#62, #83, #84, #85, #86). "No open PRs" was stale.
- Vitest: **127 test files, 1710 tests**, 0 skipped. "109 test files" was stale.
- Playwright: **2 specs, 11 tests**, and they had never been executed on this machine.
- Worktree `claude/l0-baseline` created from `origin/main`; the main checkout holds unrelated,
  uncommitted scan-feature work on `claude/scan` and was left untouched.

**The database this machine did not have**

There is no Docker, no WSL and no PostgreSQL service here, so `pnpm db:up` cannot run. The
substitute is the EDB **portable** PostgreSQL 16.12 binaries (no installer, no service), unpacked
to `C:\Users\gusta\pg16` and initialised with the same arguments as `docker-compose.yml`
(`--locale-provider=icu --icu-locale=sv-SE -E UTF8`, rule 6), user/password/db `throwpaper`, so
the shipped `DATABASE_URL` works unchanged. `pg_database` confirms `datlocprovider = i`,
`daticulocale = sv-SE`.

```
C:\Users\gusta\pg16\pgsql\bin\pg_ctl -D C:\Users\gusta\pg16\data -l C:\Users\gusta\pg16\postgres.log -o "-p 5432" start
C:\Users\gusta\pg16\pgsql\bin\pg_ctl -D C:\Users\gusta\pg16\data stop
```

The cluster persists between sessions; only `start` is needed next time.

**What ran, and what it said**

| Command              | Result                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate`    | `migrations applied` — 16 rows in `drizzle.__drizzle_migrations`                                       |
| `pnpm db:seed`       | `seed complete` — 1 organisation, 2 users, 1 event, 3 forms (1 published), 200 submissions             |
| `pnpm demo`          | `/health` → `{"mode":"demo","database":"skipped"}`; `/f/varmotet` renders; no console errors           |
| `pnpm verify`        | exit 0 — format, typecheck, lint (2 `exhaustive-deps` warnings, 0 errors), 127 files / 1710 tests, both builds |
| `pnpm contract:check`| passed — 0/6 implemented, 6 deferred (unchanged)                                                        |
| `pnpm test:e2e`      | **11 passed (27.1s)** — genuinely ran, not SKIPPED                                                     |

`apps/api-forms/src/db/database.test.ts` — the `describe.skipIf(!migrated)` block — ran its ten
tests against the real database for the first time on this machine (0 skipped in the run).

**Two things the e2e run surfaced that are not regressions**

- The API log prints `job failed` nine times during the suite. Every one is a `mail.send` job
  whose `error` column reads `submission <id> not found`: the specs' `afterAll` deletes the
  submissions they created, and the confirmation-mail job that the submission enqueued runs after
  that. Six jobs, zero of their submission ids present, zero e2e rows left behind. Harness
  side-effect, left alone.
- `server.ts` logs the failure as `{ error, jobId }`, and pino serialises an `Error` under the key
  `error` as `{}`, so the log line carries no message — the text survives only in `jobs.error`.
  A diagnostic nit for a later pass (`err` is the key pino serialises), not an L0 change.

**Leads for later phases, recorded here rather than acted on**

- In demo mode `api-forms` logs `Server listening at http://192.168.0.4:4001` as well as
  `127.0.0.1` — it binds every interface. L2 (audit 8) must decide whether that is wanted beside a
  trusted local forwarding hop.
- `LAUNCH-CHECKLIST.md` §2.1 rows 9, 10 and 11 already have tests in the tree
  (`forms/form-access.test.ts`, `forms/draft-guards.test.ts`); §1.3 says `TRUST_PROXY` exists and
  is wired. Those rows are stale leads for L1/L2 to prove and delete — not closed here, because L0
  produced no discriminating evidence for them.
- The Postgres seed writes **no brand kit** (`brand_kits` = 0 rows); the "Demo AB" kit exists only
  in the in-memory demo dataset (`demo/dataset.ts`). `CLAUDE.md` §Demo data asks the seed for one.
  The §2.2 checklist row that points at `seed.ts` for the demo kit is therefore aimed at the wrong
  file.

**What the e2e suite covers today, and what it does not**

Covered (11 tests): the public form filled across both pages to a reference; language switch
mid-flow keeping typed answers; required-field and malformed-email refusal; duplicate-address
refusal; save-and-resume; the door admitting once and answering `already` on the retry; an
unknown reference refused; a revoked registration refused; the attendance report counting
arrivals and no-shows; an operator working the door but unable to revoke.

Not covered: sign-in through a real magic link (the suite plants a refresh token); the builder;
publishing; the admission PDF download and bulk generation; invoices and the public invoice page;
the brand kit; paper import; sending-domain verification; the marketing site and its contact form;
anything in `apps/mailer`. Later phases add coverage only where it proves a fix.

**Design critique, re-run.** `/impeccable critique apps/forms/src/site/Site.tsx`, dual-agent
(design review; detector + browser at 1280/375 × light/dark), snapshot
`.impeccable/critique/2026-09-21T16-52-02Z__apps-forms-src-site-site-tsx.md`.

**Trend for the site: 18 → 22 → 23 / 32.** Fixed since the last run: the hero loop is gated on
both width and reduced motion (a phone gets the 17 KB poster), the skip link clears the 77px bar,
`/login` now says "Open the demo" and "nothing here is real", and there is no unnamed `<video>`
(it is a `<picture>`). Still present, now with measured numbers: related-feature links at
**2.12:1** (the one P0), feature pages 83% in `#666` at a 704px measure with no call to action,
three filled primaries and no `aria-current` on the section nav, chips at 1.79:1. Nothing was
changed in response — the final design pass reads that snapshot, after L1–L7. The app shell was
not re-scored in this run.

## L1 — Audit items 9, 10, 11, 13 · done

Verification, not feature work: each `LAUNCH-CHECKLIST.md` §2.1 row was traced to its data
boundary and either proven closed by a test that is shown to discriminate, or closed with the
smallest guard in the shape its siblings already use. Mutation evidence below is the actual
vitest output with a temporary edit in place, reverted with `git checkout --` afterwards.

**9 — `POST /v1/forms/:id/admission-documents`.** Already fixed: `routes/documents.ts` asks
`resolveFormAccess` and answers 404. Proven by `forms/form-access.test.ts` "the bulk export":
Oskar (operator) against Alva's private form → 404 with no name or email in the body; Alva → 202.
Discriminates: with the check swapped back to `forms.findById(organisationId, id)` the test fails
(`Tests 1 failed | 6 passed`); restored, `7 passed`.

**10 — `GET /v1/events/:id/attendance`.** Already scoped at the query: `events.findById`,
`submissions.listForEvent` and `checkIns.listForEvent` all carry `organisation_id` in their
`where` (`db/repositories/drizzle.ts`); `guestsForAll → listVersions(formId)` is unscoped but only
walks forms of rows already scoped. What was missing was the proof from outside: a new
`describe('another organisation')` seeds a second organisation with its own administrator, signs
her in through the real `/v1/auth/refresh` (the magic link resolves `organisations.first()`, audit
17, so it cannot sign in a second tenant), and asks for Alva's event → 404, no attendee in the
body. Discriminates: with the organisation predicate dropped from the fake's `events.findById`,
`expected 200 to be 404`; restored, passes.

**11 — `POST /public/forms/:slug/draft`.** Already fixed: honeypot, open/closed check and a
30-per-minute route limit (`routes/public-forms.ts`), mail through the `MailProvider` seam. Proven
by `forms/draft-guards.test.ts`: a person → 200 and one mail; honeypot → 200, a token that resumes
nothing, no mail, no row; closed → 409 `closed`, no mail. The transport in tests is the memory
provider; locally and in e2e it is the console provider (`--- mail (console provider) --- to:
resume-…` in the L0 e2e log). Discriminates: with both guards removed, `2 failed | 1 passed`;
restored, `3 passed`. The rate limit was left as it is.

**13 — admission PDF and attachment download.** Two of four boundaries were already the form's:
`GET /v1/submissions/:id/admission.pdf` and `paper.pdf` look the submission up by organisation
*and then* ask `resolveFormAccess(submission.formId)`. Two were not:

- `GET /v1/submissions/:submissionId/files/:key` — a respondent's attachment — was
  `uploads.findForDownload(organisationId, submissionId, key)` and nothing more, so any operator
  with a session could download the CVs sent to a colleague's private form.
- `GET /v1/jobs/:id` was `jobs.findById(organisationId, id)`, and a finished bulk job's `result`
  is `downloadPath`, a signed link to a ZIP of every registrant's card — a signed key, obtainable
  from an organisation-level id.

Both now ask `resolveFormAccess` (the upload row already carries `formId`; the bulk job's payload
does too) and answer 404. A job without a `formId` (`mail.send`) carries no link and stays
organisation-scoped. Two rows added to the `it.each` in `form-access.test.ts`; committed before
the guard, where both fail with `expected 200 to be 404`, and passing after it. The owner still
downloads the file and reads the job (pinned). `GET /v1/documents/download` itself is unchanged:
signature plus expiry, unauthenticated by design, as `routes/documents.ts` explains.

**Ran:** `pnpm verify` — 127 files, **1715 tests** (five new), both builds; `pnpm contract:check`
passed; `pnpm test:e2e` **11 passed**. Rows 9, 10, 11 and 13 deleted from the checklist.

## L2 — Audit item 8: `TRUST_PROXY` on the local/ngrok hop · done

`TRUST_PROXY` already existed (`env.ts`, wired in `server.ts` as a proxy-addr list, never `true`).
What was missing was evidence for the topology this product is actually run in today: a laptop,
with ngrok in front for a phone at the door. No proxy logic was added.

**The topology, observed.** The ngrok agent runs on the laptop and connects to `127.0.0.1:4001`,
so the socket the API sees is loopback. ngrok's inspection API (`127.0.0.1:4040`) shows exactly
what it hands over: `X-Forwarded-For: 188.151.212.102` and `X-Forwarded-Proto: https`; a client
that writes its own header arrives as `X-Forwarded-For: 1.2.3.4, 188.151.212.102` — ngrok
**appends** the address it saw. proxy-addr walks that list from the right and stops at the first
address that is not a trusted hop, so with `TRUST_PROXY=loopback` the forged `1.2.3.4` is never
reached. That is the whole argument for `loopback`: it names the one hop that is ours and nothing
else, and `true` — which believes the client's half of the header — is never the answer.

**Automated.** `apps/api-forms/src/proxy-trust.test.ts`, five cases through `app.inject` with a
`remoteAddress` and a forwarded header, reading the address the magic-link route hands
`createLoginToken`: empty `TRUST_PROXY` ignores the header (socket `127.0.0.1`); `loopback`
believes a loopback hop (`203.0.113.5`); a forged chain `198.51.100.7, 203.0.113.5` resolves to
`203.0.113.5`; a LAN socket `192.168.0.9` with a forged header stays `192.168.0.9`; and five
requests as one visitor then one as another give 202 → 429 → 202 — two visitors, two buckets.
Mutation: with `trustProxy: true` forced, three of the five fail (the empty case, the forgery and
the neighbour); restored, `5 passed`.

**The real tunnel, 2026-09-21.** `ngrok http 4001` →
`https://unison-drier-silly.ngrok-free.dev`; the built app served by the API (`SERVE_APP`,
`APP_URL=<that origin>`, `TRUST_PROXY=loopback`, `API_FORMS_HOST=127.0.0.1`,
`MAIL_PROVIDER=console`) against the local Postgres. `netstat` showed `127.0.0.1:4001` only.
Through the tunnel: `/health` → `mode: live, database: up`; `/f/varmotet-2026` → 200 `text/html`;
`POST /v1/auth/magic-link` → 202 and the console mail carried
`https://unison-drier-silly.ngrok-free.dev/auth/callback?token=…`; `login_tokens.requested_ip`
= `188.151.212.102` (the laptop's public address, from `api.ipify.org`), not `127.0.0.1`; the
same request with `X-Forwarded-For: 1.2.3.4` → still `188.151.212.102`. Then the sixth request
through the tunnel → **429**, while a plain request from `127.0.0.1` at the same instant → 202 —
two identities, two buckets — and a local request *claiming* to be the tunnel visitor → 429,
which is the documented cost of trusting a local hop: a process on the laptop is inside the
boundary. `E2E_BASE_URL=<origin> pnpm test:e2e` then drove the whole Playwright suite through the
tunnel: **11 passed (29.8s)**, 260 requests by ngrok's count, every one recorded with the public
address, and the save-and-resume mail pointed at `https://unison-drier-silly…/f/varmotet?resume=`.
With `TRUST_PROXY` empty, restarted locally: a forged header from `127.0.0.1` → `127.0.0.1`, and
the magic link pointed at `http://localhost:5173`. No real mail: the `messages` table gained no
row during the session (its nine rows are console rows from the L1 e2e run), and every mail in
the API log is `--- mail (console provider) ---`. Tunnel and server stopped; the public URL now
answers ngrok's own 404.

**Two small changes.** `API_FORMS_HOST` (default `0.0.0.0`, so the image is unchanged; `127.0.0.1`
in `.env.example`) — the L0 log had shown the API on `192.168.0.4:4001`, and a port the LAN can
reach beside a trusted loopback forwarder is a worse shape than it needs to be, even though the
LAN case is safe on its own (the fourth test). And `E2E_BASE_URL` in `playwright.config.ts`:
when set, no server is started and the suite drives that origin with ngrok's
`ngrok-skip-browser-warning` header; unset, the config is what CI runs.

**Documented.** `.env.example` carries the proven ngrok block — the free-plan URL is new every run
and is read from `127.0.0.1:4040`, so it is an argument to that run, not a value to write down.
`docs/DEPLOY.md` gained `TRUST_PROXY` and `API_FORMS_HOST` rows; it had neither. The Vite dev
server was deliberately not put behind the tunnel (owner's choice): Vite 6.4 would also refuse the
ngrok `Host` until allowed, which is recorded here and not configured.

**Ran:** `pnpm verify`, `pnpm contract:check`, `pnpm test:e2e` (local default) — green, see the PR.
Checklist row 8 deleted; the §1.3 `TRUST_PROXY` row stays, reworded, because deployment is open.

## L3 — Audit item 14: the tenant's key in the operator listing · done

`GET /v1/invoices` handed every signed-in operator every invoice's `publicToken` — the permanent,
random string that *is* the tenant's session at `/i/:token`. The audit rated it Low, and the
question was whether the operator screen needed the token or only the two documents it used the
token to reach.

**Traced.** The token's only consumers were the two links on the Invoices screen: "Open"
(`/i/<token>`, the tenant's page) and "PDF" (`/i/<token>/pdf`). Nothing else reads it off the
wire; nothing in the product sends the `/i/` link to a tenant yet (there is no send path), and the
request log already redacts it. `PublicInvoice` in `packages/shared` omitted it for the public
shape, and no route used that shape either — the tenant page is HTML.

**Changed.** The operator wire shape (`packages/shared/src/invoicing/api.ts`, `Invoice`) no
longer carries `publicToken`; the record does, and the tenant's routes are untouched. Operators
get the file from `GET /v1/invoices/:id/pdf` — bearer, `findInvoice(organisation, id)` → 404 for
anyone else's, rendered by `invoiceDocument()`, which is the render half of the public route's
loader extracted so the page, the tenant's file and the operator's file cannot disagree on
organisation name, palette or language. The two links became two buttons on the `AttachmentLink`
pattern: "Open" opens the PDF in a new tab (the tab is opened inside the click, before the fetch,
so a pop-up blocker sees a gesture), "PDF" saves it as `<number>.pdf`. Same keys, same words.

**What an operator loses.** The tenant's HTML page as a page. It cannot be opened in a new tab
behind a bearer without putting a credential in the URL, which is the thing being removed, and a
short-lived signed link would be one credential exposure replaced with another. The PDF is the
same document from the same renderer.

**Proven.** `routes/invoices.test.ts`, committed red first: the listing test failed with
`expected { … } to not have property "publicToken"` on the old code and passes after; the file is
served to an operator of the organisation with the tenant's headers (`1042.pdf`, `no-store,
private`), refused with 404 for another organisation's id (and nothing rendered), 401 without a
session; and `/i/<token>` and `/i/<token>/pdf` still answer 200 for the holder. In the demo: the
Invoices screen renders three rows with Open/PDF buttons, `document.body.innerHTML` contains no
`/i/<token>`, and both buttons produce `GET /api/v1/invoices/<id>/pdf → 200`.

**Ran:** `pnpm verify` — 129 files, **1725 tests**; `pnpm contract:check` passed (the invoice
schema is not part of the Forms ⇄ Mailer contract); `pnpm test:e2e` 11 passed. Row 14 deleted.
`packages/shared` touched.

## L4 — Audit item 15: a form pointed at somebody else's event · done

`POST /v1/forms` and `PATCH /v1/forms/:id` wrote `body.eventId` after a UUID-shape check and
nothing else. Traced to the repository: the insert and the update take the id as given, and the
foreign key is `events(id)` alone — no organisation in it.

**What it would have done.** Not a name leak: `submissions.listForEvent` and
`checkIns.listForEvent` are organisation-scoped, so another organisation's registrants never
appear on the attendee list. But `events.countRegistrations(eventId)` counts submissions by event
id with no organisation predicate, so a form in organisation B aimed at A's event would have
counted B's registrants against A's capacity and closed A's registration as "full". The public
form's own event lookup is scoped, so B's form would have rendered as if it had no event.

**Fixed at the boundary.** Both handlers now ask `events.findById(auth.organisation.id, eventId)`
before writing and answer **422 `unknown-event`** otherwise — the same shape as
`unknown-template` in the same handler, and before anything is written. `eventId: null` (detach)
is unchanged. `countRegistrations` is left as it is: once no form can point across the boundary,
nothing counts across it, and there is no pre-existing row to worry about before launch.

**Proven.** Three tests in `form-access.test.ts` under "another organisation", the first two
committed red (`expected 201 to be 422`, `expected 200 to be 422`) and green after the guard:
Greta (organisation B) creating a form with Alva's event id → 422 and no form written; Greta
patching her own form to Alva's event → 422 and `eventId` still `null`; Alva creating with her
event → 201, detaching → 200 `null`, reattaching → 200 — the legitimate case works.

**Ran:** `pnpm verify` — 129 files, **1728 tests**; `pnpm contract:check` passed;
`pnpm test:e2e` 11 passed. Row 15 deleted. `packages/` untouched (the schema is shape; ownership
is data).

## L5 — Audit item 16: download links get their own secret · done

The `DocumentStore` was built with `JWT_SECRET` verbatim as its HMAC key (`server.ts`), so the
string that mints an administrator's session also signed every link to a ZIP of registrations,
and rotating one silently rotated the other. The admission QR already derived its own key; the
store did not.

**Now.** `DOCUMENT_SIGNING_SECRET`: at least 32 characters (`env.ts`, same rule as `JWT_SECRET`),
required — `main.ts` refuses to start without it, with the same sentence shape — and refused
outright when it equals `JWT_SECRET`, because two keys was the point. `buildServer` takes it as
`documentSigningSecret` and builds the store with it; `signedPath` (reached from the bulk
admission job) signs with it and `verifySignedPath` (reached from `GET /v1/documents/download`)
checks with it. Expiry semantics unchanged. Demo mode mints one per boot, as it does for the
session secret: demo data does not outlive the process and neither should its links.

**Rollout.** Every download link signed before this change answers 403 `link-expired` afterwards.
Pre-launch, that is one re-run of a bulk export; recorded in `SECURITY.md`'s rotation runbook so
the same consequence is written down for the day the secret is rotated on purpose.

**Proven.** `documents/signing-secret.test.ts`, committed red, builds the server *without* a
store so the wiring is what is tested: a link signed with `JWT_SECRET` → 403 (it was reaching the
file lookup, `expected 404 to be 403`); a link signed with the document secret → 200; equal
secrets → refused; absent → refused naming the variable; read from the environment when not
passed. `env.test.ts` pins the 32-character floor. On the real entry point: without the
variable, `DOCUMENT_SIGNING_SECRET must be set to at least 32 characters before the server can
start`; with it equal to `JWT_SECRET`, `DOCUMENT_SIGNING_SECRET must differ from JWT_SECRET`;
demo boots on a random one.

**Set everywhere `JWT_SECRET` is set:** `.env.example`, the local `.env`, the e2e server in
`playwright.config.ts`, CI, the Dockerfile run line, `docs/DEPLOY.md`, `SECURITY.md`. A
checkout whose `.env` predates this change needs the line added before `pnpm dev:forms` starts.

**Ran:** `pnpm verify` — 130 files, **1734 tests**; `pnpm contract:check` passed; `pnpm test:e2e`
11 passed (Playwright starts the API with the new variable, so the startup guard is exercised).
Row 16 deleted; §1.3 gains the secret beside `JWT_SECRET`.

## L6 — Audit item 12: the anonymous-upload sweeper · done

`form_uploads_unclaimed_idx` — `created_at where submission_id is null`, commented "finding what
to sweep" — existed since A15b, and nothing read it. Somebody who attached a CV and closed the
tab left bytes on disk forever. This is the sweep.

**The threshold is derived, not invented.** The brief said not to choose a retention period, and
none was. A saved-and-resumed draft can still claim its upload for as long as its resume link
lives (`RESUME_TTL_SECONDS`, 30 days), and nothing else can claim an upload later than that. So
"unclaimed for longer than the resume window" is the one cutoff the code already commits to,
read back: `UPLOAD_CLAIM_WINDOW_SECONDS` in `uploads/lifecycle.ts`, and `RESUME_TTL_SECONDS` now
*is* that constant. The owner confirmed the basis. The §1.1 retention decisions (responses,
closed accounts) are untouched and still theirs.

**Safe against a claim by construction.** `findUnclaimed` now also requires
`created_at >= now − window`; the sweep deletes `submission_id is null and created_at < now −
window`. The predicates are complements: a row the sweep may take is a row the submit path
already refuses to claim, so there is no interleaving in which both act on the same row. A
respondent whose attachment is older than the window gets the existing 422 `validation.file`
and attaches it again.

**Rows, then bytes, conservatively.** `uploads.sweepExpired(before, limit)` deletes one bounded
batch (`delete … where id in (select … order by created_at limit n) returning storage_key`) —
`delete … limit` is not SQL, so the subselect walks the partial index. Then, per distinct key:
kept if any `form_uploads` row still holds it (the store is content-addressed and deduplicated),
kept if any form's draft or published version lists it as a paper source (paper pages live in
the same store with no row at all — a `like` over the JSON cast to text, which a 64-hex key
cannot false-match), otherwise `uploadStore.delete(key)`. A second pass finds nothing.

**Scheduled like the worker.** An hourly timer inside the API process, one pass at a time,
errors logged rather than thrown, one pass at boot, gated by the same flag as the worker so tests
run it by hand. Not a queued job: the queue belongs to an organisation and the sweep belongs to
none. Two instances sweeping at once is harmless.

**Proven.** `uploads/sweeper.test.ts`, committed red (no module): expired removed — row and
bytes; newer kept; claimed kept however old; shared bytes kept when a claimed row has the same
key; bytes kept when a form's paper names the key; a second run reports zeros; `limit: 1` takes
one per run, oldest first; the window equals the resume TTL. The complement in
`respondent-uploads.test.ts`, also red first (`expected 201 to be 422`): a 31-day-old upload is
refused at submit. And `database.test.ts` runs the real SQL against Postgres: the bounded
subselect, the `returning`, `isReferenced`, and `referencesUpload` before and after a form takes
the key as paper.

**Ran:** `pnpm verify` — 131 files, **1744 tests**; `pnpm contract:check` passed; `pnpm test:e2e`
11 passed with the sweep running at API boot (0 unclaimed rows, nothing logged). Row 12 deleted
— the last §2.1 audit row. No migration, no `packages/`, no dependency.

## L7 — §2.2 strings and the accessible error · done

The mechanical rows, closed with the security track green. The checklist's line numbers were
stale; each item was located in current code first.

**Placeholders.** `placeholder="AB12-CD34"` on the door's reference field and
`placeholder="https://"` twice in the builder were the only literal placeholders in the app.
They are keys now — `checkin.referencePlaceholder` and `url.placeholder`, in all twelve
catalogues, with the same format example in each, because a format example is not a sentence.
The door's field also gained `autoCapitalize="characters"` (a reference is upper-case letters and
digits) and `enterKeyHint="go"` (pressing the key checks the person in).

**EventForm.** It rendered the state value `load-failed` as if it were a sentence, and on a save
failure the exception's own English words. Both now show `users.errorFailed`, an existing key —
no new sentence was written for twelve languages — in a paragraph with `role="alert"`, which
also settles the §2.3 fragment that named it. The per-language fields are labelled through
`localeLabel()` from `@tp/i18n`, the helper the language picker already used: **Svenska /
English** rather than `sv-SE` / `en-GB`.

**Login.** The development hint is gated on `import.meta.env.DEV` and only renders after a link
has been sent, which is why a glance at the sign-in screen cannot prove it. Proven in the state
that matters: after submitting an address, the dev server shows "Development mode: the link is
printed in the api-forms console" and the production bundle served by `vite preview`, in the
same state, does not (`devHintShown: false`, `bundleIsBuilt: true`). No change made.

**Guard.** `lib/no-literal-strings.test.ts`, committed red naming the four files, refuses a
`placeholder="…"` literal anywhere in the app and the `load-failed` state; `messages.test.ts`
already fails the build on a key missing from any language.

**Ran:** `pnpm verify` — 132 files, **1747 tests**; `pnpm contract:check` passed; `pnpm test:e2e`
11 passed (the door spec types into the changed field). Browser: door field attributes read
back, EventForm labels read back, Login proven as above. Four §2.2 rows deleted; the demo brand
kit row stays (owner's). `packages/` untouched.

## The design pass — the site, from the fourth critique · done

With the security track green, the site was worked from the 2026-09-21 snapshot in the order the
handoff set: accessibility, contrast and tokens, the phone, hierarchy, motion, copy. Every value
is a token and a brand colour paints nothing that is read; no copy was written — the two wording
changes reuse keys the site already had.

**Accessibility.** The related-feature links were seafoam on the page at 12.8px and 20px tall —
2.12:1, the one P0. They are the ink at `--tp-text-ui`, 44px, underlined on hover. The bar marks
the page being read (`aria-current="page"`, server-rendered from `useLocation` as the language
switcher already did; the switcher's `"true"` became `"page"`). The card's "Read more" is
`aria-hidden`, so a link already named by its title is not read six times over. Header mark,
back link, language and footer links are 44px targets.

**Contrast.** The chip glyph (seafoam on a seafoam tint, 1.79:1), the card's "Read more"
(accent-ink 4.35:1 at 12.8px) and the pending marker (warning on its tint at 4.06:1, 12.8px
inside 16px prose) are read in the ink; the marker keeps its warning colour as a 2px edge, where
3:1 is what is asked. `site-chrome.test.ts` holds those four rules to `--tp-colour-text` and
refuses `primary`, `accent` or `warning` there, on every shipped palette in both schemes —
committed red, green after.

**The phone.** The fold no longer sits above the headline: h1 at y=153 (was 381), the first
button at y=374 (was 603). The bar's "Open the demo" is quiet, so one filled button is in the
first viewport and two are on the page rather than three.

**Hierarchy.** Feature pages set their argument in the ink (83% of the characters were `muted`),
at a 38rem measure (608px, ~71 cpl), with the closing panel's two doors after the points — a
feature page had no action in it. One eyebrow rule. "Back" rather than "Everything it does".

**Motion.** The 2x hero loop (1,021 KB) is offered from 1200px rather than 900, where it is drawn
large enough to tell; a 2x laptop under that takes the 506 KB file it renders at 304px anyway.
Two detector false positives recorded with reasons in `.impeccable/config.json` (a curve that
lives only in a comment about its own removal; a regex literal in a test).

**Measured, both schemes.** `.site__more a` 10.83:1 / 17.32:1 at 44px; `.feature-card__more`
9.82:1 / 15.78:1; chip glyph 9.12:1 / 12.74:1 over its tint; `.pending` 8.49:1 / 11.48:1 at the
prose size; lede and points 10.83:1 / 17.32:1; no horizontal overflow at 375; only the off-canvas
skip link under 44px.

**Fourth critique: 18 → 22 → 23 → 25 / 32 (Good).** Snapshot
`.impeccable/critique/2026-09-21T22-16-30Z__apps-forms-src-site-site-tsx.md`. Every fixable
finding from the third run confirmed fixed with a number. Two one-line findings from the fourth
were fixed after the snapshot and measured: the 404's back link says "Back", and
"Formulärbyggaren" at 39px fits its 327px column at 375 (`overflow-wrap: anywhere; hyphens:
auto` on the article h1); legal prose took the 38rem measure. Still open, deliberately: the
section nav is hidden at 375 with no menu (P1, a layout decision), the contact form has no
feedback contract (P1, needs copy — the owner's), the 2x loop is still 1 MB where it is served
(P3), and the two owner decisions (pricing; twelve languages vs five on the site).

**Ran:** `pnpm verify` — 132 files, **1756 tests**; `pnpm contract:check` passed; `pnpm test:e2e`
11 passed. `LAUNCH-CHECKLIST.md` §2.3 loses the site rows (card contrast, hero loop, measure,
`aria-current`); the app-shell rows stay for a shell pass, which the later critiques did not
re-score. `packages/` untouched.

## Dependabot, 2026-09-22 — five open pull requests, judged one by one · done

Each read for what it changes and what its CI run says, never merged on green alone.

- **#83 routine group — merged.** `@aws-sdk/client-sesv2` and `@fastify/static` patches,
  `fastify` 5.12.4 → 5.12.5, `react-router` 8.3.1 → 8.4.0, `prettier` 3.4.2 → 3.9.8. Merged onto
  the current `main` locally first: `pnpm verify` (132 files, 1756 tests, `format:check` clean —
  the Prettier minor reformats nothing here), `pnpm contract:check`, `pnpm test:e2e` 11 passed.
- **#62 `@vitejs/plugin-react` 4 → 6 — closed.** Its build fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED './internal'` from Vite 6.4.3: plugin-react 6 requires Vite 7,
  and a Vite major is the actual decision.
- **#84 `typescript` 5.9 → 6 — closed.** `packages/tokens/src/fonts.ts` loses `node:fs`,
  `node:module` and `import.meta.url` under TS 6's changed default types and module resolution;
  every tsconfig in the workspace needs the migration, taken deliberately.
- **#85 `fastify-type-provider-zod` 4 → 7 — closed.** Requires Zod 4 (`zod/v4/core` `safeEncode`);
  `packages/shared` is Zod 3 throughout. Coupled to a Zod 4 migration of every schema.
- **#86 `eslint-plugin-react-hooks` 5 → 7 — closed.** Turns on the React Compiler rule set and
  reports ten "setState synchronously within an effect" errors across screens. Ten effect
  refactors, each wanting its own test, are a task — not a bump's side effect. Follow-up.

`.github/dependabot.yml` now ignores the major line of those four, with the prerequisite named
beside each, so the queue does not refill every Monday with decisions already made; remove an
entry when its prerequisite has been taken.

## The app-shell pass — the six §2.3 rows, from the 2026-09-15 critique · done

The site rows closed in the design pass; these are the app-shell rows the later, site-focused
critiques never re-scored. The evidence is still the 2026-09-15T07-51-16Z snapshot — the two
2026-09-21 snapshots carry no shell findings — and each row was mapped to current code before
anything was edited. Branch `claude/app-shell-a11y` from `origin/main` at #97, one commit per row
(two rows share the one event fetch). No dependency, no migration, no `docs/CONTRACT.md` change,
no legal copy; **`packages/shared` touched** for the last row, said below.

**Responses list.** `Inbox.tsx` wrapped each `<li>` in `<Reveal>`, a `<div>`, so the DOM read
`<ul><div><li>`: a screen reader stops counting, and `.inbox__row + .inbox__row` — the divider —
matched nothing. `Reveal` takes `as="li"` and *is* the item; the other four callers wrap cards
outside lists and are unchanged. `components/reveal-list.test.tsx` renders `<ul><Reveal as="li">`
with `react-dom/server` (already installed; no DOM setup needed) and asks for
`<ul><li class="row reveal reveal--in">`, plus a source check that no `<Reveal` precedes `<li` in
Inbox: `2 failed | 1 passed` before, `3 passed` after. In the demo: 40 `LI` children, no `DIV`,
every row's `border-top-width` 1px.

**The door names its event; a wrong id is not a door.** `GET /v1/events/:id` existed and the
client had no `getEvent`; it has one now. The localised name sits under "Check-in" *inside* the h1
(`.door__event`, body weight, `--tp-text-ui`), so the heading reads "Incheckning Vårmötet 2026".
A 404 on the event renders the `EmptyState` `EventForm` already uses (`event.notFound`, a link to
`events.title`) — no field, no camera, no verdict; a dropped connection keeps the door working
without a name, which the offline banner covers. Two e2e tests, both red on the old code (`the
door names the event it is working`: heading lacked the name; `a wrong event id is not a door`:
the not-found text was never on the page), green after.

**The verdict panel at 375.** The idle prompt, set at verdict size (3xl, 39px), wrapped to three
lines: 179px, and the first verdict fell to the 152px floor. Measured by Playwright at 375×812:
`Expected: 178.90625, Received: 154.140625`. The prompt is an instruction, not a verdict, and is
set with the name line (`.verdict--idle .verdict__headline { font-size: var(--tp-text-lg) }`).
That alone left 152 → 154 (the floor was two pixels short of a verdict with name and reference)
and "Redan incheckad" at 223 — the headline itself wraps at 3xl in Swedish, and the fixed height
had never held for it. The floor now fits the tallest verdict where the headline is largest:
`14rem` under 600px, `11rem` otherwise, and the landscape mode keeps its compact `9.5rem`, which
its xl headline fits. The e2e test asks idle, admitted and already-arrived for one number: 224
throughout at 375; 176 at 1280. No horizontal overflow at 375 in either scheme.

**Accessible names.** The five "Undo" buttons keep their visible word and carry the person's name
(or the card's reference) in `.visually-hidden`, so each is announced "Ångra Göran Häggkvist"; rows
are keyed by card, not registration (a member and their guest share a `submissionId`). The count's
sentence (`checkin.counts`) moved from an `aria-label` on the `<p>` — not reliably exposed — to
hidden text inside it, with the two visual fragments `aria-hidden`, so the number is read once as
a sentence. No new key. `screens/door-names.test.ts` (source, the field-test pattern) was `4
failed`; the e2e `each undo is named after its arrival` finds
`getByRole('button', { name: /Ångra.*Göran Häggkvist/ })` and the sentence `n av m incheckade`.
`EventForm.tsx`, named in the row, needed nothing: its `role="alert"` landed in L7.

**Focus after a scan.** `submit()` and `undo()` refocused the reference field in `finally`, on
the camera path too, and on a phone that is the keyboard, over the viewfinder below the form. One
rule, in one place: `refocus()` focuses the field only when `controlsRef.current` is null — while
the camera runs, the camera is the input; otherwise typing is, and the field takes focus back
after a check-in, an undo, or a camera that failed to start. A keyboard-wedge scanner on a laptop
is unchanged. `screens/door-focus.test.ts` holds it (exactly one `inputRef.current?.focus()`,
gated; both `finally` blocks call `refocus()`): `2 failed` before. The e2e typed path now asserts
`toBeFocused()` on the field after a check-in. No device sniffing.

**The confirmation screen.** The title was gated on `phase !== 'done'` and vanished on send; the
card said "Thank you." and a reference. The title stays as the h1 and the thank-you becomes the
card's h2. What comes next is stated from facts the server had when it queued the mail:
`SubmitResponse` (`packages/shared/src/forms/public-api.ts`) gains `confirmationTo` — the address
the form collected, or `null` — and `admissionCard`, true only when the form is bound to an event,
which is exactly when `mail/send-job.ts` attaches the card; the honeypot branch answers
`null`/`false`. Two keys in twelve catalogues, `public.confirmation` ("A confirmation is on its way
to {email}.") and `public.confirmationWithCard` ("… with your admission card …"), drafted for the
owner's review — they claim nothing the job does not do. The owner chose this server-backed shape
over leaving the row open. `public-forms.test.ts` (api) committed red: `confirmationTo` and
`admissionCard: true` for the event-bound form, `false` without an event, `null` without an email
field. `screens/public-form-confirmation.test.ts` was red on the title gate; the e2e public-form
run asserts the heading "Vårmötet" and the sentence with the typed address. In the demo at 375:
h1 "Anmälan till Vårmötet", h2 "Tack för din anmälan! Vi ses snart.", then the reference and "En
bekräftelse med ditt inträdeskort är på väg till bjorn@example.com."

**Ran.** `pnpm verify` exit 0 — format clean, typecheck, lint (the two pre-existing
`exhaustive-deps` warnings, 0 errors), **137 files / 1773 tests** (was 132 / 1756), both builds
— the final run, after the undo fix below.
`pnpm contract:check` passed (0/6 implemented, 6 deferred — the public form's submit shape is not
part of the Forms ⇄ Mailer contract). `pnpm test:e2e` **15 passed (29.8s)** against the portable
Postgres — the 11 that were there plus four new door tests. The browser check was done with a
Playwright script against `pnpm demo` because the desktop app's browser pane reported a 0×0
viewport this session.

**A defect the re-run found, fixed on the branch.** Assessment A pressed Undo and nothing
happened: `lib/api.ts` set `content-type: application/json` on every request that was not
multipart, a bodiless DELETE included, and Fastify answers that with `400
FST_ERR_CTP_EMPTY_JSON_BODY`, which `undo`'s `catch` swallowed. Reproduced through `app.inject`
with the header: DELETE undo → 400, POST archive → 400 — so archive event, trash/restore/delete
form and the brand-kit reset had never worked from a browser either, while every API test passed
because the tests inject without the header. The header is now set only when there is a JSON
body. `lib/api-bodiless.test.ts` stubs `fetch` and reads the headers (`expected
'application/json' to be null` before); the undo e2e test now presses the button, confirms, and
asks the database for zero `check_ins` rows — with the fix stashed, "Incheckning ångrad" never
appears; restored, `1 passed`. Not a §2.3 row; recorded here because it was found by the pass.

**Critique, re-run on the shell.** `/impeccable critique apps/forms/src/screens/CheckIn.tsx`,
dual-agent (A: design review; B: detector + browser, 1280/375 × light/dark, overlay injected in
the built-in browser), assessed at `91d90d1` — the six rows closed, the undo fix not yet made.
Snapshot `.impeccable/critique/2026-09-22T02-29-37Z__apps-forms-src-screens-checkin-tsx.md`.
**App shell 21 → 23 → 23 / 40.** Flat, and honestly so: the six rows measure closed (B's
numbers are in the snapshot — `ul > li` only with 1px dividers; the heading names the event;
176/176 and 224/224; "Ångra Alva Öberg"; no `p[aria-label]`; focus in the field after a typed
check-in; the confirmation's h1, h2 and sentence), but heuristic 3 scored 1 for the dead undo,
which A estimates at ~3 points, and the run found three things the September snapshot had not:
the door's own sizes lost in the cascade (`.field input` beats `.checkin__input`, `.button` beats
`.door__check`), "Not found" clearing the field and offering nothing, and the 375 header clipping
"Lämna entrén" by 17px. The detector was clean on all five files. Those, and the smaller ones,
are the new §2.3 rows; the not-found sentence is the owner's to word.

**Checklist.** The six app-shell rows deleted; eight rows from the re-run take their place, each
with a measured number where there is one. `EventForm.tsx`, named in the old accessible-name
row, needed nothing. `packages/shared` touched (`SubmitResponse`).

## The restart proof — data, documents, assets and in-flight work survive · done

The first phase after the app-shell pass, chosen because it most directly separates "tests
pass" from "I can run it on one server": rows in Postgres surviving a restart was never in doubt,
but nobody had shown that a generated ZIP, an uploaded logo and a job in flight at the moment
the process died come back. Branch `claude/persistence-proof` from `8f8179e` (#103). No
dependency, no migration, no `docs/CONTRACT.md` change, no `packages/` change.

**The spec.** `e2e/restart.spec.ts` runs its own API (`node --import tsx src/main.ts`, port
4102) against the same Postgres, signs in through the real refresh endpoint with a planted token
(`plantRefreshToken`, extracted from `signInAs`), registers a submission on the seeded form,
uploads a logo (`POST /v1/uploads`, `icon-192.png`) and reads it back, runs the bulk admission
export through the queue (`POST /v1/forms/:id/admission-documents` → 202, polls `/v1/jobs/:id`
to `done`, downloads the signed ZIP → 200 `application/zip`), then leaves that job as a dead
worker leaves it (`running`, `started_at` an hour ago) and inserts a second, queued copy. SIGKILL.
Start again. The submission row is there, the asset answers 200, the earlier ZIP answers 200
through the same signed path, the queued job reaches `done`, and — the point — the orphaned job
reaches `done` with a fresh link. On Linux the spec ends with a SIGTERM stop and expects exit 0;
on Windows a signal to a child is always a hard kill, so that step is skipped here and runs in CI.

**Committed red.** With the recovery absent, everything survived except the job the dead worker
was running: `job … did not finish within 60000ms` at the orphan's wait, after the queued copy
had completed and the asset and ZIP had answered 200. `claim()` only takes `queued` rows.

**Two things the spec exposed, and how they were closed.**

1. *A job a dead worker left `running` stayed `running` forever.* `JobRepository.requeueStale`
   (`repositories/types.ts`, `drizzle.ts`, `memory.ts`): one statement that queues again every
   `running` row started before a cutoff, or fails it when the lost claim was its last attempt —
   the claim already counts as one, so an orphan cannot loop. The worker calls it before every
   claim with `STALE_RUNNING_MS = 15 min`, longer than any job here. Red first in three places:
   `jobs/worker.test.ts` (memory; a job started a minute ago is left alone, an hour ago is run
   again with `attempts: 2`, and one out of attempts becomes `failed`), `db/database.test.ts`
   (the real SQL — which caught that a bare `'failed'` in a `case` is `text`, not `job_status`,
   and needs the cast), and the restart spec end to end (1.7 min). Recorded as a lease by age; a
   heartbeat column is the upgrade when several instances run long jobs.
2. *A stop was a crash.* `main.ts` installed no signal handler, so `docker stop` (SIGTERM) and
   Ctrl-C (SIGINT) ended the process without `app.close()` — worker timer, upload sweeper and
   Chromium all cut off. Both signals now close the app and exit with its result;
   `shutdown.test.ts` holds the entry point to it (the source pattern, because the entry point
   listens and Windows cannot deliver the signal), and the spec's last step observes it in CI.

**Two things the spec found that are recorded, not fixed here.**

- *A finished bulk export is handed back forever.* The export job is keyed on the form and its
  published version so a second request during a run joins it — but `enqueue` is idempotent
  across time too, so after the job is `done` every later request returns the same job, whose
  signed link expires after an hour and whose ZIP never includes registrations that arrived
  since. The spec deletes prior export jobs for the seeded form to stay independent of earlier
  runs. A product fix (start a new job when the existing one is finished) is a row in
  `LAUNCH-CHECKLIST.md` §2.2.
- *Two instances, two disks.* The spec's API and the one Playwright starts share the `jobs`
  table, so either worker took the export; when they had different `DOCUMENT_DIR`s the ZIP was
  a 404 from the other. They now share the directory — which is the honest statement of what
  local file storage can do, and the case for an object store the day there are two instances
  (`docs/DEPLOY.md` § What survives a restart).

**Ran.** `pnpm verify` exit 0 — **138 files / 1777 tests**, both builds, lint 0 errors (the two
pre-existing warnings); `pnpm contract:check` passed (0/6, unchanged); `pnpm test:e2e` **16
passed (2.0m)** — the fifteen from #103 plus the restart proof, genuinely run.

## Dependabot, 2026-09-22 — the second batch, #98–#102 · done

Each read for what it changes and what its CI run says, never merged on green alone; all five
were opened against the pre-#103 `main` (132 files / 1756 tests, 11 e2e), so #98 was proven on
the current one first.

- **#98 routine group — merged.** `@aws-sdk/client-sesv2` 3.1135 → 3.1136. Merged onto `main`
  (after #104) locally: `pnpm verify` exit 0 — 138 files / 1777 tests, both builds;
  `pnpm contract:check` passed; `pnpm test:e2e` **16 passed (2.1m)**. Then merged as `cc9297e`.
- **#99 `zod` 3 → 4 — closed.** Its CI fails first in the contract:
  `packages/shared/src/contract/common.ts(13,28)` and `contract/contacts.ts(16,19)`, `TS2554:
  Expected 2-3 arguments, but got 1`. A migration of every schema in `packages/shared`, and of
  `docs/CONTRACT.md` through them — the same decision as #85. ADR 0005 §#99.
- **#100 `@tanstack/react-table` 8 → 9 — closed.** `Submissions.tsx` fails typecheck on the
  renamed row-model API (`getCoreRowModel` → `createCoreRowModel`, `useReactTable` →
  `ReactTable`), the dropped `VisibilityState`, `ColumnDef`'s new arity and five implicit
  `any`s: a rewrite of the response grid, which has no browser spec until S3. ADR 0005 §#100.
- **#101 `vite` 6 → 8 — closed, by the owner's decision.** CI was green on the old base
  (132/1756, 11 e2e) with three deprecations in the build log (`optimizeDeps.rollupOptions`,
  the `esbuild` option, "switch to `plugin-react-oxc`") and `@vitejs/plugin-react` still on 4 —
  the pairing ADR 0005 §#62 says to take together, as a deliberate task. ADR 0005 §#101.
- **#102 `dotenv` 16 → 18 — closed.** Probed in a scratch directory outside the repo: 18.0.0
  prints `◇ injected env (1) from .env,missing.env` to stdout at boot unless `quiet: true`;
  both `env.ts` call `config({ path: [...] })` into pino's JSON stream. Nothing the product needs
  in exchange. ADR 0005 §#102 names the two-line way to take it on purpose.

`.github/dependabot.yml` ignores the four major lines with the reason beside each and the ADR
section that says what reopens it. `docs/adr/0005-dependency-majors.md` retitled ("Four" was
the count, not the decision) and extended with the four paragraphs. No code changed.

## S2 — The door readiness · done

The eight §2.3 rows from the 2026-09-22 morning re-run of the shell critique and the §2.2 row the
restart proof left (a finished bulk export handed back forever). Branch `claude/l8b-door` from
`fa75258` (#105). No dependency, no migration, no `docs/CONTRACT.md` change, no `packages/`
change. Measurements below are Playwright against `pnpm demo` unless a spec is named.

**The door's own sizes reach the screen.** `.field input` (0,1,1) beat `.checkin__input`, a later
`.button` beat `.door__check`, `.shell h2` beat the `.small` on "Last arrivals" — the door
designed for arm's length shipped at desk size. The three rules are `.door .x` now, one class
deeper, values unchanged. Measured: field **16 → 31.25px** at 1280 and **25px** at 375, primary
**44 → 55px**, caption **25 → 14.31px**. The e2e holds all three.

**The header fits a phone.** Three columns at 375 wrapped "Lämna entrén" to two lines (52px) and
clipped it 17px. Under 600px the header is two rows: the way out and the count, then the title
with its event on a line of its own; the link and the count never wrap. Measured at 375: link
**44px**, nothing clipped, h1 below it; no horizontal overflow at either width.

**The meta line reads.** `.verdict__meta` at `opacity: 0.85` measured 3.9:1 on success and 4.4:1
on warning; size alone marks it now. The e2e computes the composited contrast on the warning
panel and asks for ≥ 4.5.

**"Not found" says what it refused.** The field is cleared for the next card, so the verdict shows
what was scanned or typed whenever there is nobody to name (not-found, bad-signature, wrong-event):
"Hittades inte / ZZZZ-ZZZZ". The sentence telling the operator what to do next is not written —
that wording is the owner's, and the row is reworded to only that.

**A failed undo says so.** The `catch` set nothing; a confirm that changed nothing and said nothing
was the door's one silence. It now shows a `bad` verdict — the existing `users.errorFailed` with
the person's name — and the arrival stays on the list. e2e intercepts the DELETE with a 500 and
expects the verdict and the surviving row; red against `main`'s file (the verdict still read
"Välkommen").

**The camera error is ours.** A camera that would not start printed the browser's own English
`error.message` on a Swedish door; only `checkin.cameraUnavailable` is shown and the raw error goes
to the console. Source test refuses `{cameraError}` in the markup.

**The last page opened already marked wrong — and the cause was a submit nobody asked for.** The
critique saw `aria-invalid` on the final page's required question before any interaction; the
code filtered validation to the current page, so it could not be that. Instrumented: `validatePage`
ran **twice** — once for page 1 on the click, once for page 2 as a *form submit*. React patched the
same `<button>` node from `type="button"` to `type="submit"` during the click that moved to the
last page, and the browser ran the click's default action on the node as it now was. A mouse user
hit it too. The two buttons are keyed apart, so they are two nodes. e2e: page two opens with zero
`aria-invalid` elements (red against `main`: `Received: 1`).

**The thank-you takes focus.** The confirmation card is new to the page and a live region that
did not exist a moment ago is not something every screen reader announces; focus moves to the
card's heading (`tabIndex={-1}`). e2e: the level-2 heading is focused after sending (was `body`).

**Responses rows on a phone.** The name shared its row with the form's title and was cut to a
dozen letters while the title kept its width; under 720px the name has the first row (the badge
beside it when there is one) and the form and the time share the second — measured at 375: name
168px wide, form beneath it. Forty-one identical "Submitted" badges marked nothing; the badge is
for a response still in progress only, and `inbox.complete` left the twelve catalogues. The time
was `toLocaleString` with seconds; it is `formatDateTime`, as the door: "22 sep. 2026 09:50".

**A finished bulk export runs again.** `JobRepository.restart(id)` runs a done or failed job from
the start — same row, same key, so a click during the new run still joins it; the route restarts
what `enqueue` hands back when it is finished. API test red first (`Expected: "queued", Received:
"done"`), the join-during-run test unchanged, real-SQL coverage of restart and its no-op on a
running job, `e2e/restart.spec.ts` re-run green.

**Two things the suite found on the way.** (1) The public submit endpoint is limited to ten a
minute per address (`routes/public-forms.ts`), and the enlarged suite became the eleventh visitor:
the duplicate-address spec got a 429 — which the client reported as *"the form closed while you
were filling this in"*, the same false statement the 500 case was cured of. A 429 now reads as the
transient fault it is (source test red first). The door specs write their registrations straight
into the table (`register()` copies a seeded row) rather than spending the public budget; the
public endpoint is exercised by the spec that is about it. The limit itself — a hall of members
behind one NAT share one address — is an S3 finding, not changed here. (2) **Bulk generation has
no UI**: only `POST /v1/forms/:id/admission-documents` exists; nothing in `apps/forms` calls it.
S3's "bulk-generate from the Submissions screen" needs that screen to exist first.

**Ran.** `pnpm verify` exit 0 — **139 files / 1782 tests**, both builds, lint 0 errors;
`pnpm contract:check` passed; `pnpm test:e2e` **19 passed (1.9m)**, zero 429s in the run.

**Critique, re-run on the shell.** `/impeccable critique apps/forms/src/screens/CheckIn.tsx`,
dual-agent (A: design review; B: detector + browser, 1280/375 × light/dark, overlay injected in
the built-in browser), at `61ea7bf`. Snapshot
`.impeccable/critique/2026-09-22T08-02-59Z__apps-forms-src-screens-checkin-tsx.md`.
**App shell 21 → 23 → 23 → 26 / 40.** B measured every S2 row closed (the numbers above are
B's). The detector was clean on the five files; in-page it flagged the bottom bar's nav labels at
10.24px at 375. A's three P1s are the next layer — no in-product remedy after "not found" (the
owner's sentence, and a product decision on a name lookup inside the door), the door's recent row
clipping the name at 375, and two filled buttons on the public form's last page — with a P2 the
door still owes: a server fault while online reads as "Not found". All recorded as the new §2.3
rows; the not-found sentence stays the owner's.

**Checklist.** The eight rows and the §2.2 export row deleted; the not-found sentence stays as
the copy row; seven rows from the re-run take their place. No `packages/` change.

## Phase 1 — main green again · done

`docs/MODULE-STATUS.md` found the gate red at `f030000` while § L0 had recorded it green at
`691d40a` the day before. Four defects, measured at `39d7872`:

```
pnpm verify          exit 0 — prettier clean, 0 eslint errors, 139 files / 1782 tests, both builds
pnpm contract:check  exit 0 — 0/6 implemented, rest deferred
pnpm test:e2e        19 passed (2.0m) — bare, no env preamble
```

**The two failing tests were a date, not a defect.** Both tests in "a job the last worker never
finished" set a fixed clock of `2026-09-22T10:00:00Z`, but the fake clock reaches `createWorker`
only — `createMemoryRepositories` takes no clock, and `jobs.enqueue` stamps `runAfter` from the
wall clock. Since `claim` matches `runAfter <= now`, the real predicate was "the current time is
before 2026-09-22T10:00:00Z". They passed the morning they were written (`dcd203d`) and went red at
10:00 UTC that day, permanently. Nothing in the #107 merge touched them: its only change to the job
repositories (`6171546`) adds `restart` and leaves `claim` and `requeueStale` alone. Proven by
moving the literal to 2030 with the test otherwise untouched — 12 passed. The fixture now starts
from the row's own `runAfter`. **The lease-reclaim code was never broken.**

Left as a follow-up: `memory.ts` `enqueue` uses `new Date()` while `claim` takes `now` as an
argument. That asymmetry is what allowed the bomb. Injecting a clock into
`createMemoryRepositories` touches a double used across ~100 test files and was too wide for a P0
branch.

**The worktrees were lying to prettier and eslint.** `.claude/worktrees/` holds live git worktrees,
each a full checkout, and every ignore pattern in the repo is anchored at the root — so
`apps/forms/public/ocr` never matched `.claude/worktrees/l0-baseline/apps/forms/public/ocr`, and
vendored tesseract wasm was judged as ours. That is the whole gap between a red local `verify` and
a CI run that failed only on the two worker tests: CI clones fresh. `.claude/` is now ignored by
prettier and eslint, with the reason written beside it. vitest was already safe — `include` is
anchored at `{apps,packages}/*/src` and `scripts/` — but says so now rather than relying on the
glob. `bundle-budget.ts` and `ocr-assets.ts` walk fixed paths and were left alone.

**A skipped e2e suite no longer looks like a passing one.** `scripts/run-e2e.ts` exited 0 when
there was no database, and an exit code is what scripts and agents read. It exits 2 now — distinct
from Playwright's 1, so "did not run" is separable from "ran and failed" — with a greppable
`E2E SKIPPED:` prefix and `--allow-skip` for anyone who means it. CI has a Postgres service and
never reaches that path.

**Two package descriptions were written from intent.** `packages/ui` claimed the data grid; it has
one `cn()` helper and its own `index.ts` says the grid is deliberately not in v0.1. `packages/calc`
claimed a formula AST, statistics and charts; it has errors, money and the ledger. Both corrected,
the other three checked against their exports, and the rule that follows written down: a
description changes in the same PR that changes the package.

**A correction to `docs/MODULE-STATUS.md`.** Its finding E-2 — that `playwright.config.ts` does not
pass `DOCUMENT_SIGNING_SECRET` — is **wrong**. `main` has declared and passed it since #104
(`playwright.config.ts:33-34, 69`), and a bare `pnpm test:e2e` needs no env preamble. The Phase 0
session read that file while its checkout was still on `claude/scan` at `691d40a` and never re-read
it after switching to `main`; the `tsx src/main.ts` failure it reproduced bypasses the Playwright
config entirely and never evidenced the claim. What is true and unchanged: the root `.env` lacks
the secret, so `pnpm dev:forms` from this checkout still refuses to start. MODULE-STATUS.md is
corrected in place.

**Not done here.** The two `exhaustive-deps` warnings stay — they are warnings, 0 errors, and § L0
recorded them too. No doc reconciliation, no ADRs, no module work.

## Next

**v0.1 is code-complete.** Phases 0–5 are merged and `main` is green. The loop closes: a form is
filled in → a record exists → a branded PDF comes out → an email is queued → somebody is checked
in at the door.

### What is not done, and none of it is code

From `START-HERE.md` §Done means, in the order these block each other:

1. **Deploy it.** The image now exists, builds in CI and boots — see `docs/DEPLOY.md`. What is
   still missing is a host: somewhere to run it, a Postgres, a domain and a region. That is a
   decision, not code, and it still blocks everything below.
2. **SES production access.** A new account only delivers to verified addresses. Until AWS grants
   it, the phase 4 checkpoint — "does email reliably land in real inboxes" — cannot be tested at
   all. It is a request with a turnaround, so it is worth starting before it is needed.
3. **HTTPS**, or the check-in camera will not open on a phone. `localhost` is exempt; a phone on
   your network is not.
4. **A real user runs a real event.** START-HERE: "the only criterion that matters."

### Outstanding in the code

- **The end-to-end suite exists but is thin.** Playwright drives the built app against a running
  `api-forms` and a real Postgres, covering the public form, the language switch, validation,
  duplicate control, save-and-resume, and check-in. It does **not** cover the builder, the
  admission PDF download, bulk generation, or sending-domain verification — those are unit-tested
  only. `pnpm test:e2e` skips loudly without a database, so it runs in CI and nowhere else yet.
- **The local `DocumentStore` is a stopgap.** `SPEC-forms.md` §7 wants S3-compatible storage with
  signed URLs and virus scanning; generated ZIPs currently go to a directory on disk.
- **Nobody has run this stack by hand.** CI now drives a browser through the whole public loop,
  which is a real improvement on unit tests alone — but no person has clicked through it, and no
  email has ever been sent. That is still the largest gap between "tests pass" and "it works", and
  phase 5 of START-HERE anticipates it: *run a real event and fix what breaks.*

### Requested, specced, not built

**Collaboration on a draft** — comments, presence and per-form view/comment/edit access, in the
manner of Google Docs and Forms. Written up as `SPEC-forms.md` §3b and placed at A13b in the
roadmap. It was not in any spec before; it is now.

Two honest notes on it. First, the autosave built in phase 3a is last-write-wins, which is exactly
wrong once two people share a draft — so this is not additive, it changes something that already
exists. Second, real-time co-editing is the largest single feature in the product; the spec starts
at a soft lock for that reason, and a three-person team will not notice the difference.

### After that

`docs/ROADMAP.md` describes Track A phases A2–A14 and the whole of Track B. **Do not start them
from the roadmap.** START-HERE is explicit that the specs are seductive and that v0.2 scope comes
from watching the first real user work around the tool:

> Ask the user what they actually did outside the tool — spreadsheet exports, manual chasing,
> things they worked around. That list, not this document, is your v0.2 scope.

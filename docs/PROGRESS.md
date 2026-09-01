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

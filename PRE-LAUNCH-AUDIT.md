# Pre-launch audit — Phase 0

**Status: Phase 0 complete. No code changed.** Captured against `a17dffc` on `main`.

Evidence for every claim below is a file path, a command output, or a screenshot in the baseline
set. Where something could not be determined from the repository it says so rather than guessing.

> **The brief's "Fill this in before starting" block was submitted empty.** Nine of its answers
> are facts about a business that no amount of reading the code can produce. They are collected
> under [Decisions needed from you](#decisions-needed-from-you) and several of them block Phase 2
> outright.

---

## 1. Stack map

| Layer          | What it is                                                           | Evidence                                                |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Repo           | pnpm workspace, 10 packages                                          | `pnpm-workspace.yaml`                                   |
| Frontend       | React + Vite 6.4.3, SPA with an SSR entry for public pages           | `apps/forms`, `src/entry-server.tsx`                    |
| Service worker | `vite-plugin-pwa`, `generateSW`, precaches 47 entries                | `apps/forms/vite.config.ts`                             |
| Backend        | Fastify + `@fastify/helmet`, `@fastify/multipart`                    | `apps/api-forms/src/server.ts`                          |
| Database       | PostgreSQL 16 (ICU `sv-SE` collation) via Drizzle                    | `docker-compose.yml`, `apps/api-forms/src/db/schema.ts` |
| Migrations     | `drizzle-kit`, `pnpm db:migrate`                                     | `apps/api-forms/package.json`                           |
| Auth           | Magic link → bearer access + refresh token. **No passwords stored.** | `apps/api-forms/src/auth/service.ts`                    |
| Documents      | Playwright/Chromium renders PDFs in-process                          | `apps/api-forms/src/documents/render.ts`                |
| Mail           | `console` or Amazon SES, region `eu-north-1` (Stockholm)             | `.env.example`, `apps/api-forms/src/mail/`              |
| Second product | `apps/mailer` + `apps/api-mailer` (Mailer)                           | `pnpm-workspace.yaml`                                   |
| Shared         | `packages/{tokens,i18n,ui,calc,shared}`                              | —                                                       |

### Things that are absent, which is itself the finding

| Thing                                 | Status          | Evidence                                                              |
| ------------------------------------- | --------------- | --------------------------------------------------------------------- |
| Analytics / telemetry                 | **None**        | no analytics package; no external origin in client                    |
| Cookies                               | **None at all** | no `document.cookie`, no cookie plugin registered; `LEGAL-REVIEW.md`  |
| Payment provider                      | **None**        | no Stripe/Klarna/Swish anywhere                                       |
| Third-party embeds / iframes          | **None**        | —                                                                     |
| External script, style or font origin | **None**        | grep for `https?://` in client source returns nothing but `localhost` |
| AI features                           | **None**        | no `openai`/`anthropic`/`llm`/chatbot references                      |
| Browser-exposed env vars (`VITE_*`)   | **None**        | no `import.meta.env` usage                                            |

**Fonts are self-hosted and byte-inlined.** `packages/tokens/src/fonts.ts` reads
`@fontsource/inter` `.woff2` files from `node_modules` and emits `@font-face` with the bytes as a
`data:` URI. Nothing is fetched from Google Fonts or any CDN. This removes a third-country
transfer question from Phase 2.1 before it is asked.

---

## 2. Personal data inventory

Source: `apps/api-forms/src/db/schema.ts`. 25 tables; those holding personal data:

| Table                                   | Personal data                                                | Subject         | Retention in code |
| --------------------------------------- | ------------------------------------------------------------ | --------------- | ----------------- |
| `users`                                 | `email`, `name`                                              | Operator        | **None**          |
| `loginTokens`                           | `requestedIp`, email                                         | Operator        | Token TTL only    |
| `refreshTokens`                         | `userAgent`                                                  | Operator        | Token TTL only    |
| `auditLog`                              | `ip`, actor id, action                                       | Operator        | **None**          |
| `submissions`                           | `data` (**arbitrary respondent answers**), `email`, `locale` | Respondent      | **None**          |
| `formUploads`                           | Respondent-uploaded files                                    | Respondent      | **None**          |
| `checkIns`                              | Attendance fact + time                                       | Respondent      | **None**          |
| `messages`                              | Recipient address, subject, body                             | Either          | **None**          |
| `invoices`, `invoiceLines`              | Recipient name, email, postal address, amounts owed          | Tenant/customer | **None**          |
| `billingRecipients`, `recipientCharges` | Name, address, reference, charges                            | Tenant/customer | **None**          |
| `events`                                | `venueName`, `venueAddress`                                  | Organisation    | **None**          |

**The widest exposure is `submissions.data`.** It is a free-form JSON blob whose shape is set by
whoever built the form, so the operator — not this codebase — decides what personal data enters
it. A form author can create fields collecting anything, including special-category data under
GDPR Art. 9. That is a product-design fact with a compliance consequence and is listed for you
below.

**Retention: nothing is deleted on a schedule anywhere.** The only automatic expiries are magic
link, refresh token and resume token TTLs. `purge` exists but is a manual bin-emptying operation.
This matches what `LEGAL-REVIEW.md` already states and is a Phase 2 blocker, not a Phase 1 one.

**Data leaving the EEA:** on current evidence, **none by default.** SES is pinned to
`eu-north-1`. Fonts are local. There is no CDN, analytics, or error monitoring. The one genuinely
open question is the database and application host, which is undecided — see below.

---

## 3. Site classification

| Question                                 | Answer                                                                                                                                                                                                                     | Basis                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Sells to consumers?                      | **Not from this codebase.** No checkout, price, or payment provider exists. The invoicing feature bills _the operator's_ tenants; it is not the product's own commerce. **The product's own commercial model is unknown.** | grep; `LEGAL-REVIEW.md` lists pricing as unwritten |
| User accounts / logins?                  | **Yes.** Two roles (`admin`, `operator`), magic-link sign-in.                                                                                                                                                              | `apps/api-forms/src/db/schema.ts:34`               |
| User-generated content?                  | **Yes, but not a UGC platform.** Operators author forms; respondents submit answers and files. Content is not published to other users, so there is no public feed to moderate.                                            | routes; `submissions`, `formUploads`               |
| Physical-location business?              | **Cannot determine.**                                                                                                                                                                                                      | —                                                  |
| Under 10 employees / under €2m turnover? | **Cannot determine.**                                                                                                                                                                                                      | —                                                  |
| AI features exposed to users?            | **No.**                                                                                                                                                                                                                    | grep                                               |
| Marketing email?                         | **Cannot determine.** `apps/api-forms` sends transactional mail only (magic links, confirmations, invoices). `apps/api-mailer` is a campaign product whose use is a business decision.                                     | `apps/api-forms/src/mail/`                         |

**Consequences of the above, if the answers hold:** DSA does not apply (no public UGC). AI Act
does not apply (no AI). NIS2 almost certainly does not apply. Distansavtalslagen,
prisinformationslagen and GPSR apply **only if** you sell to consumers, which is unanswered.

---

## 4. "Before" state — baseline captured

36 full-page screenshots: **18 templates × 2 viewports** (1280×800 and 375×812), captured with the
Playwright already in the repo against `pnpm demo`.

- Images + `baseline.json`: `…/scratchpad/baseline/` (path in the session summary below)
- Templates: home, 2 feature pages, about, faq, privacy, cookies, terms, login, public form,
  invoice, 404, and six app screens (events, forms, responses, invoices, users, brand).

**Results: 36/36 rendered, 0 errors, 0 pages with horizontal overflow at 375px.**

> ⚠️ **The baseline is a dev-server capture and under-reports the public pages.** `pnpm demo`
> runs Vite, which serves the SPA shell for site routes; the SSR entry only runs in the built
> container. So every site page in the baseline shows the old working-name shell title. That is an
> artefact, **not** a production bug — `entry-server.tsx:31` does emit per-page meta. Phase 4's
> SEO checks must be run against the built image, not the demo.

### One real finding the baseline led to

`metaFor()` in `apps/forms/src/entry-server.tsx:31` special-cases `/features/*` and returns a
single default for everything else. In production that means **home and all five legal pages share
one `<title>` and one meta description** — six pages, one title. Phase 4 item 10. Length is fine
(44 chars); uniqueness is not.

---

## 5. Styling inventory

| Question                            | Answer                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token layer?                        | **Yes**, and a strong one. `packages/tokens` compiles one JSON token set to CSS custom properties (`--tp-*`), inline email styles, print CSS, and native values. |
| Component library?                  | `packages/ui` exists; the app also has **29 local components** in `apps/forms/src/components`.                                                                   |
| Ad-hoc CSS?                         | **One 5,060-line `apps/forms/src/styles.css`**, heavily commented, largely written against `var(--tp-*)`.                                                        |
| Hard-coded values bypassing tokens? | Rare and mostly deliberate (national flag colours; two `rgb(0 0 0 / …)` scrims). A prior pass moved the flag radius and hairline onto tokens.                    |

**Verdict: the restyle is a token swap plus a targeted rewrite, not a rebuild.** Colour, type,
spacing and radius all flow from `packages/tokens`, so a new palette and type scale propagate
without touching components. What a fortune-teller direction genuinely requires is new work rather
than re-skinning: the fold/motion system, the mark, and the geometry of surfaces. Budget Phase 3
as "tokens change cheaply, motion and identity are built from scratch".

The 5,060-line stylesheet is the main risk: it is one file with no module boundaries, so a
redesign touches it everywhere at once.

---

## 6. Functional regression list

To be re-run at the end of Phase 3. **e2e covers 2 of these 14.**

| #   | Flow                                                         | Entry                    | e2e?                         |
| --- | ------------------------------------------------------------ | ------------------------ | ---------------------------- |
| 1   | Public form: complete, submit, get reference                 | `/f/:slug`               | ✅ `e2e/public-form.spec.ts` |
| 2   | Public form: switch language mid-flow without losing answers | `/f/:slug`               | ✅ same                      |
| 3   | Public form: validation errors shown and announced           | `/f/:slug`               | ⚠️ partial                   |
| 4   | Public form: file upload and signature capture               | `/f/:slug`               | ❌                           |
| 5   | Save-and-resume via emailed link                             | `/f/:slug?resume=`       | ❌                           |
| 6   | Check-in: scan a QR at the door, camera path                 | `/events/:id/check-in`   | ✅ `e2e/check-in.spec.ts`    |
| 7   | Magic-link sign-in → session → sign out                      | `/login`                 | ❌                           |
| 8   | Build a form from the wizard                                 | `/forms`                 | ❌                           |
| 9   | Build a form from a template, edit fields, publish           | `/forms/:id`             | ❌                           |
| 10  | Publish blocked on incomplete translations, and the override | `/forms/:id`             | ❌                           |
| 11  | Responses: view, filter, export CSV                          | `/forms/:id/submissions` | ❌                           |
| 12  | Admission PDF generated and downloaded                       | `/events/:id/attendance` | ❌                           |
| 13  | Invoice: open the tenant page and download the PDF           | `/i/:token`, `/invoices` | ❌                           |
| 14  | Brand kit: change palette and see it applied                 | `/brand`                 | ❌                           |

---

## 7. Security posture — baseline only, nothing changed

Recorded now so Phase 1 measures against it.

| Control                                     | Present today                                                                                                                                            | Evidence                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| CSP                                         | **Yes**, restrictive and written against what the app loads: `script-src 'self'`, no external origins, `frame-ancestors 'none'`, `font-src 'self' data:` | `server.ts:144`              |
| HSTS                                        | Production only                                                                                                                                          | `server.ts`                  |
| `nosniff`, `Referrer-Policy`                | Yes (helmet)                                                                                                                                             | `server.ts`                  |
| Permissions-Policy                          | Yes — camera granted to the door screen only                                                                                                             | `server.ts` onSend hook      |
| CORS                                        | Scoped to `APP_URL`                                                                                                                                      | `server.ts`                  |
| Rate limiting                               | Yes on public routes (e.g. invoice page 60/min, invoice PDF 12/min)                                                                                      | `routes/public-*.ts`         |
| Cookies                                     | **N/A — none set.** Auth is bearer-token.                                                                                                                | verified                     |
| Input validation                            | **Zod on routes**, schema-first                                                                                                                          | every `routes/*.ts`          |
| Uploads                                     | Content-sniffed type allow-list, size cap, regenerated names, stored outside web root                                                                    | `uploads/attachment.ts`      |
| Passwords                                   | **N/A** — magic link only, nothing to hash                                                                                                               | `auth/service.ts`            |
| `.env` gitignored, `.env.example` committed | Yes                                                                                                                                                      | `.gitignore`, `.env.example` |
| Secrets committed in working tree           | **None found**                                                                                                                                           | `git ls-files` scan          |
| **Secret scanning in CI**                   | ❌ **Absent**                                                                                                                                            | `.github/workflows/ci.yml`   |
| **Dependency audit in CI**                  | ❌ **Absent**                                                                                                                                            | same                         |
| **Dependabot / Renovate**                   | ❌ **Absent**                                                                                                                                            | no config                    |
| **`/.well-known/security.txt`**             | ❌ **Absent**                                                                                                                                            | `apps/forms/public/`         |
| **`robots.txt` / `sitemap.xml`**            | ❌ **Absent** (Phase 4)                                                                                                                                  | same                         |
| Git history secret scan                     | ⏳ **Not yet done** — Phase 1                                                                                                                            | —                            |
| Backups / tested restore                    | ⏳ Cannot assess — no host chosen                                                                                                                        | —                            |

---

## 8. Decisions needed from you

### Blocking Phase 2 — these cannot be drafted around

1. **Registered company name, organisationsnummer, registered address.**
2. **Contact address**, and a separate one for privacy requests.
3. **Database and application hosting provider and region.** Still undecided; it has blocked
   deployment since the demo phase (`docs/DEPLOY.md`). The privacy page cannot state where data
   lives until this exists, and it is the only open third-country-transfer question.
4. **Retention periods**: how long submissions, uploads, audit logs and closed accounts are kept.
   Nothing is deleted on a schedule today, so each answer becomes a scheduled job.
5. **Do you sell to consumers?** Determines whether 2.4 (distansavtalslagen, prisinformationslagen,
   ARN/ODR, GPSR) applies at all.
6. **Employee count and turnover** — decides the EAA microenterprise exemption. Build to WCAG 2.1
   AA regardless.
7. **Whether a DPO is appointed.**
8. **Domain**, and canonical host (www vs apex).
9. Whether `apps/api-mailer` will send **marketing** email in production (triggers 2.5).

### Needs your decision, not blocking

10. **Lighthouse is not installed.** Adding it is a dependency question, which the brief says to
    ask about. Options: add it as a dev dependency, run it via `npx` in CI only, or skip formal
    Lighthouse and use the bundle-size and render measurements already available.
11. **Should the baseline screenshots be committed?** They currently live in the session
    scratchpad and will not survive. Phase 3 needs them for comparison.
12. **A form author can collect any personal data they like**, including special-category data.
    Whether to constrain that in-product (a field-level warning, a prohibited-field list) or to
    handle it contractually is a product decision with a GDPR consequence.

### Already answered by the repo — no action needed

- Cookie banner: **not required as the software stands.** No cookies, no analytics, no third-party
  script, no external origin. This is verified, not assumed. It stops being true the moment
  analytics is added in Phase 4 — which is why 2.2 and Phase 4 item 18 must be decided together.
- Font transfers: none. Self-hosted and inlined.
- `LEGAL-REVIEW.md` already lists **22 pending facts** rendered as visible amber markers on the
  five policy pages, so those pages cannot be mistaken for finished. Phase 2 should extend that
  file rather than duplicate it.

---

## 9. Phase status

| Phase        | Status          | Note                                                                                                            |
| ------------ | --------------- | --------------------------------------------------------------------------------------------------------------- |
| 0 — Audit    | ✅ **Complete** | This document                                                                                                   |
| 1 — Security | ⏳ Not started  | Gaps already identified: CI secret scanning, dependency audit, `security.txt`, git-history scan, backup/restore |
| 2 — Legal    | 🚫 **Blocked**  | On items 1–7 above                                                                                              |
| 3 — Restyle  | ⏳ Not started  | Token layer makes it cheaper than feared; motion and identity are new build                                     |
| 4 — Polish   | ⏳ Not started  | `robots.txt`, `sitemap.xml`, duplicate titles, analytics decision                                               |

---

# Phase 1 — Security

Branch `phase-1-security`. `pnpm verify` green, 1226 tests (up from 1210).

## Threat model, in one paragraph

The most likely attacker is not after this product's data. **Every public form is a machine that
turns an anonymous HTTP POST into an outbound email from a verified Swedish sending domain, and —
where the form has an event — into a Chromium PDF render.** No account, no CAPTCHA, no proof of
work. The prize is the customer's domain reputation and somebody else's inbox; the cost is paid in
their SES quota and CPU. Second is a data-motivated attacker after `submissions.data`, which holds
whatever a form author chose to ask for. Third, and cheapest to attempt, is an operator reading a
colleague's data through a route that checks the organisation but not the form. Credential
stuffing is designed out — there are no passwords — so what replaces it is mailbox compromise and,
much more cheaply, denial of the sign-in channel itself. The highest-value asset is `JWT_SECRET`:
it signs operator sessions, signs every bulk-export download URL, and is the HKDF master for
admission QR codes. One variable, three jobs.

## Fixed in this phase

| #   | Severity                | Issue                                                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                                   | Evidence                                |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | **High**                | **Tokens written to logs in cleartext on every request.** Bodies and headers are never logged, which is what hid this — but Fastify logs `req.url`, and `/i/<token>`, `/…/resume/<token>` and the signed document download carry the credential _in the path_. Tokens are hashed at rest, so the log was the only place they appeared in the clear. | `log-redaction.ts` redacts by shape before the line is written, keeping a 4-char prefix so an incident can still correlate two lines. | 13 tests                                |
| 2   | **Medium**              | **5xx responses returned `error.message` from the layer below — which is Postgres.** A constraint violation would have replied with the constraint name, the column and the value.                                                                                                                                                                  | `setErrorHandler`: 5xx logs in full, returns one sentence.                                                                            | `error-shape.test.ts`, via a real route |
| 3   | **Medium**              | **Unhandled errors broke the API's own contract**, answering Fastify's `{statusCode, error, message}` instead of `{error:{code,message}}`, so a client reading `body.error.code` got `undefined`.                                                                                                                                                   | Same handler.                                                                                                                         | same                                    |
| 4   | **High** (supply chain) | `drizzle-orm@0.38.4` — GHSA-gpj5-g38j-94v9, SQL injection via `sql.identifier()`/`.as()`. **Not exploitable here**: neither API is used anywhere and every `sql` template uses bound parameters. It would have been the moment somebody wrote `sql.identifier(sortField)`.                                                                          | Upgraded to `^0.45.2`; `pnpm audit` clean.                                                                                            | audit output                            |
| 5   | Medium                  | No secret scanning and no dependency audit in CI.                                                                                                                                                                                                                                                                                                   | New `supply-chain` job: gitleaks over full history, `pnpm audit --audit-level high`, ahead of the slow suite.                         | `.github/workflows/ci.yml`              |
| 6   | Medium                  | No automated dependency updates.                                                                                                                                                                                                                                                                                                                    | `.github/dependabot.yml`, grouped weekly so the queue stays readable.                                                                 | —                                       |
| 7   | Low                     | No `security.txt`, no written incident procedure.                                                                                                                                                                                                                                                                                                   | `/.well-known/security.txt` and `SECURITY.md` — 72-hour IMY clock, containment order, rotation runbook.                               | —                                       |

### One secret is in public git history

`demo-mode-secret-not-for-production-use-only-here` — a fallback `JWT_SECRET` used by demo mode
when the variable was unset. Added `1e8d57a`, removed `7048bc5`. Anyone could have minted an admin
session against a demo running without an explicit secret. **Current code is unaffected and
nothing is deployed**, so there is nothing to rotate — but no image built before `7048bc5` may
ever be run. Left in history deliberately: rewriting published history breaks every clone, and the
fix for a leaked credential is rotation, not deletion. Detail in `SECURITY.md`.

## Found and **not** fixed — these need your approval first

The brief says to show diffs before touching auth, personal data or consent logic. All of these
do. Ranked by what they expose.

| #   | Severity   | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Proposed fix                                                                                                                                                   |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **High**   | **Rate limits key on the socket IP and `trustProxy` is unset.** Behind a TLS terminator — which production will have — every client shares one bucket, so six requests per 15 minutes disable sign-in for the entire tenant. Magic link is the only door.                                                                                                                                                                                                                                                                                  | A `TRUST_PROXY` env var. **Blocked on the hosting decision**: the correct value is the hop count, and setting it blindly lets clients spoof `X-Forwarded-For`. |
| 9   | **Medium** | `POST /v1/forms/:id/admission-documents` **skips the form access check** — any signed-in operator can bulk-export every registrant of a colleague's form. Every other form route funnels through `resolve()`; this one does not.                                                                                                                                                                                                                                                                                                           | Route it through `resolve()` like its siblings.                                                                                                                |
| 10  | **Medium** | `GET /v1/events/:id/attendance` returns **every registrant's name and email** to any signed-in user, past the form-ownership boundary.                                                                                                                                                                                                                                                                                                                                                                                                     | Same access check, or restrict to admin.                                                                                                                       |
| 11  | **Medium** | `POST /public/forms/:slug/draft` **mails an attacker-chosen address** and has neither guard its sibling has — no `availability.open` check, no honeypot. This is the spam-relay path from the threat model.                                                                                                                                                                                                                                                                                                                                | Add both guards to match the submit route.                                                                                                                     |
| 12  | **Medium** | **Anonymous uploads have no sweeper and no quota.** The schema cuts an index for the sweep (`form_uploads_unclaimed_idx`, commented "finding what to sweep") — the index exists, the job does not. Unbounded anonymous disk growth.                                                                                                                                                                                                                                                                                                        | Write the job the index was cut for. Also a Phase 2 retention item.                                                                                            |
| 13  | Low        | `GET /v1/submissions/:id/admission.pdf` and the attachment download are scoped to the **organisation, not the form** — same class as 9 and 10.                                                                                                                                                                                                                                                                                                                                                                                             | Same access check.                                                                                                                                             |
| 14  | Low        | `GET /v1/invoices` has no role check and returns every invoice's permanent `publicToken`. Tenant scoping is correct; the concern is handing operators links that let anyone read a tenant's invoice.                                                                                                                                                                                                                                                                                                                                       | Restrict to admin, or omit `publicToken` from the list.                                                                                                        |
| 15  | Low        | `body.eventId` is written onto a form **without checking the event belongs to the caller's organisation**.                                                                                                                                                                                                                                                                                                                                                                                                                                 | An org-scoped `events.findById` before the write.                                                                                                              |
| 16  | Low        | **One secret does two jobs**: `JWT_SECRET` is used verbatim as the HMAC key for download URLs. The admission QR derives its key with HKDF; this does not. Rotating the signing secret silently invalidates every outstanding download link.                                                                                                                                                                                                                                                                                                | Derive it, as the QR path already does.                                                                                                                        |
| 17  | Info       | **The public surface is single-tenant.** `/f/:slug` resolves the organisation as `organisations.first()`. Authenticated routes isolate correctly; public ones assume one organisation. Fine today, wrong the day a second customer is onboarded.                                                                                                                                                                                                                                                                                           | Architectural — resolve the tenant from the slug or the host.                                                                                                  |
| 18  | Info       | **The web app ships no font files.** The default stack is `Inter, ui-sans-serif, system-ui, …` and there is no `@font-face` anywhere in `apps/forms` — `document.fonts` is empty on a fully loaded page. `@fontsource/inter` is a dependency of `packages/tokens` and is used **only** by the PDF target, which embeds it. So an invoice is set in Inter and the page that produced it is set in Segoe UI, SF Pro or Roboto depending on who is looking, and `DESIGN.md`'s type scale was tuned against a typeface the web never delivers. | Ship the font the stack already claims, or stop claiming it. Needs a dependency decision.                                                                      |

## Verified good — evidence, not assurance

- **No cross-organisation IDOR.** All 40 routes traced to the query behind them; every
  caller-supplied id is scoped by `organisationId`, and the guard takes the organisation from the
  database rather than from the JWT claim. The few unscoped repository methods are reachable only
  after an org-scoped lookup of the parent row.
- Bodies and headers are never logged — Fastify's default serializer emits method, URL and remote
  address only, so form answers and the `Authorization` header never reached the log.
- Tokens are stored hashed; refresh tokens rotate and detect reuse by family.
- No user enumeration: `requestMagicLink` returns 202 whether or not the address exists.
- Zod validation on every route; uploads are magic-byte sniffed with content-hash filenames.
- CSP is restrictive and real: `script-src 'self'`, no external origins, `frame-ancestors 'none'`.
- Demo mode's authentication bypass is structurally gated — registered only when `options.demo` is
  constructed, which only `demo/main.ts` does, and that refuses to boot as production without a
  second explicit variable.

## Left for Phase 1 completion

- Items 8–17, pending your approval.
- **Backups and a tested restore** — impossible before a host exists.
- MFA on admin accounts. There are no passwords, so this means a second factor on the magic link:
  a product decision, not a fix.

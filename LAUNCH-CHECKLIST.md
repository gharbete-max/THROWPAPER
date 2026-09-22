# Launch checklist

Everything that is temporary, unconfigured, unconfirmed or deliberately deferred, in one place.
Maintained by hand; when an item is done, delete the row rather than ticking it, so the file only
ever lists what is still open. Last reviewed **2026-09-21** in L0 of the local track
(`claude/l0-baseline`); the measured baseline behind that review is `docs/PROGRESS.md` § L0.

Three columns: **what**, **where it lives**, **who decides**. "You" is the product owner; "code"
means an engineering task with no decision attached; "counsel" is a lawyer.

---

## 1. Blocks launch — the site or the product says something untrue without these

### 1.1 Placeholder text rendered to the public

Every `pending('…')` in [`apps/forms/src/site/legal.ts`](apps/forms/src/site/legal.ts) renders on
the policy pages as an amber **"to be confirmed: …"** marker. They stay visible until a human
replaces them; nothing is invented. Full list and the questions behind each in
[`LEGAL-REVIEW.md`](LEGAL-REVIEW.md).

| What                                                                                                                                                        | Where                               | Who                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Registered company name and organisation number (the controller)                                                                                            | `legal.ts:56`                       | you                                                                                    |
| Contact address for privacy requests; general contact address                                                                                               | `legal.ts:57`, `:84`                | you                                                                                    |
| Registered address                                                                                                                                          | `legal.ts:83`, `:226`               | you                                                                                    |
| Database hosting provider and region (also blocks the deployment — §3.1)                                                                                    | `legal.ts:130`, `:201`              | you                                                                                    |
| Retention periods: submitted responses; data after account closure                                                                                          | `legal.ts:193-194`, `:332`          | you, then code (each becomes a scheduled job — nothing is deleted on a schedule today) |
| Complete sub-processor list                                                                                                                                 | `legal.ts:202`                      | you                                                                                    |
| Legal bases per processing purpose                                                                                                                          | `legal.ts:209`                      | counsel                                                                                |
| Data protection officer, or a statement that none is appointed                                                                                              | `legal.ts:228`                      | you                                                                                    |
| Confirmation that no consent banner is required (the "no cookies" position)                                                                                 | `legal.ts:272`                      | counsel                                                                                |
| Terms: pricing, billing period, payment terms, tax treatment                                                                                                | `legal.ts:314`                      | you                                                                                    |
| Terms: contract term, renewal, cancellation                                                                                                                 | `legal.ts:315`                      | you                                                                                    |
| Terms: availability commitment, or a statement that none is given                                                                                           | `legal.ts:316`                      | you                                                                                    |
| Terms: support scope and response times                                                                                                                     | `legal.ts:317`                      | you                                                                                    |
| Terms: limitation of liability                                                                                                                              | `legal.ts:323`                      | counsel                                                                                |
| Terms: governing law and venue                                                                                                                              | `legal.ts:324`                      | counsel                                                                                |
| Policy pages are **English in every language** by design (rule 8: no machine-translated legal text). Swedish/Danish/Norwegian/German versions need a human. | `Site.tsx` `LegalPage`, footer note | you + counsel                                                                          |
| "Last reviewed {date}" on each policy is the `UPDATED` constant in `legal.ts` — set it when counsel signs off                                               | `legal.ts:63`                       | you                                                                                    |

### 1.2 Claims on the marketing site that need to be true, or changed

| What                                                                                                                                                                                                                                                  | Where                                             | Who    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| **"Twelve languages"** is the lead feature; the _site_ publishes in five (`SITE_LOCALES`). The product does ship twelve. Decide whether the copy means the product (true) or implies the site (not yet) — or finish the other seven site translations | `copy/en-GB.ts` hero + features; `site/locale.ts` | you    |
| **Testimonials** are attributed to roles, not people, and presented as real. If illustrative, the eyebrow ("What people said afterwards") must say so; if real, get permission to name them                                                           | `copy/*.ts` `quotes`                              | you    |
| "The demo saves nothing and sends nothing" in the footer — true only while `DEMO=true`. Reword or drop when the demo is retired                                                                                                                       | `copy/*.ts` `chrome.footerTagline`                | you    |
| No pricing anywhere on the site. The contact page is the only way onward. Decide whether that is the launch position                                                                                                                                  | `Site.tsx` CTA panel                              | you    |
| `og:image` is `/icon-512.png` (the mark on a tile). A proper social card (1200×630) has not been made                                                                                                                                                 | `entry-server.tsx`                                | design |

### 1.3 Environment and connectors that are empty or local-only

Documented in [`.env.example`](.env.example) and [`docs/DEPLOY.md`](docs/DEPLOY.md). None has a
safe default; the server refuses or degrades loudly when they are missing.

| What                                                                                                                                                                                         | Effect if unset                                                                                                          | Who                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `CONTACT_TO` — where the site's "Get in touch" form goes                                                                                                                                     | Form answers **503**; message is not swallowed                                                                           | you                                 |
| `MAIL_PROVIDER=ses`, `MAIL_REGION`, `MAIL_FROM` (verified sender)                                                                                                                            | `console` provider logs instead of sending: **no email reaches anybody**                                                 | you + ops                           |
| **SES production access** — a new account delivers only to verified addresses; has a turnaround                                                                                              | Confirmation mails to real members bounce                                                                                | you (request early)                 |
| **Sending domain verification** — SPF, DKIM, DMARC published, then the in-app verification screen                                                                                            | Sending is refused with no override                                                                                      | ops                                 |
| `MAIL_OPERATOR` — where new-registration notifications go                                                                                                                                    | Organiser is not told about registrations                                                                                | you                                 |
| `MAIL_CONFIGURATION_SET` — SES event stream for bounces/complaints                                                                                                                           | No bounce handling (B11, not built)                                                                                      | ops                                 |
| `JWT_SECRET` ≥ 32 chars, generated per environment                                                                                                                                           | Server refuses to start                                                                                                  | ops                                 |
| `DOCUMENT_SIGNING_SECRET` ≥ 32 chars, generated per environment, not equal to `JWT_SECRET`                                                                                                   | Server refuses to start                                                                                                  | ops                                 |
| `APP_URL` — public origin; magic links and CORS depend on it                                                                                                                                 | Sign-in links point at localhost                                                                                         | ops                                 |
| `TRUST_PROXY` — which forwarders to believe about the visitor's address. `loopback` is proven for ngrok on the laptop (`docs/PROGRESS.md` § L2); a host's TLS terminator needs its own value | Unset behind a TLS terminator, every visitor shares one rate-limit bucket: **six requests lock everyone out of sign-in** | ops, when a host exists             |
| `DATABASE_URL` — Postgres                                                                                                                                                                    | Nothing runs                                                                                                             | ops                                 |
| `DOCUMENT_DIR` — where PDFs are written. A local directory, a stopgap until an object store is chosen                                                                                        | Documents live on one container's disk and die with it                                                                   | you (choose a store)                |
| Asset store for uploaded logos/images is likewise **local disk** (`createLocalAssetStore`)                                                                                                   | Same                                                                                                                     | you                                 |
| `DEMO` / `DEMO_ALLOW_PRODUCTION` must be **unset** in production                                                                                                                             | Demo routes and the in-memory database would be live                                                                     | ops                                 |
| Client-mode identity, invoices and the public form are **single-tenant**: `organisations.first()` (audit item 17)                                                                            | Correct with one customer; wrong the day a second is onboarded — needs a host-based tenant lookup                        | code, when a second customer exists |

---

## 2. Should be fixed before launch — the product works, but a real user will hit these

### 2.1 Security and data (from `PRE-LAUNCH-AUDIT.md`, items 8–17 — each needs your approval before the diff is written)

| #   | What                                                                         | Severity |
| --- | ---------------------------------------------------------------------------- | -------- |
| —   | Backups and a tested restore — impossible before a host exists               | —        |
| —   | MFA on admin accounts (a second factor on the magic link) — product decision | —        |

### 2.2a Deferred engineering, tracked so it cannot expire quietly

| Sev | Owner       | Status | What                                                                                                                                                                                                                                                                                                                                                                                               | Where                                                         |
| --- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| P2  | Engineering | Ready  | The in-memory job repository stamps `runAfter` with `new Date()` while `claim` takes `now` as an argument, so a test can inject a clock into the worker and silently not into the repository. That asymmetry is what made the stale-lease tests pass only before 10:00 UTC on the day they were written (`docs/PROGRESS.md` § Phase 1). Both tests are fixed; the asymmetry that allowed it is not | `apps/api-forms/src/db/repositories/memory.ts` `jobs.enqueue` |

Deferred on purpose in the P0 branch — giving `createMemoryRepositories` a clock touches a test
double used across ~100 test files, which is the wrong blast radius for a branch whose job was to
turn `main` green. It is here rather than in the pull request that deferred it because a deferral
recorded only in a PR body is how a decision becomes permanent by accident — the same failure
`docs/adr/0005-dependency-majors.md` now carries a date to prevent.

### 2.2 Temporary and literal strings in the app

Empty. The demo brand kit row closed on 2026-09-22 (`docs/PROGRESS.md` § S5): the seed writes a
kit, its border clears 3:1, and `apps/api-forms/src/demo/brand.test.ts` holds it there.

### 2.3 Open findings from the app-shell critique

The eight rows the 2026-09-22 morning re-run measured closed in the door-readiness pass the same
day (`docs/PROGRESS.md` § S2); the evening re-run's snapshot is the latest
`…apps-forms-src-screens-checkin-tsx.md` in `.impeccable/critique/`, and the P0 palette pass added
the last two. **Ten rows, none closed here.**

Rows 1 and 2 are two halves of one finding — the sentence and the mechanism behind it — which is
why the brief counts three live P1s and this table shows four. **Severity** is the critique's own
where it marked one. **Status** is only whether engineering can start: every row in §2 is
"should be fixed before launch", so none of them blocks launch on its own — §1 is the list that
does.

| Sev | Owner       | Status                         | What                                                                                                                                                                                                                                      | Where                                            |
| --- | ----------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| P1  | Owner       | Blocked — the wording is yours | The not-found verdict now echoes what was refused; the one sentence that tells the operator what to do next (a typo, or the wrong queue) is yours to word                                                                                 | `screens/CheckIn.tsx` `Verdict`                  |
| P1  | Owner       | Blocked — product decision     | No in-product remedy after "not found": no name lookup, no manual admit; "Leave the door" lands on a report with no search — a product decision (does a name lookup live inside the door?) beside the sentence above                      | `screens/CheckIn.tsx`, `screens/EventReport.tsx` |
| P2  | Engineering | Ready                          | A server fault while online renders "Not found" (the submit `catch` maps every non-network error to it): a `failed` outcome that keeps the field's value                                                                                  | `screens/CheckIn.tsx` `submit`                   |
| P2  | Engineering | Ready                          | Bottom-bar nav labels are 10.24px at 375 (detector: six `undersized-ui-text`, below the 11px floor)                                                                                                                                       | `styles.css` `.nav-link` under 64rem             |
| P2  | Engineering | Ready                          | The confirmation's reference — the credential the door relies on — is the smallest thing on the card (16px, muted)                                                                                                                        | `screens/PublicForm.tsx` done card               |
| P3  | Engineering | Ready                          | Full date in the verdict's "arrived at" line and the recent rows; the five arrivals are component state and vanish on reload; "Start camera" has no `aria-pressed` and the `<video>` no name (P3)                                         | `screens/CheckIn.tsx`                            |
| P2  | Engineering | Ready                          | **P2, measured 2026-09-22:** the verdict panel's fixed height holds at 375 (224px in all four states) but not at 1280, where "already" is 194.78px against 176px — the panel jumps between the admit and the repeat scan                  | `styles.css` `.verdict`                          |
| P2  | Engineering | Ready                          | **P2, measured 2026-09-22:** `/responses` at 375 clips by the same mechanism as the door's row — 13 `text-overflow` hits on `inbox__who`, `inbox__form` and `inbox__reference`; the reference is the field that matches a human to a card | `styles.css` `.inbox__*`                         |

### 2.4 Open findings from the site critique on the Loppa palette (2026-09-22, 23/32)

Measured on the gold palette; neither hover state is new with it, both were measured for the first
time. The snapshot is `2026-09-22T12-22-52Z__apps-forms-src-site-site-tsx.md`.

| What                                                                                                                                                                                             | Where                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **P2** The folded-corner chips are 12% gold over platinum: 1.08:1 light, 1.24:1 dark. Gold belongs in a fill, not a 12% wash                                                                     | `styles.css` `.feature-card__mark`         |
| **P2** The site's h1s are the ink while the app's take `--tp-colour-heading` (gold in dark) — app and site disagree; and the band eyebrow's derived `#836f53` / `#9a794d` is a tone nobody chose | `styles.css` `.hero__title`, `.site__band` |

---

## 3. Decisions that are yours, not engineering's

| Decision                                                   | Context                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hosting provider and region** for app + database         | Blocks deployment, backups, and the privacy page. Only open third-country-transfer question. `docs/DEPLOY.md`                                                                                                                                    |
| **Domain and canonical host** (www vs apex)                | `APP_URL`, SES domain verification, `hreflang` URLs                                                                                                                                                                                              |
| **Whether you sell to consumers**                          | Decides if distance-selling and price-information rules apply (`LEGAL-REVIEW.md`)                                                                                                                                                                |
| **Employee count and turnover**                            | Decides the EAA micro-enterprise exemption; build to WCAG 2.1 AA regardless                                                                                                                                                                      |
| **Whether the mailer sends marketing email in production** | Triggers consent requirements (`LEGAL-REVIEW.md` §2.5)                                                                                                                                                                                           |
| **Site display typeface**                                  | Inter shipped; Source Serif 4 / Fraunces / Atkinson proposed for a later pass                                                                                                                                                                    |
| **Whether the marketing site defaults to dark**            | Answered for the product (2026-09-22): light default, dark derived. The site is the one surface where the critique argues the other way — gold is 2% of a light page and the identity is strongest on near-black (`docs/brand/START-HERE.md` §5) |
| **Special-category data** collected by form authors        | Constrain in-product or contractually (audit decision 12)                                                                                                                                                                                        |
| **Lighthouse in CI**                                       | Add as dev dependency, run via `npx` in CI, or rely on existing bundle/render measurements (audit decision 10)                                                                                                                                   |
| **Commit visual-regression baselines**                     | Screenshots currently live in session scratch (audit decision 11)                                                                                                                                                                                |
| **Analytics**                                              | None today, which is why no cookie banner is needed. Adding any changes the privacy page and the banner position together                                                                                                                        |

---

## 4. Deferred with reasons — see `docs/adr/0001-theming-layers.md` § Deferred

Typed CLIENT/FORM contract objects; tenant-by-host; touch icon compositing (iOS stretches a
non-square logo); `outline`/`soft` email buttons on a pastel; `.rise` stagger past six.

---

## 5. Before the first real event (from `docs/DEPLOY.md`)

1. SES production access granted.
2. Sending domain verified (SPF, DKIM, DMARC) in the in-app screen.
3. A confirmation sent to a real Gmail and a real Outlook address, and neither in spam.
4. A QR admission card scanned with a phone, at a door, by the person who will do it on the day.
5. `CONTACT_TO` set and a test message received.
6. Every "to be confirmed" marker gone from `/privacy`, `/terms`, `/cookies`, `/about`, `/faq`.

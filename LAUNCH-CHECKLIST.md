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

| #   | What                                                                                | Severity |
| --- | ----------------------------------------------------------------------------------- | -------- |
| 12  | Anonymous uploads have no sweeper and no quota (the index exists, the job does not) | Medium   |
| 15  | `body.eventId` written to a form without checking the event belongs to the caller   | Low      |
| 16  | `JWT_SECRET` doubles as the HMAC key for download URLs                              | Low      |
| —   | Backups and a tested restore — impossible before a host exists                      | —        |
| —   | MFA on admin accounts (a second factor on the magic link) — product decision        | —        |

### 2.2 Temporary and literal strings in the app

| What                                                                                                                                                                                                                                                                           | Where                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `placeholder="AB12-CD34"` on the door's reference field — a literal, not a message key; also no `autoCapitalize="characters"` / `enterKeyHint="go"`                                                                                                                            | `screens/CheckIn.tsx:226`                                             |
| `placeholder="https://"` on URL fields in the builder                                                                                                                                                                                                                          | `builder/FieldProperties.tsx:269`, `builder/FormSettingsPanel.tsx:82` |
| `EventForm` shows the literal `load-failed` when the event list cannot be fetched, and labels translation fields with raw locale codes (`sv-SE`)                                                                                                                               | `screens/EventForm.tsx:55`, `:105`                                    |
| "Development mode: the link is printed in the api-forms console" — now gated on `import.meta.env.DEV`; confirm it never appears on the deployed sign-in                                                                                                                        | `screens/Login.tsx`                                                   |
| The demo brand kit ("Demo AB", navy `#1b263b`, border `#ddd6c8` at 1.28:1) is what every "Open the demo" lands in. Decide whether the demo should show Loppa's own palette or a customer's. The Postgres seed writes no brand kit at all (`CLAUDE.md` §Demo data asks for one) | `apps/api-forms/src/demo/dataset.ts`; `db/seed.ts`                    |

### 2.3 Open findings from the second design critique (P2, not yet actioned)

Snapshot: `.impeccable/critique/2026-09-15T07-51-16Z__apps-forms-src-site-site-tsx.md`.

| What                                                                                                                                                                             | Where                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| "Read more" on feature cards is 4.35:1 on the card surface (12.8px); related-feature links on feature pages and the 404 are seafoam at 2.12:1                                    | `styles.css` `.feature-card__more`, `.site__more a`             |
| `<Reveal>` renders a `<div>` between `<ul>` and `<li>` on Responses — invalid list, and the row dividers never match                                                             | `screens/Inbox.tsx`, `components/Signed.tsx`                    |
| The door never names its event; a wrong event id renders a working-looking door that says "Not found" to every scan                                                              | `screens/CheckIn.tsx`                                           |
| At 375px the idle verdict wraps and the panel shrinks 178 → 152 on the first scan                                                                                                | `styles.css` `.verdict--idle`                                   |
| Five "Undo" buttons share one accessible name; `aria-label` on a `<p>`; `<video>` unnamed; `EventForm` error lacks `role="alert"`; no `aria-current` on the active site nav link | `screens/CheckIn.tsx`, `screens/EventForm.tsx`, `site/Site.tsx` |
| Refocusing the reference input after every scan raises the Android keyboard over the viewfinder                                                                                  | `screens/CheckIn.tsx`                                           |
| The 494 KB hero loop is fetched on every phone without reduced motion; only the 2x is width-gated                                                                                | `site/Site.tsx` `<source>`                                      |
| Confirmation screen drops the form title and never says a card or email is coming                                                                                                | `screens/PublicForm.tsx`                                        |
| Feature-page paragraphs run ~88 characters per line at 1280                                                                                                                      | `styles.css` `.site__article`                                   |

---

## 3. Decisions that are yours, not engineering's

| Decision                                                   | Context                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Hosting provider and region** for app + database         | Blocks deployment, backups, and the privacy page. Only open third-country-transfer question. `docs/DEPLOY.md`             |
| **Domain and canonical host** (www vs apex)                | `APP_URL`, SES domain verification, `hreflang` URLs                                                                       |
| **Whether you sell to consumers**                          | Decides if distance-selling and price-information rules apply (`LEGAL-REVIEW.md`)                                         |
| **Employee count and turnover**                            | Decides the EAA micro-enterprise exemption; build to WCAG 2.1 AA regardless                                               |
| **Whether the mailer sends marketing email in production** | Triggers consent requirements (`LEGAL-REVIEW.md` §2.5)                                                                    |
| **Site display typeface**                                  | Inter shipped; Source Serif 4 / Fraunces / Atkinson proposed for a later pass                                             |
| **Special-category data** collected by form authors        | Constrain in-product or contractually (audit decision 12)                                                                 |
| **Lighthouse in CI**                                       | Add as dev dependency, run via `npx` in CI, or rely on existing bundle/render measurements (audit decision 10)            |
| **Commit visual-regression baselines**                     | Screenshots currently live in session scratch (audit decision 11)                                                         |
| **Analytics**                                              | None today, which is why no cookie banner is needed. Adding any changes the privacy page and the banner position together |

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

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/title/vector/loppa-lockup-h-dark.svg">
    <img src="docs/brand/title/vector/loppa-lockup-h-light.svg" width="420" height="139" alt="Loppa">
  </picture>
</p>

<p align="center">
  A lightweight helper for office documents — forms, scans, signing and sending — that works on your own computer.
</p>

---

**Loppa** is a lightweight helper for office documents: the most-used basics, not Acrobat. It is
built as a room of three independent tools; only the first, **Documents**, is built. Spreadsheets
and Presentation & planning are floating placeholders. Documents has four parts and a centre:

- **Forms** — build a form one question at a time (the guided builder) or by hand, fill it in or
  fill a PDF's own fields, and keep it as a PDF without publishing anything.
- **Scan** — photos, phone scans, PDFs and Word files (a rough conversion) become pages you put
  together, take out, turn and reorder; add, cover, replace or truly redact a PDF's text; read a
  supplier invoice on the device.
- **Sign** — typed or drawn signatures on a PDF, sealed with an audit page.
- **Send** — messages wait in _To send_ and open as drafts in your own mail program; SMTP and a
  test-mode outbox are under Advanced. Sending one document to several people, and a personalised
  PDF each from a list, are in progress and not yet on `main`.
- **Summary and translation** (the centre) — a local, offline model on your own computer, desktop
  only. The model (about 6 GB) is never in the installer; it is the separate **AI pack** (see
  _Getting the AI pack_ below), fetched after you confirm or opened offline from a folder.

Collecting answers from other people is optional ("Share to collect"). It runs in a browser against
a server, or entirely on one computer as a desktop app. What is built and what is not:
`docs/HANDOVER.md`.

## Download

|                          |                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** 10/11        | [Loppa-Windows-Setup.exe](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-Windows-Setup.exe) — installer · [portable .exe](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-Windows-Portable.exe) — no install |
| **macOS**, Apple Silicon | [Loppa-macOS-AppleSilicon.dmg](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-macOS-AppleSilicon.dmg)                                                                                                                                  |
| **macOS**, Intel         | [Loppa-macOS-Intel.dmg](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-macOS-Intel.dmg)                                                                                                                                                |
| Checksums                | [SHA256SUMS.txt](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/SHA256SUMS.txt) — every release, [all releases](https://github.com/gharbete-max/THROWPAPER/releases)                                                                         |

**The builds are not code-signed yet** (that needs the publisher's certificates). On Windows,
SmartScreen warns the first time: _More info → Run anyway_. On a Mac, the first time, right-click
Loppa and choose _Open_. Check a download against `SHA256SUMS.txt` with `Get-FileHash <file>`
(Windows) or `shasum -a 256 <file>` (macOS).

### Installing

- **Windows:** run `Loppa-Windows-Setup.exe`; it installs for your user, no administrator needed.
  The portable `.exe` runs from anywhere and keeps its data in the same place.
- **macOS:** open the `.dmg`, drag Loppa to Applications, then right-click → _Open_ the first time.
- **Getting the AI pack** (optional; Loppa works without it; needs about 12 GB of memory). The pack is
  the model and its projector, cut into parts under 2 GiB with a SHA-256 each, in its own release
  (`ai-pack-*`). Either press _Get_ under _AI models_ in the summary centre (it names GitHub and the
  size and waits for your press), or download the files yourself, put them in one folder with
  `PACK.json`, and choose `PACK.json` with _Open a file from disk_: that path is fully offline
  (a USB stick works). Loppa joins and checks every part against hashes in its own code before it
  uses anything. Details: `docs/DEPLOY.md`.
- First start asks for your organisation's name and your own, or offers the demo data. Nothing is
  sent anywhere to set up.

## What happens when somebody fills in a form

1. They open the form's link, answer (in any of twelve languages), and send it.
2. The confirmation shows their reference and prepares **their finished document**: a PDF of the
   form's title, when it was sent, the reference and every question they were shown with their
   answer. A form made from paper comes back as that paper, filled in.
3. **Download PDF**, **Open** it, or **Email it**:
   - where the device can share files (phones, Safari, Edge), the share sheet sends the PDF
     attached;
   - **Open my email app** writes the message — but a web page _cannot_ attach a file to an email,
     so the page says to attach the downloaded PDF, by name;
   - **Copy message text** for webmail;
   - in the **desktop app**, _Open a draft in Outlook / Apple Mail_ puts the PDF in a new message
     for you to address and send. Nothing is ever sent without you pressing Send.
4. A refresh keeps the confirmation; **Fill in again** starts a fresh copy for the next person.

The organisation downloads the same document from the response's row.

## Local, offline, and what needs the internet

|                                      | Browser + server      | Desktop app                                                                                                                                  |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Forms, answers, finished PDFs        | yes                   | yes, offline                                                                                                                                 |
| Where data lives                     | the server's Postgres | `%APPDATA%\Loppa\workspace` (Windows), `~/Library/Application Support/Loppa/workspace` (macOS); _File → Open data folder_, _File → Back up…_ |
| Email out                            | SMTP or Amazon SES    | a test-mode outbox of `.eml` files (default), your SMTP, or your own Outlook / Apple Mail                                                    |
| Signing (typed or drawn, sealed PDF) | Loppa Sign service    | yes, offline, on this computer                                                                                                               |
| National e-ID (BankID and similar)   | not connected yet     | not connected yet                                                                                                                            |
| Summary and translation              | not offered           | yes, offline, with a model file (about 2.5 GB, never in the installer) that you open from disk; the download release is not cut yet          |
| Scan with a phone                    | yes                   | yes, over your local network while a scan is open                                                                                            |

**e-ID:** the identity-provider interface exists (`packages/signing/src/providers.ts`), but no
provider is connected; nothing in Loppa claims anybody's identity was verified. Choosing a broker
is an owner decision (`docs/adr/0010`).

## Run it from source

Requires Node ≥ 20 and pnpm 9 (`corepack enable`).

```bash
pnpm install
pnpm demo                                    # in memory: no database, nothing saved, nothing sent
pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev:forms   # against a real Postgres
pnpm --filter @tp/desktop start              # the desktop app, unpackaged
```

`pnpm demo` starts Forms in memory with the demo dataset: the Demo AB brand kit, one event with
~200 registrations and the form that collected them. `pnpm dev:forms` / `pnpm dev:mailer` /
`pnpm dev:sign` run each product on its own.

```bash
pnpm verify          # format + typecheck + lint + test + build
pnpm contract:check  # all three backends against docs/CONTRACT.md
pnpm test:e2e        # Playwright against a real Postgres; exits 2 if it could not run
```

## Build and release the desktop app

`pnpm --filter @tp/desktop package:win` / `package:mac` build installers locally (a zip when not on
that OS). Releases come from `.github/workflows/desktop.yml`: bump `apps/desktop/package.json`'s
version, push a tag `desktop-v<that version>`, and the workflow builds Windows and both Macs,
smoke-tests that each app starts, and publishes a GitHub release with stable file names and
`SHA256SUMS.txt`. Signing turns on when the certificate secrets exist (`LAUNCH-CHECKLIST.md` §6).

## Security

Reporting: `SECURITY.md`. In short: magic-link sign-in with bearer and rotating refresh tokens, no
cookies, a strict CSP; the desktop's local servers answer only on 127.0.0.1 and only to their own
host name; its windows have no Node access and the one settings bridge answers only its own page.
The respondent's document link is a one-day credential for that submission only, never put in a URL.

## Products in this repository

Forms and **Sign** each run on their own and talk only through the HTTP contract in
`docs/CONTRACT.md`, never a shared database. **Mailer** (email campaigns) is a stub: the mail work
is built inside Documents' Send part (`docs/HANDOVER.md`). The earlier events, check-in, invoices
and ledger stay in place, out of the room, until the catchers they belong to exist.

## Layout

```
apps/forms        Forms — React, SSR, Vite
apps/api-forms    Forms backend
apps/mailer       Mailer
apps/api-mailer   Mailer backend
apps/sign         Sign — the signer's page (typed or drawn signature, decline)
apps/api-sign     Sign backend — envelopes, audit trail, signing by link, PAdES sealing (P1c-1..4a)
apps/desktop      Loppa desktop (Windows, macOS) — Forms and Sign in an Electron window, offline first
packages/tokens   Design tokens → CSS vars, inline email styles, print CSS. Contrast guard lives here
packages/i18n     Translation catalogues and ICU collation
packages/ui       One `cn()` helper; the data grid is deliberately not in v0.1
packages/calc     Calculation errors, exact money, the ledger
packages/shared   Types and Zod schemas, including the contract schemas
packages/signing  The signing model: levels, envelopes, the audit-trail state machine
docs/brand        The Loppa brand bundle: tokens, motion CSS, marks, lockups, animations (rasters in Git LFS)
```

## Read in this order

0. `CLAUDE.md` — the short, always-loaded rules.
1. `docs/VISION.md` — what Loppa is, in the owner's words. It wins over older documents.
2. `docs/HANDOVER.md` — current state and where to pick up; `docs/plan/DOCUMENTS.md` is the plan.
3. `LAUNCH-CHECKLIST.md` — everything still temporary, unconfigured or waiting on a decision.
4. `docs/CONTRACT.md` — the API between the products. Frozen before either side writes code.
5. `docs/adr/` — the decisions with long-term consequences, one file each.
6. `docs/SPEC-shared.md`, `docs/SPEC-forms.md`, `docs/SPEC-mailer.md`, `docs/ROADMAP.md` —
   reference from the earlier product, consulted when a choice is hard to reverse.
   `docs/START-HERE.md` is retired history.

## Rules that apply to every change

- The products never import each other (`eslint.config.js` enforces it). If you want to, the contract is missing something.
- API-first, bearer + refresh token auth. Every screen calls a documented endpoint.
- No hard-coded colours, fonts, spacing or user-facing strings — tokens and i18n only.
- Exact arithmetic: decimal or bigint for money, quantities and measurements. Never floats.
- Locale-aware sorting (Swedish å ä ö after z; Danish/Norwegian æ ø å). Numeric columns sort
  on the number, never the formatted string.
- Nothing sends or deletes without a confirmation step; every outbound action has a test mode.
- No generated legal, clinical, tax or safety-critical wording. Templates come from a human.

Internal identifiers, package names, database tables and API routes keep the `throwpaper` /
`@tp/*` names on purpose. Only user-facing strings say Loppa.

## Brand

The mark is a folded paper fortune-teller in gold and platinum. Gold measures 2.14:1 on white,
so the identity is at its strongest on near-black; on light surfaces text takes the bronze tier
(`#8F6B3A`, 4.64:1), never the face gold. The bundle — tokens, usage rules, marks, motion — is in
`docs/brand`; `packages/tokens` ships those values and `DESIGN.md` records why. See `SECURITY.md`
for reporting.

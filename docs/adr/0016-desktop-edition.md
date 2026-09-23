# ADR 0016 — Loppa for Windows: the whole Forms product on one PC, offline first

**Status:** proposed — D1 built on `claude/local-exe-offline-mode-u0ap32`; the open questions at the
end are the owner's
**Date:** 2026-09-23

## Context

The owner asked for a downloadable `.exe` that runs Loppa **fully locally** — build forms, fill
them in, scan paper, produce documents, send email — with AI and signing each offering **"connect
online"** or **"work in cloud (placeholder)"**, and for the local version to be planned out far
enough to know whether it is viable.

What the repository already had that makes this cheaper than it sounds:

- **Seams everywhere the host matters.** `buildServer` takes its repositories, mail provider,
  document store, asset store, upload store and PDF renderer as options. Demo mode and the tests
  already swap all six. A desktop edition is a seventh set of parts, not a fork.
- **Scanning already runs on the device.** Paper import (`pdfjs`), the four-corner warp and OCR
  (`tesseract.js`, twelve languages, self-hosted under `apps/forms/public/ocr/`) are browser code
  that never calls a server (ADR 0004). They work offline today.
- **The API serves the built app** (`SERVE_APP`), so one process is the whole product.
- **No external origins.** No CDN, no analytics, fonts inlined. Nothing in the web app needs the
  internet to render.

What it did not have:

- **A database that installs with an app.** Everything is Postgres, through Drizzle, with sixteen
  SQL migrations. Asking a Windows user to install and run Postgres is not an app.
- **Any way to send mail except SES or a log line.** `CLAUDE.md` rule 2 promised a direct-SMTP
  fallback; `mail/provider.ts` had `console`, `memory` and `ses`. The promise was not true.
- **A sign-in that works without mail.** Magic link is the only door (ADR 0002).
- **A window.**

## Decision

### Shape: Electron around the existing app, one process

```
Loppa.exe (Electron)
├── main process (Node 24 inside Electron)
│   ├── api-forms buildServer(...) on 127.0.0.1:47017   ← the same server the container runs
│   │   ├── repositories  → Drizzle → PGlite (Postgres 18 in WebAssembly), %APPDATA%\Loppa\workspace\database
│   │   ├── documents, uploads, assets → workspace\documents\
│   │   ├── mail → outbox (.eml files, test mode) | the user's SMTP server
│   │   └── PDFs → Playwright driving the Edge every Windows has
│   └── shell: first run, settings, backup, menu, OS password store (DPAPI)
├── main window  → http://127.0.0.1:47017  (apps/forms, unchanged, no preload, no bridge)
└── panel window → first run / settings (apps/desktop/src/panel, the only window with a bridge)
```

- **Electron over Tauri or a Node single-executable.** Tauri needs Rust and a sidecar Node for the
  API anyway; a Node SEA cannot load PGlite's WebAssembly or Playwright from inside the binary and
  still needs a browser for the UI. Electron runs the API in its own Node and gives the window for
  free. Cost: ~150 MB of Chromium in the installer. Accepted.
- **PGlite over SQLite.** PGlite is real Postgres compiled to WebAssembly. **All sixteen migrations
  and every Drizzle repository run on it unchanged** — `db/pglite.test.ts` seeds the full demo
  through the repositories, claims a job with `update … returning`, and reopens a directory to
  prove persistence. SQLite would have meant a second schema, a second set of queries and a second
  place for the products to disagree. The only code change the repositories needed was widening
  `Db` from "postgres.js" to "Drizzle's Postgres dialect" (`db/types.ts`).
- **Edge for PDFs.** The Docker image carries Playwright's Chromium; the desktop does not ship a
  second browser. `createPdfRenderer` now takes a browser choice, and the desktop tries
  `msedge` → `chrome` → Playwright's own → fails with a message naming the fix. An explicit
  browser path in Settings beats all three.
- **Bound to 127.0.0.1, fixed port 47017.** Loopback only: nothing on the LAN can reach it. Fixed,
  because the browser keys storage and the signed-in session on the origin; a random port would
  sign the user out at every launch.

### What works with no network at all (D1, built and measured)

| Area | How | Evidence |
| --- | --- | --- |
| Forms: build, publish, fill in, validate, save-and-resume, submissions, CSV/XLSX export | The unchanged app and API | Playwright drove first run → signed in → public form → registration, against the packaged Linux build of the same bundle |
| Events, admission PDFs with QR, invoices, check-in | Unchanged; PDFs through Edge/Chrome | The packaged app rendered an admission card; its text reads "Björn Ödlund … Näringslivets Hus, Göteborg" |
| Scanning paper | `pdfjs` + warp + `tesseract.js` in the window, models self-hosted | Already offline by design (ADR 0004); the web bundle ships inside the app |
| Camera (QR at the door, photographing a page) | Electron grants `media` to our origin only | `limitPermissions()` in `main.ts` |
| Email, test mode | Every message becomes an `.eml` in `workspace\outbox`, attachment included — double-click opens it in Outlook | `mail/smtp.test.ts`; the packaged app wrote the confirmation with the PDF attached |
| Email, real | The user's own SMTP server (STARTTLS required, or implicit TLS on 465), password kept by DPAPI | `mail/smtp.test.ts`, `settings-form.test.ts` |
| Drawn signatures on forms | The existing signature field (vector path + PNG) | Unchanged |
| Sign-in | The shell mints an ordinary magic link — hashed, single use, 15 minutes — and opens it itself | `desktop/start.test.ts` exchanges it through `/v1/auth/token`, and a replay fails |
| Backup | Stop the server, copy the workspace folder, restart | File menu → Back up… |

### AI and signing: off/local, connect online, work in cloud (placeholder)

Each is a three-way choice in Settings, stored in `workspace\settings.json`:

| | Off / local (default) | Connect online | Work in cloud (placeholder) |
| --- | --- | --- | --- |
| **AI** | Nothing is sent anywhere | An endpoint the user names. **Recorded; nothing calls it** until P5 builds `AiProvider` (ADR 0013) with its refusals and consent | A hosted Loppa account this PC would sync with. Nothing connects |
| **Signing** | Drawn signatures only | A Loppa Sign server the user names. **Recorded; nothing calls it** until P1c/P2 implement contract §5 | Same placeholder |

The screen says, in both languages, that the online option is not available yet and nothing is
sent. That is deliberate: a switch that silently does nothing is a lie, and a switch that does
something before ADR 0013's consent and counsel's privacy page exist is worse.

**The seam that makes "connect online" real later** is the one CONTRACT.md already has: the
desktop is a Forms deployment, and Forms talks to Sign over §5 with a service token. Pointing that
at a remote `api-sign` is configuration, not architecture. AI follows ADR 0013's `AiProvider`,
constructed from the desktop's settings instead of the environment.

### Viability — the honest version

**Viable for:** one organisation on one PC — an association's secretary, a small workshop, an event
organiser on a laptop at the door — who wants their data on their own machine, works offline, and
sends from their own mailbox.

**Where a local-only product runs out, stated rather than discovered:**

1. **Public forms need a public address.** A form served from `127.0.0.1` can only be filled in on
   that PC — fine for a kiosk, a tablet at the door on the same machine, or data entry from paper;
   useless for "email everyone a link". This is exactly what "work in cloud" is for: publish the
   form to a hosted Loppa, pull the answers back. Until then, the desktop is for forms filled in
   *on this machine*. (A "share on my network" switch that binds the LAN is possible, but a LAN
   exposure without HTTPS and with magic-link auth needs its own threat model — not in D1.)
2. **Email from a PC lands in spam** unless the SMTP account's domain has SPF, DKIM and DMARC. The
   existing sending-domain check still applies to SMTP (it is exempt only for the outbox), so the
   product refuses rather than burns the user's domain. With Gmail or Microsoft 365 this means an
   app password or an SMTP-AUTH-enabled account — support documentation, not code.
3. **One seat.** One PGlite directory, one process (Electron's single-instance lock enforces it).
   Two people on two PCs are two separate Loppas. Collaboration is the cloud's.
4. **Unsigned installers warn.** SmartScreen says "Windows protected your PC" until the owner buys
   an OV/EV code-signing certificate. The release workflow is ready to sign; it has nothing to
   sign with.
5. **Updates.** D1 has none: a new version is a new installer, which keeps the data (uninstall
   leaves `%APPDATA%\Loppa`) and migrates it on first start (migrations run at every boot — safe
   here because one process owns the directory, unlike the server, see `DEPLOY.md`).
6. **Size.** ~206 MB zipped: ~150 MB Electron, ~45 MB OCR models, the rest the app. Normal for an
   Electron app; the OCR models are the obvious diet if it matters.
7. **PGlite is younger than Postgres.** It is Postgres' own code, but its WebAssembly packaging is
   0.x. Mitigations: backups are a folder copy; the desktop database is the same schema as the
   server's, so a `pg_dump`-compatible export to a hosted Loppa is a straight path (D4).

### Security posture

- API on loopback only; CORS scoped to its own origin; the existing rate limits, CSP and helmet
  headers unchanged.
- The main window has **no preload and no Node** (`contextIsolation`, `sandbox`); it is a web client
  like any other (rule 3). Only the panel window has a bridge, and it exposes five calls.
- Navigation away from our origin opens the user's browser instead; new windows are allowed only
  for our own pages. Device permissions: camera for our origin, nothing else.
- Secrets (`JWT_SECRET`, `DOCUMENT_SIGNING_SECRET`) are generated per install, stored `0600`
  beside the data, never constants. The SMTP password is DPAPI-encrypted; the panel never receives
  it back.
- No first-run endpoint (ADR 0002 stands): the first organisation is created in-process by the
  person who launched the program, the same position as whoever runs `pnpm db:seed`.
- Rule 7: mail starts in test mode; leaving it for real sending needs a confirmation tick, enforced
  in the main process, not only the form (`settings-form.ts`).

## Phases

**D1 — Local core. Built on this branch.**
PGlite driver and tests; SMTP and outbox providers (rule 2 made true, for the server too:
`MAIL_PROVIDER=smtp|outbox`); `api-forms` desktop entry (`startDesktopServer`, and a headless
`pnpm --filter @tp/api-forms desktop` for any OS); `apps/desktop` Electron shell with first run,
demo data, settings (mail, AI, signing, PDF browser), backup, menu; packaging via a staging folder
and electron-builder; `desktop.yml` builds the NSIS installer and portable `.exe` on
windows-latest, launches `Loppa.exe` and waits for `/health`, and publishes both on a `desktop-v*`
tag.

**D2 — Everyday polish.** Restore from backup; auto-update (electron-updater against GitHub
releases — needs the signing certificate first, or updates are unsigned too); a "send a test
email" button and SMTP presets for Microsoft 365 / Gmail / one.com; `.eml` → "open outbox" shown in
the app after each send in test mode; tray icon; the shell's strings moved into `@tp/i18n` with the
product's other ten locales.

**D3 — Scanner hardware.** The web path already takes files and the camera. Windows scanners
speak WIA/TWAIN; a small native bridge (WIA via PowerShell/COM, no native Node module) exposes
"Scan from scanner…" to the paper importer. Measured against ADR 0004's miss-rate question first.

**D4 — Connect online / cloud.** Contract-first: the desktop as a Forms deployment talking to a
hosted Sign over §5, and to a hosted Loppa via a sync contract that does not exist yet (publish a
form; pull its submissions; idempotent on submission id, the same property that made offline
check-in cheap). Export/import of a whole workspace as the first, dumbest sync.

**D5 — AI online.** ADR 0013's `AiProvider`, built from desktop settings; the placeholder in
Settings becomes a real switch only after counsel's privacy page and the org-level opt-in exist.
A local model (e.g. via an OpenAI-compatible local server the user runs) fits the same seam and
keeps "no data leaves the PC" true — worth measuring, because it matches this edition's promise.

**D6 — Mailer locally.** When Track B's B2–B6 exist, the same shell can host `api-mailer` on a
second loopback port. Products still talk only through the contract (rule 1); the shell is the
only thing that knows both are there.

## Consequences

- `apps/desktop` sits inside the **Forms** product boundary in `eslint.config.js`: it may run
  `api-forms`, never Mailer or Sign.
- `pnpm build` now stages the desktop (esbuild + Vite + an `npm install` of three runtime packages
  into `.stage/`); packaging an installer is a separate command. CI sets
  `ELECTRON_SKIP_BINARY_DOWNLOAD` everywhere except `desktop.yml`.
- New dependencies, all permissive (ADR 0015): `@electric-sql/pglite` (Apache-2.0), `nodemailer`
  (MIT-0, now on the allowlist — MIT without the attribution clause), `electron` (MIT),
  `electron-builder` (MIT; its filename sanitiser `truncate-utf8-bytes` is WTFPL and allowed **by
  name** as a build tool that never ships), `esbuild` (MIT).

## Open — the owner's

1. **Is local-only a product, or the offline half of the hosted one?** It decides whether D4 is
   the next phase or a someday. Everything in D1 is needed either way.
2. **A code-signing certificate**, or Microsoft's Trusted/Artifact Signing service, and whose name
   is on it — the same legal entity question as `LAUNCH-CHECKLIST.md` §1.1. Current SmartScreen
   reputation rules and prices change; verify them when buying rather than trusting this line.
3. **Distribution:** GitHub releases (built), the marketing site, the Microsoft Store (removes
   SmartScreen friction, adds review), or all three.
4. **Pricing and licensing of a local copy.** A one-off purchase, a subscription with the cloud as
   the value, or free as the on-ramp to hosted. This decides whether the app needs a licence key,
   which D1 deliberately does not have.
5. **macOS.** Electron builds it from the same code; it needs a Mac or a hosted macOS runner and an
   Apple Developer ID to notarise (the same account question as ADR 0014's iOS builds).

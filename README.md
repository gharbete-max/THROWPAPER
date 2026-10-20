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

**Loppa** is a lightweight, local-first helper for office documents: the most-used basics, not
Acrobat. It is a room of three independent tools; only the first, **Documents**, is built.
Spreadsheets and Presentation & planning are placeholders. Documents has four parts and a centre:

- **Forms** — build a form one question at a time or by hand, fill a PDF's own fields, keep the result
  as a PDF. Collecting answers from other people ("Share to collect") is optional.
- **Scan** — photos, phone scans, PDFs and Word files (a rough conversion) become pages you arrange;
  filters, a digital copy, a searchable PDF, text edits and true redaction, supplier-invoice reading.
- **Sign** — your own signature kept on this computer, placed on a PDF and sealed with an audit page.
- **Send** — one document, a personalised PDF each from a list, or a plain-text campaign; messages
  wait in _To send_ or go through test mode or your own SMTP. Nothing sends without a confirmation.
- **Summary and translation** (the centre) — an optional model on your own computer, desktop only.

**Status:** Documents is built; the desktop app (Windows, macOS) is the product, the hosted web
edition is secondary. The builds are unsigned and macOS, 8–12 GB laptops and CPUs without AVX2 are
untested. Nothing leaves the computer unless you press and confirm; there is no telemetry. What is
built and what is not: `docs/HANDOVER.md`, `docs/MAP.md`.

**Using it:** [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md).

## Download

|                          |                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** 10/11        | [Loppa-Windows-Setup.exe](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-Windows-Setup.exe) — installer · [portable .exe](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-Windows-Portable.exe) — no install |
| **macOS**, Apple Silicon | [Loppa-macOS-AppleSilicon.dmg](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-macOS-AppleSilicon.dmg)                                                                                                                                  |
| **macOS**, Intel         | [Loppa-macOS-Intel.dmg](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/Loppa-macOS-Intel.dmg)                                                                                                                                                |
| Checksums                | [SHA256SUMS.txt](https://github.com/gharbete-max/THROWPAPER/releases/latest/download/SHA256SUMS.txt) — every release, [all releases](https://github.com/gharbete-max/THROWPAPER/releases)                                                                         |

**The builds are not code-signed yet.** On Windows, SmartScreen warns the first time: _More info →
Run anyway_. On a Mac, right-click Loppa and choose _Open_ the first time. Check a download against
`SHA256SUMS.txt` with `Get-FileHash <file>` (Windows) or `shasum -a 256 <file>` (macOS).

## The AI model files and the AI pack

AI is optional; Loppa works fully without it. The full model needs about 12 GB of memory; smaller
tiers exist. The model is never in the installer (the Windows installer carries only `llama-server`).
Either choose a tier under _AI models_ and confirm the download (it names the host, huggingface.co, and
the size), or open a **pack** offline: the model files cut into parts under 2 GiB with a SHA-256 each,
plus `PACK.json`, chosen with _Open a file or an AI pack from disk_. Loppa joins and checks every part
before using anything. Building and publishing a pack: `docs/DEPLOY.md` (last section); the design:
`docs/adr/0025-single-multimodal-model.md`. In development, `LOPPA_AI_DIR` or `LOPPA_MODEL_PATH` point
a run at files.

## For developers

Start with [`docs/MAP.md`](docs/MAP.md): vision, rules, where to look per area, commands, quirks. The
short always-loaded rules are in `CLAUDE.md`; the owner's words are in `docs/VISION.md`.

Requires Node ≥ 20 and pnpm 9 (`corepack enable`).

```bash
pnpm install
pnpm demo                                    # Forms in memory: no database, nothing saved, nothing sent
pnpm --filter @tp/desktop start              # the desktop app, unpackaged
pnpm --filter @tp/desktop package:win        # installer + portable .exe (package:mac for macOS)
pnpm dev:forms                               # the web edition (needs Postgres: pnpm db:migrate && pnpm db:seed)
pnpm verify                                  # format + typecheck + lint + test + build
pnpm contract:check                          # all three backends against docs/CONTRACT.md
pnpm test:e2e                                # Playwright against a real Postgres; one run at a time
```

Releases come from `.github/workflows/desktop.yml`: bump `apps/desktop/package.json`'s version, push
a tag `desktop-v<version>`; the workflow builds Windows and both Macs, smoke-tests each, and publishes
a GitHub release with `SHA256SUMS.txt`. Signing turns on when the certificate secrets exist
(`LAUNCH-CHECKLIST.md`).

## Layout

```
apps/forms        The Documents screens and the room — React, SSR, Vite
apps/api-forms    Forms backend: forms, PDF routes, send, invoicing, phone scan
apps/sign         Sign — the signer's page
apps/api-sign     Sign backend — envelopes, audit trail, PAdES sealing
apps/desktop      Loppa desktop (Windows, macOS) — offline first, hosts Forms and Sign, runs the AI centre
apps/mailer       A stub; mail is built inside Documents' Send
apps/api-mailer   A stub backend
packages/*        tokens, i18n, ui, calc, shared (types, contract, pure cores), signing
docs/brand        The Loppa brand bundle
```

Forms and Sign never import each other; they talk only through `docs/CONTRACT.md`. Internal
identifiers keep the `throwpaper` / `@tp/*` names on purpose; only user-facing strings say Loppa.

## Security

Reporting: `SECURITY.md`. The desktop's local servers answer only on 127.0.0.1 and only to their own
host name; its windows have no Node access. National e-ID is not connected, and nothing in Loppa
claims anybody's identity was verified (`docs/adr/0010`).

## Brand

The mark is a folded paper fortune-teller in gold and platinum. Gold is a fill, never text: on light
surfaces text takes the bronze tier (`#8F6B3A`). The bundle is in `docs/brand`; `DESIGN.md` records why.

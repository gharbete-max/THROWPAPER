# Handover

For a fresh session picking this up. Read `CLAUDE.md` first, then `LAUNCH-CHECKLIST.md`, then
`docs/adr/0001-theming-layers.md`. Do not paste specs into `CLAUDE.md`.

## Paste-ready prompt for the next session

```
You are continuing work on THROWPAPER (product name: Loppa) — a pnpm monorepo with two
independent products (apps/forms + apps/api-forms; apps/mailer + apps/api-mailer) and shared
packages. Read CLAUDE.md, then docs/HANDOVER.md, then LAUNCH-CHECKLIST.md, then
docs/adr/0001-theming-layers.md, then docs/PROGRESS.md from § L0 to the end before touching
anything. Do not re-derive anything HANDOVER marks as established.

State (measured 2026-09-22, late): origin/main at the merge of S2 (claude/l8b-door). Done and
merged: the local track L0–L7 and the site design pass (#87–#95); the app-shell pass (#103); the
restart proof (#104 — SIGKILL survival, orphaned `running` jobs requeued after 15 min,
SIGTERM/SIGINT close the server); dependabot batch two (#105 — #98 merged, four majors closed
per ADR 0005, eight ignored now); S2 the door readiness (nine rows: the door's sizes, header at
375, meta contrast, not-found echo, undo verdict, camera error, the last page that opened marked
wrong — a React node-patching submit —, the thank-you focus, Responses rows, the bulk export that
ran again; plus a 429 that read as "closed"). Shell critique 21 → 23 → 23 → 26 / 40.
`pnpm verify` green (139 test files, 1782 tests), `pnpm test:e2e`
19/19 against the portable Postgres 16 — start command in docs/PROGRESS.md § L0; no Docker on
this machine. It must say "19 passed", not SKIPPED, before anything else is trusted. Site
critique 18 → 22 → 23 → 25 / 32; app shell 21 → 23 → 23 / 40 (snapshot 2026-09-22T02-29-37Z).

Rules that bite: one task per branch, plan mode first, `pnpm verify` and `pnpm contract:check`
before "done"; every fix gets a discriminating test committed red first; never mass-rename
internal identifiers (throwpaper stays throwpaper in paths/tables/routes); no new dependencies
without asking (majors: see ADR 0005); no legal/clinical/tax/safety wording (rule 8); a brand
colour never paints text unchecked — reach for the derived tokens (--tp-colour-heading,
--tp-colour-accent-ink, --tp-colour-accent-on-ink, --tp-focus, --tp-button-*). The owner
dislikes dark teal and the flat mark. Design first, then one ponytail pass; never both in one.

Pick up in this order, one task per session (the owner's order of 2026-09-22 late; the owner
cannot test by hand — Playwright driving real browsers is the acceptance channel):
1. S3 — the simulated user, one loop end to end (branch claude/sim-v01-loop): sign in via the
   console-logged magic link → create the event → build the form in the builder UI → publish →
   fill it as an attendee with save-and-resume → find the confirmation in the console log,
   assert language and attachment → bulk-generate admission PDFs → download the ZIP → decode a
   QR (pdfjs + zxing) → check in typed, scan again, assert the idempotent refusal. Known before
   it starts: bulk generation has NO UI (only POST /v1/forms/:id/admission-documents); the
   public submit is limited to 10/min per address; S3 logs every dead end in PROGRESS.md
   § Simulation findings and fixes only v0.1-loop bugs with red-first tests.
2. S4 — the onboarding wizard (branch claude/wizard): docs/adr/0006-onboarding-wizard.md FIRST
   (owner decision 2026-09-22: Akinator-style onboarding before every feature's deep UI, the
   scanner excepted; composition not retrieval; replace WizardOption.next with a sector-selected
   question set and everyPath() with three invariants as property tests; trades and law blocked
   until a human authors their wording — rule 8), then the form-builder entry only.
3. S5 — the seed's brand kit (branch claude/l10-seed-brandkit): decided — Loppa's palette from
   packages/tokens values, demo/dataset.ts agrees, the border a derived token. Delete the §2.2 row.
4. The §2.3 rows from the S2 re-run (three P1: not-found remedy — the sentence is the owner's;
   the recent row's name at 375; two primaries on the public form's last page) and the P2s.
5. Everything in LAUNCH-CHECKLIST.md §1 and §3 is the owner's to answer, not yours to invent.

The wizard's paper decision exists (owner, 2026-09-22): S4 writes it down as ADR 0006 before any
wizard code. Trades and law stay blocked until a human authors their wording (rule 8).
Do not take a dependency major without reading docs/adr/0005-dependency-majors.md.
```

## State

- `origin/main` at **S2's merge** (2026-09-22, late). No pull requests open. Eight majors are
  closed for the reasons in `docs/adr/0005-dependency-majors.md` and ignored by dependabot.
- **L0–L7, the site pass, the app-shell pass, the restart proof, dependabot batch two and the
  door readiness are done** (#87–#95, #103, #104, #105, S2); `docs/PROGRESS.md` § L0 … § S2 are
  the record. §2.1 holds backups (no host) and MFA (owner decision); §2.2 holds the demo brand
  kit (decided, S5); §2.3 holds the not-found sentence (owner's) and the seven rows the S2
  re-run measured.
- `pnpm verify` green: **139 test files, 1782 tests**, both apps build. `pnpm test:e2e`:
  **19 passed** against the portable Postgres 16 (`docs/PROGRESS.md` § L0 has the start command;
  no Docker on this machine). `pnpm verify` and `pnpm contract:check` together are the
  definition of done.
- Critique trends: site **18 → 22 → 23 → 25 / 32**; app shell **21 → 23 → 23 → 26 / 40**.
- Pre-launch brief phases: **0 (audit) and 1 (security) complete** (`PRE-LAUNCH-AUDIT.md`);
  **2 (EU/Swedish legal) blocked on the owner** (§1.1 of `LAUNCH-CHECKLIST.md`); **3 (restyle)
  complete**; 4 (polish and SEO) not started.
- `LAUNCH-CHECKLIST.md` is the single list of what is still temporary, unconfigured or
  unconfirmed. Delete rows as they close; never tick them.
- The owner cannot test by hand (decision 2026-09-22): the simulated user (S3) is the
  acceptance channel; "ready" is the v0.1 done-means list executed by Playwright.

## House rules that bite

- One phase per branch; commit per item. `pnpm verify` before calling anything done.
- **Evidence, not claims:** a diff, a passing test, or tool output. Never a TODO.
- Ask before adding a dependency, changing the data model, or changing legal copy.
- `CLAUDE.md` rule 8: never generate legal, clinical, tax or safety-critical wording. The proxy
  template shows the pattern — ship structure, leave the operative sentence as an explicit
  bracketed placeholder.
- Windows dev machine. **`&` in npm scripts does not background** (cmd.exe treats it as a
  sequential separator); use `pnpm --parallel`.
- **Verify a test discriminates:** stash the fix, confirm it fails, restore. A test that only
  passes after a fix proves nothing on its own.

## Blocked on the owner — Phase 2 cannot start without these

Registered company name, organisationsnummer and address; contact and privacy-request addresses;
**database and application hosting provider + region** (undecided since the demo phase; blocks the
privacy page and is the only open third-country-transfer question); retention periods per data
type; whether the product sells to consumers; headcount and turnover for the EAA microenterprise
exemption; whether a DPO exists; domain and canonical host; whether `api-mailer` will send
marketing email.

## Facts already established — do not re-derive

- The app sets **no cookies**, has no analytics, no external origins, and self-hosts fonts
  byte-inlined. **No cookie banner is required as the software stands** — that stops being true
  the moment analytics is added, so §2.2 and Phase 4's analytics item must be decided together.
- **No cross-organisation IDOR:** all 40 routes were traced to the query behind them.
- Auth is magic-link only. There are no passwords, so "MFA" means a second factor on the link.
- `LEGAL-REVIEW.md` already lists 22 pending business facts, rendered as visible amber markers on
  the five policy pages. Extend that file rather than duplicating it.
- Fonts: Inter is self-hosted via Fontsource (`@fontsource/inter`, latin subsets precached); the
  CSP still permits no external origins. The transfer answer is still "none".
- Internal identifiers stay `throwpaper` (paths, packages, tables, routes) by the owner's explicit
  instruction; only user-facing text says Loppa.
- The owner dislikes dark teal and the flat mark; a pastel that cannot carry text becomes the ink
  (`headingInk`), never a darkened pastel.

## Next unblocked work — in this order

1. **S3 — the simulated user, one loop end to end**, in the browser, against the portable
   Postgres; findings to `docs/PROGRESS.md` § Simulation findings.
2. **S4 — the onboarding wizard**, ADR 0006 first; the form-builder entry only.
3. **S5 — the seed's brand kit** — decided (Loppa's palette).
4. **The S2 re-run's §2.3 rows** (three P1s, the not-found sentence the owner's).
5. **Phase 4** — polish and SEO. **Backups** stay deferred until there is a host.

---

## The catalogue direction — decided on paper 2026-09-22 (S4 records it as ADR 0006)

The product is to cover forms across verticals — real estate, AGM/EGM, small business, trades,
misc events — through an Akinator-style flow: *"what business are you in"* (including **none**,
which covers misc events), then a multi-select matrix of what the form should contain, then a
composed result, then easy-or-advanced customisation. Community sharing of forms is wanted later.

**This is composition, not retrieval.** You author blocks, not paths, and the millions are
combinations. That distinction matters: an earlier critique in this project claimed the wizard
"will not scale to millions of forms", and that critique was aimed at *selecting one leaf from a
library*. It does not apply to composing a form from selected blocks, which scales on a few dozen
authored blocks.

`packages/shared/src/wizard/tree.ts` **already composes**: `WizardOption.contributes` supplies
items and `WizardTree.keyOf` deduplicates them — *"two paths can both ask for an email address; a
form with two email boxes is a form somebody fills in twice."*

**What must change is the guarantee, not the model.** `WizardOption.next` fixes the question
order, and `everyPath()` — today's proof that no path dead-ends and nothing takes more than four
presses — becomes 2ⁿ once answers are multi-select. So:

- Keep `contributes` and `keyOf`.
- Replace `next` with a sector-selected question **set** (order-independent facets).
- Replace exhaustive path enumeration with three cheaper invariants: every question reachable,
  every contributed key resolvable, and no duplicate keys in any combination.

Two consequences to decide deliberately rather than drift into:

- **Trades and law are safety-critical and legal wording** — rule 8. Ship structure with bracketed
  placeholders, as the proxy template does.
- **Community sharing introduces public UGC**, which flips the Phase 0 classification and brings
  DSA notice-and-action, a published point of contact, moderation terms, and a contribution
  licence. Phase 0 concluded DSA does not currently apply *because* there is no public UGC.

### Verified-MIT resources — never ship anything unverified

`surveyjs/survey-library` (MIT; Creator/PDF/Dashboard are separate commercial products) — **do not
adopt**; it would replace a builder and renderer already translated into twelve languages with
SSR, print CSS and PDF. Take its question-type taxonomy as a checklist and its JSON schema as an
**import target**, which is worth more to a community catalogue than a rendering engine.
`FormBold/html-form-examples-templates` (MIT, no attribution required) — useful as field-list
content, not code. `formml/formml` (MIT) — skip; the Zod `FormDefinition` already covers it. The
other four repositories suggested are irrelevant to a TypeScript stack or actively wrong for it —
in particular a bulk-mail script is the opposite of rule 7 and of marknadsföringslagen.

---

## What Phase 3 landed, and how to work inside it

The planning notes that used to sit here are superseded by the code and by
`docs/adr/0001-theming-layers.md`. The short version:

- **Palette** is the mark's five colours + black and white (`packages/tokens/src/default-tokens.json`).
  The Midnight/Saddle palette survives only as the seeded "Demo AB" kit.
- **Derived tokens** are the mechanism, not the stylesheet: `focusRing`, `buttonSurface`,
  `headingInk`, `accentInk` (and its inverted twin `--tp-colour-accent-on-ink`) in
  `packages/tokens/src/derive.ts`. `locked.test.ts` proves the LOCKED list against six hostile
  kits in both schemes; if you add a guarantee, add it there and verify it by deleting the
  derivation once.
- **The `.system` boundary still governs.** Ours: shell, sign-in, marketing site. Theirs: the
  published form, invoice, admission card, email. The Loppa intro now lives inside the shell
  only — it once leaked over customers' forms; do not move it back up.
- **The marketing site ships no JavaScript in production.** Anything interactive there is CSS
  (`:checked` for the hero pause) or a plain `<form method="post">` (the contact page). A React
  effect in `site/` works in dev and is dead on the live page.
- **The mark** is the rendered PNG/WebP (`public/mark-angled-256.png`, `mark-loop-*.webp`,
  `mark-poster-256.png`); regenerate with `scripts/brand/build-animation-pack.py` (numpy +
  Pillow). The reduced vector drawing exists only for the favicon.
- **Client mode** is server-first: `client-identity.ts` inlines the palette and meta tags so the
  sign-in screen is the customer's from the first byte; `brand.tsx` reads them and never paints
  over a server-painted page until the real kit arrives.
- **Critique method** that worked: `/impeccable critique` with A and B as isolated sub-agents, B
  measuring in a real browser at 1280/375 × light/dark. Both snapshots are in
  `.impeccable/critique/`; the trend is 18 → 22 / 32 on the site, 21 → 23 / 40 in the shell.

Do not run `impeccable` and `ponytail` in the same pass — they pull in opposite directions. Design
first, then a single ponytail pass to remove what turned out to be dead.

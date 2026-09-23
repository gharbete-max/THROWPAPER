# Handover

For a fresh session picking this up. Read `CLAUDE.md` first, then `LAUNCH-CHECKLIST.md`, then
`docs/adr/0001-theming-layers.md`. Do not paste specs into `CLAUDE.md`.

## Paste-ready prompt for the next session

```
You are continuing work on THROWPAPER (product name: Loppa) — a pnpm monorepo. Read CLAUDE.md
first (its "Never mistake a proxy for the thing" section before anything else), then
docs/MODULE-STATUS.md, then LAUNCH-CHECKLIST.md, then docs/PROGRESS.md from § Phase 0 to the
end. Do not re-derive anything HANDOVER marks as established.

State: fetch and read it rather than trusting this paragraph — `git fetch` and `gh pr list`
first, because local main is routinely behind. Phases 0–2 and S3–S8 are merged: main is green,
the magic link lands, the wizard is facets (ADR 0006), the demo brand kit is seeded and passes
the contrast guard, and every engineering-ready row in LAUNCH-CHECKLIST.md is closed. The current
test and e2e counts are in the latest PROGRESS entry; this prompt deliberately does not repeat
them, because a number written here goes stale by the next phase and a fresh session then reads a
correct result as a failure.

The gate: `pnpm verify` and `pnpm contract:check` exit 0, and `pnpm test:e2e` genuinely runs —
it exits 2 on a skip, and a green verify is not a green e2e. Start the portable Postgres first
(PROGRESS § L0 has the command). Kill the preview servers on 4173 and 4001 between a red run and
a green one: `vite preview` serves a build and a reused server will pass a reverted fix. Use a
single-token `--grep`; `run-e2e.ts` runs with `shell: true` and splits a multi-word pattern into
nothing. Capture a run's output to a file before re-running it, or a flake cannot be named.

Rules that bite: one task per branch, plan mode first; every fix gets a discriminating test shown
failing first; never mass-rename internal identifiers (CLAUDE.md rule 9); no new dependencies
without asking (majors: ADR 0005, re-review 2026-12-22); no legal/clinical/tax/safety wording
(rule 8); a brand colour never paints text or a boundary unchecked — reach for the derived tokens
(--tp-colour-heading, --tp-colour-accent-ink, --tp-colour-accent-on-ink, --tp-focus,
--tp-button-*, and --tp-colour-{primary,secondary,accent}-edge for a chosen state's border).
Gold is a FILL, bronze is the brand where it is read, every value comes from docs/brand. Measure contrast on the surface the finding was made on: a public form wears the demo
kit (navy, primary == text), the marketing site wears the shipped gold. Design first, then one
ponytail pass; never both in one.

What is left, and whose it is:
1. The owner's, not yours to invent — LAUNCH-CHECKLIST.md §1 (legal entity, hosting and region,
   retention), §3, the door's not-found remedy sentence, whether a name lookup lives inside the
   door, and whether site and app headings should agree on the ink or on --tp-colour-heading.
2. One feature: the door's five most recent arrivals vanish on reload.
3. The plan is docs/ROADMAP.md, and the owner's latest decision in it wins: **signing first**,
   approved 2026-09-23. Signing is a third product (apps/sign + apps/api-sign, ADR 0009); Loppa is
   proprietary and nothing is copied from GPL/AGPL code (ADR 0015). P1a and P1b are done
   (PROGRESS § P1a, § P1b); next is P1c (Sign's database, standalone mode, sealing). Mailer B2
   now lives inside P3. Decisions in docs/EXPANSION.md § 5.
   Not scheduled, so not yours to start: ADR 0008 (Reports as packages/reports — MODULE-STATUS §5
   has the nine importers, if it is ever picked up) and handwriting OCR (ADR 0007, which the
   roadmap names as out of every approved phase). An earlier version of this list put both of
   them first, from a brief the 2026-09-23 decision overtook.
4. The wizard's verticals (content, per ADR 0006). Trades and law stay blocked until a human
   authors their wording.
```

## State

**`docs/PROGRESS.md` is the record of what shipped and when. This section does not restate it.**
It previously did, in parallel, and the two drifted — `origin/main` was described as "at S2's
merge" with the palette "open as a pull request" after the palette had merged. One log, one place.

- **Where to look:** `docs/PROGRESS.md` § L0 … § P0 for the phases; § Phase 0 for the four-module
  scorecard and § Phase 1 for the gate repair. `docs/MODULE-STATUS.md` for what each of the four
  modules actually is, measured with the command behind every number.
- **The gate, and what it is worth:** `pnpm verify` and `pnpm contract:check` together are the
  definition of done — but a green `verify` is **not** a green `e2e`; `verify` does not run the
  suite. Run `pnpm test:e2e` and read the count. See `CLAUDE.md` § Never mistake a proxy for the
  thing before trusting any of the three.
- Pre-launch brief phases: **0 (audit) and 1 (security) complete** (`PRE-LAUNCH-AUDIT.md`);
  **2 (EU/Swedish legal) blocked on the owner** (§1.1 of `LAUNCH-CHECKLIST.md`); **3 (restyle)
  complete**; 4 (polish and SEO) not started.
- `LAUNCH-CHECKLIST.md` is the single list of what is still temporary, unconfigured or
  unconfirmed. Delete rows as they close; never tick them.
- The owner cannot test by hand (decision 2026-09-22): the simulated user (S3) is the
  acceptance channel; "ready" is the v0.1 done-means list executed by Playwright.

## The palette: what is authoritative, and where

The migration is **done and merged** (P0, PR #108). This is the record of where each thing now
lives, because the README's promise of "a separate PR series" is what this replaces.

| Artefact | Status | What it is |
| --- | --- | --- |
| `docs/brand/` | **Source of truth for the identity** | The bundle the mark, the metals and the measured WCAG table come from. Rasters are in Git LFS. Nothing derives *from* the app back into here. |
| `packages/tokens/src/default-tokens.json` | **Authoritative for the product** | Every colour the app renders derives from this. Gold `#cea85c`, bronze `#8f6b3a`, paper `#fafaf8`, platinum `#e9ebee`, ink `#0e0e10`, plus graphite and pewter. |
| `packages/tokens/src/loppa.test.ts` | **The guard** | Pins the shipped default to the brand bundle's measured table, so a future palette change fails CI instead of shipping. |
| `packages/tokens/src/locked.test.ts` | Historical | The seafoam/coral round survives here as one of the hostile customer kits the mechanism is held against. It is no longer anybody's palette. |
| `DESIGN.md` | **Argues the decision** | Why two metals, how the button re-derives, what the paper answers. |
| `apps/forms/src/styles.css` | Consumes | Reads the compiled variables. A literal colour here is a bug — `CLAUDE.md` rule 4. |

**The constraint that does not move.** Gold is **2.14:1 on white** — by design, not by oversight.
A filled button keeps the brand and takes its *label and boundary from the ink*. Text on a light
surface takes the **bronze tier `#8F6B3A` (4.64:1)**, never the face gold. A brand colour never
paints text or a boundary unchecked, and `packages/tokens` owns the contrast guard that enforces
it — it is a mechanism, not a convention.

**What is left**, and it is small: the four rows in `LAUNCH-CHECKLIST.md` §2.4 that the site
critique measured on the gold palette. Two are P1 — a filled button with no hover state anywhere
in the product, and a quiet button whose hover edge is gold at 2.14:1. Neither is new with the
palette; both were measured for the first time on it.

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

## Next unblocked work

In the paste-ready prompt above, under "What is left, and whose it is". It used to be restated here
as a numbered list and the two drifted — this list still said S3–S5 were upcoming after all three
had merged.

---

## The catalogue direction — now `docs/adr/0006-catalogue-direction.md`

One wizard across verticals, by **composing blocks** rather than retrieving one form from a
library. The decision, the argument against the "will not scale to millions" objection, what
survives in `packages/shared/src/wizard/tree.ts` (`contributes` and `keyOf`), what changes
(`next` becomes a sector-selected facet set), what is lost (`everyPath()`, and the four-press
promise that has to be restated rather than quietly dropped), the rule-8 position on trades and
law, and the DSA obligations community sharing would bring — all of it is in the ADR.

Two things from it that belong in front of whoever picks this up:

- The model change is a **breaking change to a shared package**. It is its own phase.
- **Community sharing is an owner decision, not an engineering one.** Public UGC flips the Phase 0
  DSA conclusion, which held *because* there is no public UGC.

## What Phase 3 landed, and how to work inside it

The planning notes that used to sit here are superseded by the code and by
`docs/adr/0001-theming-layers.md`. The short version:

- **Palette** is Loppa's: gold `#cea85c` (fills), bronze `#8f6b3a` (links, focus, the read
  accent), paper `#fafaf8`, platinum `#e9ebee`, ink `#0e0e10`, graphite, pewter — every value from
  `docs/brand/tokens-loppa.css`, held there by `packages/tokens/src/loppa.test.ts`. Dark is derived
  and floors at the ink (`#0e0e10`). The Midnight/Saddle palette survives only as the seeded
  "Demo AB" kit (S5 replaces it); the seafoam/coral round survives only as a hostile kit.
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
- **The mark** is the brand bundle's gold-and-platinum render (`public/mark-angled-256.png`,
  `mark-loop-256.webp`, `mark-poster-256.png`), produced from `docs/brand/animation` and
  `docs/brand/still` by `scripts/brand/blacken-shadow.py` (Pillow; `py -3` on this machine),
  which turns the bundle's warm-grey baked shadow black so it darkens on the dark page. There is
  no 512 loop until the bundle renders one. The favicon and launcher icons are still drawn from
  the geometry by `pnpm icons` on a gold tile; cutting them over to
  `docs/brand/vector/loppa-mark-flat.svg` is an asset task.
- **Client mode** is server-first: `client-identity.ts` inlines the palette and meta tags so the
  sign-in screen is the customer's from the first byte; `brand.tsx` reads them and never paints
  over a server-painted page until the real kit arrives.
- **Critique method** that worked: `/impeccable critique` with A and B as isolated sub-agents, B
  measuring in a real browser at 1280/375 × light/dark. Both snapshots are in
  `.impeccable/critique/`; the trend is 18 → 22 → 23 → 25 → 23 / 32 on the site and
  21 → 23 → 23 → 26 → 26 / 40 in the shell. When the desktop browser pane misbehaves — it does —
  B can drive a headless Playwright browser instead and inject `detect.js` from
  `impeccable live-server --background`; there is then no [Human] overlay tab, and the report
  must say so.

Do not run `impeccable` and `ponytail` in the same pass — they pull in opposite directions. Design
first, then a single ponytail pass to remove what turned out to be dead.

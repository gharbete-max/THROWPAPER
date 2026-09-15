# Handover

For a fresh session picking this up. Read `CLAUDE.md` first, then `LAUNCH-CHECKLIST.md`, then
`docs/adr/0001-theming-layers.md`. Do not paste specs into `CLAUDE.md`.

## Paste-ready prompt for the next session

```
You are continuing work on THROWPAPER (product name: Loppa) — a pnpm monorepo with two
independent products (apps/forms + apps/api-forms; apps/mailer + apps/api-mailer) and shared
packages. Read CLAUDE.md, then docs/HANDOVER.md, then LAUNCH-CHECKLIST.md, then
docs/adr/0001-theming-layers.md before touching anything.

State: main == origin/main at the merge of PR #67 (Phase 3, the Loppa restyle: palette, mark,
theming layers with a LOCKED list, client mode / white-label, two design-critique rounds, the
door as a mode, Responses by name, a no-JS contact page). `pnpm verify` is green (109 test
files). Playwright e2e specs were not run on the last machine (no database) — run them first.

Rules that bite: one phase per branch, `pnpm verify` before "done", never mass-rename internal
identifiers (throwpaper stays throwpaper in paths/tables/routes), no new dependencies without
asking, no legal/clinical/tax/safety wording (rule 8), a brand colour never paints text
unchecked — reach for the derived tokens (--tp-colour-heading, --tp-colour-accent-ink,
--tp-colour-accent-on-ink, --tp-focus, --tp-button-*). The owner dislikes dark teal and the
flat mark. Design first, then one ponytail pass; never both in one pass.

Pick up in this order:
1. Run `pnpm test:e2e` against `pnpm demo` and fix anything the door/Responses changes broke.
2. LAUNCH-CHECKLIST.md §2.3 — the nine open P2 findings from the second critique (contrast on
   card surfaces, Reveal-inside-ul, door event name + wrong-id state, mobile verdict shrink,
   the screen-reader items). Then re-run `/impeccable critique apps/forms/src/site/Site.tsx`
   and record the trend (18 → 22 / 32 so far).
3. LAUNCH-CHECKLIST.md §2.1 — audit items 8–17, each needing the owner's approval before the
   diff (start with 8: TRUST_PROXY, and 12: the upload sweeper whose index already exists).
4. Everything in LAUNCH-CHECKLIST.md §1 is the owner's to answer, not yours to invent: ask,
   batch the questions, and never fill a `pending()` marker with plausible text.

Do not start the catalogue/wizard work (docs/HANDOVER.md § The catalogue direction) without a
paper decision first.
```

## State

- `main == origin/main`, clean. Last merge: **#67** (Phase 3 — Loppa), 30 commits, merged
  2026-09-15. No open PRs.
- `pnpm verify` green: **109 test files**, both apps build. `pnpm verify` and
  `pnpm contract:check` together are the definition of done.
- Pre-launch brief phases: **0 (audit) and 1 (security) complete** (`PRE-LAUNCH-AUDIT.md`);
  **2 (EU/Swedish legal) blocked on the owner** (§1.1 of `LAUNCH-CHECKLIST.md`); **3 (restyle)
  complete**; 4 (polish and SEO) not started.
- `LAUNCH-CHECKLIST.md` is the single list of what is still temporary, unconfigured or
  unconfirmed. Delete rows as they close; never tick them.

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

1. **Run the Playwright e2e suite** (`pnpm test:e2e` against `pnpm demo`). The door and Responses
   changed shape in #67; the specs were checked by eye against the new markup but not executed,
   because the last machine had no database.
2. **The nine open P2 findings** from critique #2 — `LAUNCH-CHECKLIST.md` §2.3, snapshot in
   `.impeccable/critique/2026-09-15T07-51-16Z__…md`. `/impeccable polish` reads that file.
3. **Audit items 8–17** — `LAUNCH-CHECKLIST.md` §2.1. Each needs the owner's approval before the
   diff. Item 12 (upload sweeper) has its index already; item 8 (`TRUST_PROXY`) depends on the host.
4. **Phase 4** — polish and SEO: a real social card, Lighthouse decision, baseline screenshots.

---

## The catalogue direction — decide on paper before authoring templates

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

# Simpler and more intuitive — a structure review (2026-10-21)

**Status:** proposed. Written after the Documents catcher was built and the AI centre added; it
measures what is there and ranks what to simplify. Nothing here is built yet. Where a proposal would
delete or hide an earlier feature it says so: `CLAUDE.md` forbids deleting those unasked.

## What there is (measured at `7d3314b`, source lines without tests)

| Area | Source | Notes |
| --- | --- | --- |
| `apps/api-forms` | 78.6 k | 25 route files, the PDF routes, send, invoicing, events, ledger |
| `packages/shared` | 65.7 k | builder, interpret, import, ai, summary, payable, api |
| `apps/forms` | 50.9 k | **57 entries in `screens/`**, 34 top-level screens, 30 routes, `styles.css` 8 760 lines in one file |
| `apps/desktop` | 7.7 k | the shell and the AI coordinator |
| docs | 68 `.md`, 24 ADRs, 81 files in `docs/plan/` | most are history |
| Stubs | `apps/mailer`, `apps/api-mailer` (152 lines), `packages/ui` (one helper) | kept by decision, used by nothing |
| e2e | 50 specs, about 12 minutes | one run at a time |

Catalogue words per area (English keys): guided builder 132, scan 53, summary 78, ai 70, send 40,
forms 34, campaign 32. The AI centre alone is 148 keys and lives inside the Summary pane.

## What a person meets that is not simple

1. **Scan has about fourteen actions on one screen** (add, camera, phone, filters, digital copy,
   edit text, redact, Word, invoice, read with AI, then fill, sign, send, summarise, keep). The
   order a person works in (bring in, fix, keep or pass on) is not visible.
2. **The AI is set up inside the Summary pane.** Models, tiers, projector, graphics card and the
   runtime are 70 settings strings in a screen whose job is to summarise. A first-time person sees a
   six-model list, including two that do not work yet.
3. **The rail still speaks the first product**: events, door, responses, invoices, users, brand next
   to the four parts, although the room says Documents has four parts.
4. **Send has three tabs, an address book, an issues table and a reply helper**, and no line that
   says which one a person usually wants.
5. **Words repeat** (Keep, Make the PDF, Download) for steps that mean the same.

## What a developer or an AI session meets that is not simple

6. `screens/` is flat: 57 entries, features mixed (scan-edit, scan-filter, send/, invoice-scan/,
   signing/ beside Room.tsx). `docs/MAP.md` has to tell you which file belongs to which part.
7. `styles.css` is one 8 760-line file at 19.2 of its 20 KB cap; any design work first trims CSS.
8. `docs/plan/` holds the builder's S1 to S14 plans, spike data and four live plans together.
9. Two kinds of test run (unit about 7 600, e2e 12 minutes) with no fast tier for a UI-only change.

## Proposals, ranked by value for the effort

| # | Change | Why | Effort | Risk |
| --- | --- | --- | --- | --- |
| 1 | **One "Set up AI" page**, reachable from the room's centre and the corner menu. Default view: one recommended model for this computer and one button; "Choose another" opens the tiers; projector, graphics card and runtime sit under "Advanced"; models marked not-working-yet are hidden unless "Show all". Summary becomes a work screen. | The first-time path becomes one click; Summary shrinks by about 100 keys. | M | Low (moves UI, same coordinator) |
| 2 | **Scan as three steps**: Bring in, Fix, Keep or pass on, with one filled button per step and the rarely used tools under "More tools". | Makes the order visible; removes the fourteen-button wall. | M | Low (same components) |
| 3 | **Rail follows the room**: the four parts first; events, door, responses, users, brand folded under one collapsed "Earlier features". Nothing deleted, routes unchanged. | The product reads as what it is now. | S | Low |
| 4 | **Feature folders in `screens/`**: `room/`, `scan/`, `send/`, `sign/`, `forms/`, `ai/`, `earlier/`, moved with `git mv` in one PR while no other work is open; MAP rows then say one folder per part. | An AI session finds a part by folder; fewer wrong files read. | M | Low (typecheck catches every miss) |
| 5 | **Split `styles.css` per feature**, loaded with the screen's lazy chunk; keep tokens and shell in the entry CSS. | Frees the 20 KB cap for design work; smaller first paint. | M | Medium (cascade order) |
| 6 | **Fast e2e tier**: `pnpm test:e2e:smoke` (room, scan, send, sign, ai, about 3 minutes) for UI-only changes; the full suite stays for merges. | Cuts the longest wait in every PR. | S | Low |
| 7 | **Archive finished plans**: move the builder's S1 to S14 plans and spike data to `docs/archive/` with an index; keep the live ones (`DOCUMENTS`, `AI-SYSTEM`, `IMPROVEMENTS`, `DESIGN-PASS`, `VISION-TUNING`, this file). Done in part: `docs/adr/README.md` now gives one line per ADR. | A session opens fewer, truer files. | S | None. **Done** in the cleanup PR (`docs/archive/`, index in its README). |
| 8 | **One word for each step** (a short style list: Keep, Send, Sign, Summarise, Fill) applied across the twelve catalogues. | Fewer concepts, fewer keys. | S | Low |
| 9 | **Default model by hardware**: the 2B is 2.7 times faster at nearly equal accuracy; the recommendation already depends on RAM, so make "recommended" the default action rather than the 7B (owner's call). | Fast first experience on most computers. | S | Low |
| 10 | **Retire the stubs**: move `apps/mailer`, `apps/api-mailer` into `docs/archive/` with a note. | Removes two empty apps from every listing. | S | **Done** in the cleanup PR (removed, not moved: git history keeps them; `docs/archive/SPEC-mailer.md` stays). |

Not recommended: merging Forms, Sign and the desktop into one package (the contract boundaries are
tested and cheap), rewriting the guided builder (it is finished and frozen by 6 000 tests), or
deleting the earlier events and ledger code (a menu fold, proposal 3, gives the same simplicity).

## Order

First 3, 7 and 6 (small, safe, visible); then 1 and 2 (the two screens people actually struggle
with); then 4 and 5 together while nothing else is open; 8 and 9 alongside; 10 when the owner agrees.

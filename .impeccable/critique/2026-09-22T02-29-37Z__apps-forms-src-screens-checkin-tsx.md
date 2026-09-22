---
target: app shell - the door (apps/forms/src/screens/CheckIn.tsx)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\screens\\CheckIn.tsx"
target_fingerprint: "sha256:1e863593371a98a4f1031522db5ab0d6ccc7a5a7668fbc277fc3ca0f4156b01c"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\screens\\CheckIn.tsx"
timestamp: 2026-09-22T02-29-37Z
slug: apps-forms-src-screens-checkin-tsx
---
# Critique — app shell (the door), 2026-09-22

Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent), isolated; browser at 1280×800 and 375×812, light and dark, against `pnpm demo`. Assessed at commit `91d90d1` of `claude/app-shell-a11y` (the six §2.3 rows closed), before the undo fix in `94c893f`.

## Design Health Score — App shell (Operate), applicable maximum 40

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "Hittades inte" never echoes what was typed; the field is cleared, so a typo cannot be told from a wrong queue |
| 2 | Match System / Real World | 3 | Responses timestamps carry seconds (`Inbox.tsx:145` `toLocaleString`); the door uses `formatDateTime` |
| 3 | User Control and Freedom | 1 | Undo did not work from a browser: bodiless DELETE sent `content-type: application/json` → Fastify `400 FST_ERR_CTP_EMPTY_JSON_BODY`, swallowed by `catch`. Reproduced with `app.inject` (DELETE 400, POST 400). Fixed after this snapshot in `94c893f` (`lib/api.ts`) |
| 4 | Consistency and Standards | 2 | Two date formats; dark-mode warn verdict is the demo banner's colour |
| 5 | Error Prevention | 3 | Offline never reads as not-found; 3 s scan dedupe; confirm on undo. Public form step 2 shows "required" + `aria-invalid` before any interaction |
| 6 | Recognition Rather Than Recall | 3 | Event name in the heading now; not-found gives nothing to recognise |
| 7 | Flexibility and Efficiency | 3 | Enter submits, `enterKeyHint="go"`, `autoCapitalize`, focus rule; camera is a second tap |
| 8 | Aesthetic and Minimalist Design | 2 | Idle verdict is 224px of surface holding one 20px sentence at 375; 41/41 Responses rows wear an identical "Inskickat" badge |
| 9 | Error Recovery | 1 | Undo failure was silent; not-found has no next step; camera error prints the raw browser `error.message` (`CheckIn.tsx`) |
| 10 | Help and Documentation | 2 | Nothing says where a reference comes from (card / email) |
| **Total** | | **23/40** | **Acceptable (58%)** — flat against 2026-09-15; A estimates ~26 with the undo defect removed |

## Design Specificity Verdict

**Authored — but the cascade ships a generic one.** The door is a mode (shell dropped), the verdict a fixed-height `role="status"` object, the Swedish copy written for a queue. Three of its signature decisions never reach the screen: `.field input` (0,1,1) beats `.checkin__input` so the reference field is 16px, not 2xl; a later `.button` rule beats `.door__check` so the primary is 44px, not 55px (measured 494×44 / 197×44); `h2` beats `.small` so "Senast anlända" is a 25px heading.

**Deterministic scan**: `impeccable detect --json` on CheckIn, Inbox, PublicForm, EventForm, Signed → `[]`, exit 0.

**Visual overlays**: injection succeeded in the built-in browser; `detect.js` ran in-page: door 1280 `1 anti-pattern found`; door 375 dark `text-overflow: a.button.button--quiet.small overflows its box by 17px` ("Lämna entrén", 66×52, two lines). Body-level `cream-palette`, `monotonous-spacing`, `bounce-easing` (the removed curve in a comment) are configured false positives. Live server stopped; port 8400 down; no overlay left in a tab.

## Measured, the six closed rows

- Responses: `ul.inbox` children `["LI"]` only, no `DIV`; row 2 `border-top: 1px solid` in both schemes.
- Door h1 "Incheckning Vårmötet 2026"; wrong id → 0 `.checkin__input`, 0 `.verdict`, link to `/events`.
- Verdict height idle → judged: 176/176 at 1280, 224/224 at 375, light and dark; headline 20px idle → 31.25/39.06px judged. No horizontal overflow in any configuration.
- Undo buttons: "Ångra Alva Öberg", "Ångra Ingrid Öberg", "Ångra Jonas Öberg"; `p[aria-label]` count 0; count read as "N av 48 incheckade".
- `activeElement` after load and after a typed check-in: `INPUT.checkin__input`.
- Confirmation: h1 "Anmälan till Vårmötet", h2 the author's thank-you, reference, then "En bekräftelse med ditt inträdeskort är på väg till <address>."
- Contrast light/dark: `.door__event` 5.28/7.08; idle headline 5.70/6.71; bad headline 5.79/6.41; Ångra label 14.5/16.8; `.inbox__form` 5.70/6.71. No interactive element under 44px in either dimension at 1280 or 375.

## Overall Impression

The six rows are closed and measure closed. What the re-run finds is a broken remedy (undo, fixed after the snapshot), a cascade that undoes the door's own sizing, and a not-found verdict that gives the operator nothing to act on.

## What's Working

1. The door as a mode: one filled button, a fixed-height verdict told in words and colour, the count read once as a sentence.
2. Offline is a state, not an error — a dropped connection never becomes "Not found".
3. Undo carries whose arrival it takes back, in a real `<dialog>` with 44px buttons and focus on cancel.

## Priority Issues

**[P0] Undo dead from a browser** — *fixed after this snapshot* (`94c893f`): `lib/api.ts` set `content-type: application/json` on bodiless requests; Fastify answered 400; archive, trash/restore/delete form and brand-kit reset were broken the same way. Client test and the undo e2e (presses, confirms, zero `check_ins` rows) both red without the fix. Still open: a failed undo shows no verdict.
- *Suggested command:* /impeccable harden

**[P1] The door's sizes lost in the cascade**
- *Why it matters:* the reference field, the primary and the "last arrivals" caption render at the default kit's sizes, not the door's; the screen designed for arm's length ships at desk length.
- *Fix:* scope as `.door .checkin__input`, `.door .door__check`, `.door__recent h2`; add a guard test on computed sizes.
- *Suggested command:* /impeccable polish

**[P1] Not-found says nothing**
- *Why it matters:* the field is cleared and the verdict is two red words while a person waits; the operator cannot tell a typo from the wrong queue.
- *Fix:* echo the typed reference in `verdict__name`; one line of what to do — a sentence for the owner to word.
- *Suggested command:* /impeccable clarify

**[P2] 375 header**: "Lämna entrén" wraps to two lines and clips 17px; title and count share a row.
- *Suggested command:* /impeccable adapt

**[P2] Verdict meta at `opacity: .85`** measures 3.9:1 on success and 4.4:1 on warning at 14.3px — under AA.
- *Suggested command:* /impeccable harden

**[P2] Confirmation**: no live region, focus left on `body` after submit; step-2 "required" error before interaction.
- *Suggested command:* /impeccable harden

**[P3] Responses at 375**: name truncated while the form title keeps its width; the all-same badge; seconds in timestamps.
- *Suggested command:* /impeccable distill

## Persona Red Flags

**Sam (screen reader / keyboard):** h1 read as one word "IncheckningVårmötet 2026" (fixed after the snapshot: a space separates them); undo failure announced nothing (fixed); confirmation has no live region and focus stays on body; camera error is an untranslated browser string.

**Casey (one-handed, slow connection):** the input's only edge in the seeded Demo AB kit is `#ddd6c8` on `#f4f1ea` = 1.28:1 — the kit `LAUNCH-CHECKLIST.md` §2.2 already flags, not the Loppa palette; on a slow connection the button dims to 0.6 and nothing times out; the primary (197×44) beside "Starta kameran" (138×44) reads as two verbs.

**Jordan (first-timer):** nothing says where a reference comes from; "Lämna entrén" goes to the attendance report, not back.

## Minor Observations

- `no-such-guest` at 375 dark grows the panel to 263px (three-line headline) and shows the reference twice.
- Dark mode paints the door title in lifted primary `#849dcc` (7.1:1, but a brand colour on text).
- Placeholder 4.08:1. Confirm button says "Ångra", the same word as the trigger.
- Count moved 0 → 4 with three admissions in a shared demo — two agents shared one server; not a design finding.

## Questions to Consider

- Does the door need the word "Incheckning" at all, or is event name + count the whole header?
- Why is not-found red? It is usually a typo or the wrong queue.
- Why a modal for undo at a door, rather than a five-second inline "Ångrad — återställ"?
- If the camera is the fast path, why is it off by default?

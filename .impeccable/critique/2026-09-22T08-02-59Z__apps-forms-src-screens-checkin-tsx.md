---
target: app shell - the door (apps/forms/src/screens/CheckIn.tsx)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\screens\\CheckIn.tsx"
target_fingerprint: "sha256:31bfb57a85f5650c522a25ef3f9811b3ee081082f1083921f68fa8729a150b8f"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\screens\\CheckIn.tsx"
timestamp: 2026-09-22T08-02-59Z
slug: apps-forms-src-screens-checkin-tsx
---
# Critique — app shell (the door), 2026-09-22 evening (after S2)

Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent), isolated; 1280×800 and 375×812, light and dark, against `pnpm demo`, overlay injected in the built-in browser. Assessed at `61ea7bf` on `claude/l8b-door` — the nine S2 rows closed.

## Design Health Score — App shell (Operate), applicable maximum 40

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | A server fault while `navigator.onLine` is true still renders "Hittades inte" (`CheckIn.tsx` submit `catch`) |
| 2 | Match System / Real World | 3 | "Anlände 22 sep. 2026 09:56" — a door needs the time; the date is noise at arm's length |
| 3 | User Control and Freedom | 3 | Undo works and confirms with focus on Avbryt; the five arrivals are component state and vanish on the reload bad wifi guarantees |
| 4 | Consistency and Standards | 2 | Public form page 2 at 375: two filled buttons — "Lägg till en gäst" (343×44) stacked above "Anmäl mig" |
| 5 | Error Prevention | 3 | An empty submit is silently swallowed |
| 6 | Recognition Rather Than Recall | 2 | The door's recent-arrival row clips the name to ~10 characters at 375 while the timestamp keeps 118px |
| 7 | Flexibility and Efficiency | 2 | No in-product remedy after "not found" — no name lookup, no manual admit; leaving lands on a report with no search |
| 8 | Aesthetic and Minimalist Design | 3 | The idle panel is 343×224 holding one sentence |
| 9 | Error Recovery | 2 | Not-found echoes the code but offers no next step (owner's sentence pending); undo failure borrows `users.errorFailed` |
| 10 | Help and Documentation | 3 | "Starta kameran" has no `aria-pressed`; `<video>` unnamed |
| **Total** | | **26/40** | **Acceptable (65%)** — up from 23 |

## Design Specificity Verdict

**Authored.** The door reads as a purpose-built device: the count is the loudest number (39px), the verdict a fixed-height panel (224px at 375 across idle/good/warn/bad), the field display-size uppercase, the shell dropped. The rest of the shell is competent-conventional, which is the right ambition for authoring chrome. Caveat from A: `DESIGN.md` describes seafoam/coral while the demo runs the seeded navy kit — the §2.2 brand-kit row.

**Deterministic scan**: `impeccable detect --json` on CheckIn, Inbox, PublicForm, EventForm, Signed → `[]`, exit 0.

**Visual overlays**: injection succeeded in the built-in browser (`document.title` + `<script>` preflight, `innerWidth` 1024); `detect.js` ran in-page on the door, `/responses` and the confirmation; live server started and stopped (port 8400 confirmed closed). Door: only the body-level configured false positives (`monotonous-spacing`, the removed `bounce-easing` curve in a comment). `/responses` at 375: **six `undersized-ui-text`** — the bottom-bar nav labels at 10.24px ("Evenemang", "Formulär", "Svar", "Fakturor", "Användare", "Utseende"), below the 11px floor — plus the body-level `overused-font`/`cream-palette` false positives.

## Measured — the nine S2 rows, closed

- Field **31.25px** at 1280 / **25px** at 375; primary **55px**; "Senast anlända" **14.31px** (were 16 / 44 / 25).
- "Lämna entrén" **44px**, `scrollWidth ≤ clientWidth`; at 375 the h1's top (169) ≥ the link's bottom (153). No overflow at either width, light or dark.
- Verdict 176/176 (1280) and 224/224 (375) idle → not-found → good → already.
- `.verdict__meta` on the warning panel **5.42** light / **12.52** dark (was 4.4).
- Not-found verdict: "Hittades inte / ZZZZ-ZZZZ".
- Undo buttons: "Ångra Kritik Testsson"; `activeElement` after a typed check-in: the field.
- Public form: page 2 opens with **0** `aria-invalid`; after sending, `activeElement` is the H2 (`tabindex=-1`), "Tack för din anmälan! Vi ses snart."
- Responses at 375: name 168×24 on its own row, form beneath (y 445 vs 413), **0 badges** across 50 rows, "22 sep. 2026 09:56"; `ul.inbox` children 50 × LI, row-2 border 1px.
- Wrong-id door: no field, no verdict, the not-found sentence and a link to `/events`.
- No interactive element under 44px on the door (the 1×1 radios behind the meal cards on the public form are the visually-hidden inputs of labelled cards).

## Overall Impression

The door is now the screen it was designed to be. What the re-run finds is the next layer: what the operator does when the card is not there, a recent row that still clips the name on a phone, and one wrong-tap trap on the public form's last page.

## What's Working

1. The door as a mode — count, verdict, field, in that order of loudness; nothing under 44px; nothing scrolls at 375.
2. The verdict as a live region with a fixed floor, the code echoed when nobody is found, the person named in every undo button.
3. The confirmation moves focus to the thank-you; page two opens clean.

## Priority Issues

**[P1] No remedy after "Hittades inte"**
- *Why it matters:* the commonest door exception — no card, no email — has no in-product path; "Lämna entrén" lands on a report with no search and no admit, with the queue watching.
- *Fix:* the owner's sentence under the verdict (pending), and a product decision on a name lookup inside the door with an admit button.
- *Suggested command:* /impeccable harden

**[P1] The door's recent-arrival row clips the name at 375**
- *Why it matters:* the one thing to recognise before pressing Ångra is the thing that is cut (~10 characters) while "22 sep. 2026 09:56" keeps 118px.
- *Fix:* time only (`HH:mm`) in the row, a fixed `ch` width on `.door__when`, the name takes the rest.
- *Suggested command:* /impeccable polish

**[P1] Two filled buttons on the public form's last page**
- *Why it matters:* "Lägg till en gäst" (343×44, filled) sits directly above "Anmäl mig" at 375 — the wrong-tap trap for a first-timer; DESIGN.md says one primary per screen.
- *Fix:* the guest button becomes quiet (or bare with a plus).
- *Suggested command:* /impeccable clarify

**[P2] A server fault reads as "not found" while online** (`CheckIn.tsx` submit `catch`)
- *Fix:* a `'failed'` outcome, warn tone, existing error copy, and never clear the field on it.
- *Suggested command:* /impeccable harden

**[P2] Bottom-bar nav labels at 10.24px** (detector, six elements at 375)
- *Suggested command:* /impeccable typeset

**[P2] The confirmation's reference is the smallest thing on the card** (16px muted) — the credential the door relies on.
- *Suggested command:* /impeccable clarify

**[P3]** Full date on the "already" verdict and the recent rows; the five arrivals lost on reload; "Starta kameran" without `aria-pressed`, `<video>` unnamed; the idle panel's empty surface; a second identical "Hittades inte" may not re-announce.

## Persona Red Flags

**Sam (screen reader / keyboard):** tab order demo-reset → Lämna entrén → field → Checka in → Starta kameran; two identical not-found verdicts in a row share the same status text; "Kontrollerar…" lives only in a button label; camera toggle has no `aria-pressed`; confirm dialog focuses Avbryt (right).

**Casey (one hand, slow connection):** field y 508–574 and button y 586–641 of 812 — thumb zone; Ångra reachable; nothing scrolls. Empty submit gives no feedback; a server error masquerades as not-found; the undo list is lost on reload; a fresh device plays the 3 s intro at the door.

**Jordan (first-timer):** the idle prompt is enough; on the public form the filled guest button above the submit is the trap; the selected meal card is marked by a 2px border only; the confirmation buries the reference.

## Minor Observations

- Responses' zero-result search shows "0 svar" and a bare rule, no sentence.
- `/events/<id>` is an edit form; the card on `/events` is the real detail.
- The demo banner's ochre is the warning verdict's hue.
- The public form loads in the browser's language (CI's Chromium reports en-US) — by design; the language picker switches it.

## Questions to Consider

- Why is the idle panel empty when it could *be* the viewfinder?
- If the last five arrivals are the door's memory, why does a reload erase them?
- Should the not-found remedy live inside the door, so nobody leaves it with a queue waiting?

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
timestamp: 2026-09-22T12-37-42Z
slug: apps-forms-src-screens-checkin-tsx
---
# Critique — app shell (the door), 2026-09-22 midday (after the palette)

Method: dual-agent (A: design review sub-agent · B: detector + Playwright sub-agent), isolated;
1280×800 and 375×812, light and dark, against `pnpm demo`, `detect.js` injected in a headless
browser (the desktop pane is unreliable here). Assessed at `d4e214b` on `claude/palette-loppa`.

**`CheckIn.tsx` is byte-identical to the previous run** (`sha256:31bfb57a…`): only the palette
commits landed. The score is expected to be flat, and it is. What this run adds is measurement on
the new identity plus two root causes nobody had traced.

**The known caveat, stated once:** the signed-in demo wears the seeded "Demo AB" navy kit
(`apps/api-forms/src/demo/dataset.ts`), which S5 replaces. The shell and the public form therefore
render navy under `pnpm demo`; that is not a palette survivor. The product's own tokens are judged
on `/login` before sign-in, where B measured them exactly: paper `#fafaf8` / ink `#0e0e10` light,
ink page with a **gold h1** dark, filled button gold with an ink label and an ink border on light,
a gold border on dark, and the wordmark `rgb(14,14,16)` — not the browser's `#0000ee`.

## Design Health Score — App shell (Operate), applicable maximum 40

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | A server fault with `navigator.onLine` true still renders "Hittades inte"; an empty submit changes nothing and says nothing |
| 2 | Match System / Real World | 3 | "Anlände 22 sep. 2026 14:31" and a full date in every recent row — at a door every arrival is today |
| 3 | User Control and Freedom | 3 | Undo confirms with focus on Avbryt; the five arrivals are component state and die on the reload bad wifi guarantees |
| 4 | Consistency and Standards | 2 | **`.button--secondary` has no rule in any stylesheet**, so it renders as the primary — the root cause of the two stacked filled buttons on the public form's last page (measured identical fills at 375) |
| 5 | Error Prevention | 3 | Empty submit silently swallowed; the duplicate-email refusal surfaces on page 2, beside the submit, not beside the page-1 field it concerns |
| 6 | Recognition Rather Than Recall | 2 | `.door__who` at 375: 87px of client width against 118px of text while the timestamp keeps 121.97px — the name is clipped, the date is not |
| 7 | Flexibility and Efficiency | 2 | No in-product remedy after not-found; `EventReport` has a no-show filter but no name search and no admit |
| 8 | Aesthetic and Minimalist Design | 3 | The idle panel is 343×224 for one sentence; the event name is 12.8px under a 31.25px generic label; ~180px of dead page under a 640px column at 1280 |
| 9 | Error Recovery | 2 | Not-found echoes the code and offers nothing; undo failure still borrows `users.errorFailed` |
| 10 | Help and Documentation | 3 | The camera toggle has no `aria-pressed`; the `<video>` is unnamed |
| **Total** | | **26/40** | **Acceptable (65%)** — 21 → 23 → 23 → 26 → 26, flat on an unchanged file |

## Design Specificity Verdict

**Authored, and the palette mechanism survived contact with gold.** The door is still a purpose-built
instrument: count 39.06px, field 31.25px at 1280 and 25px at 375 in uppercase, primary 55px, shell
chrome dropped, no interactive element under 44px, no overflow at either width in either scheme. On
the product's own tokens (`/login`) the filled button is exactly what `DESIGN.md` argues for — gold
fill, ink label at 8.61:1, and an ink border carrying the boundary the 2.14:1 fill cannot. No
invented darkened gold anywhere.

Two things undercut the authoring, both palette-independent: at 1280 the door is a 640px column in
a 1280px page with ~180px of dead band beneath it (the phone layout stretched), and the header
inverts its own hierarchy — "Incheckning" at 31.25px bold over the event name at 12.8px muted, when
the file's own comment says the first thing read should be which queue this is.

**Deterministic scan.** `detect --json` on CheckIn, FormResponses, PublicForm, Login and Inbox →
`[]`, exit 0, on all five, with zero suppressions (`--no-config` also returns `[]`). Positive
control: the whole of `apps/forms/src` returns exactly one advisory (`design-system-font-size`,
`styles.css:4517`, the 2.6rem fluid endpoint), so the scanner is running.

**In-page overlay** (injection succeeded on every page; live server on 8400 started and stopped,
port confirmed not listening): `/responses` at 375 is the loud one — **21 findings**: six
`undersized-ui-text` (the bottom-bar nav labels at 10.24px) and **13 `text-overflow`** on
`inbox__who`, `inbox__form` and `inbox__reference`, which is the same clipping the door's recent row
has. Three false positives identified and named: `bounce-easing` (a value the CLI suppresses,
present only in a comment Vite inlines in dev); `dark-glow #cea85c "on dark page"` reported on two
pages rendered in light; and `cream-palette rgb(244,241,234)` flagged as a page background when on
the door that value is the button's *text* colour.

## Measured (B)

**The door.** Field 31.25 / 25px, height 66px; primary 55px; caption 14.311px; no overflow at
either width, either scheme. Verdict panel: 176px at 1280 and 224px at 375 for idle, not-found and
admitted — **except "already" at 1280, which is 194.78px**, so the panel jumps 18.78px under the
operator between the admit and the repeat scan. Verdict meta contrast, composited: admitted 4.74
light / 12.10 dark; already 5.42 / 12.52. All AA; light is ~2.5× worse than dark and 4.74 is the
weakest pair in the product.

**The recent row at 375** (open P1, unfixed and worse than estimated): name 87px client against
118px of text — clipped — while the timestamp keeps its full 121.97px and never wraps.

**The public form's last page at 375** (open P1, unfixed): "Lägg till en gäst" 343×44 at y572 and
"Anmäl mig" 343×44 at y632, *identical* background. Root cause confirmed in source:
`RepeatingGroup.tsx:177` asks for `button--secondary`; `styles.css` defines `.button`,
`--quiet`, `--danger` and `--icon`, and nothing else.

**`/responses` at 375:** no horizontal overflow; six labels at 10.24px; "Brand" 38.9×44 and the
three segmented options 30×44 fail the 44px width.

## Overall Impression

The palette moved under the door without touching it, and nothing broke: every verdict tone still
clears AA in both schemes, and the one screen that shows the product's own colours shows them
correctly. What this run is worth is the two root causes: a button tier that is requested in code
and defined nowhere, and a verdict panel whose fixed height is not fixed at 1280. Both are cheap.

## What's Working

1. **The verdict as an instrument** — fixed floor at 375, live region, tone-coded, the refused code
   echoed when nobody is named, AA on every tone in both schemes.
2. **The button mechanism survived the palette change intact** — gold fill, ink label 8.61:1, ink
   border in light; no muddied third colour, which is the whole argument of `DESIGN.md`.
3. **Touch discipline** — 44px floor, 55px primary, the field in the thumb zone at 375, zero
   overflow in four viewport/scheme combinations.

## Priority Issues

- **[P1] No in-product remedy after "not found"** (palette-independent, carried). The commonest
  door exception dead-ends; the only exit is a report with no name search and no admit. **Fix:** a
  name lookup inside the door with an admit, plus the owner's sentence. **Command:** /impeccable shape
- **[P1] The recent-arrival row clips the name at 375** (carried). 87px for the name, 121.97px for a
  full date. **Fix:** `HH:mm` only, a `ch` width on `.door__when`, the name takes the rest.
  **Command:** /impeccable adapt
- **[P1] `button--secondary` is an unstyled class** (new root cause; closes the two-filled-buttons
  row). Any screen reaching for a secondary tier gets a second primary. **Fix:** define the tier, or
  point `repeating-group__add` at `button--quiet`. One rule. **Command:** /impeccable polish
- **[P2] The "already" verdict panel grows 18.78px at 1280** (new). The fixed height that makes the
  panel an instrument holds at 375 and not at desktop; the panel jumps between the admit and the
  repeat scan. **Fix:** the same floor the 375 rule applies. **Command:** /impeccable layout
- **[P2] A server fault reads as "not found" while online** (carried); and an empty submit is
  silent. **Command:** /impeccable harden

## Persona Red Flags

**Alex (power user):** cannot get from a failed scan to the person; `/responses` truncates the
reference — the one field matching a human to a card — to a couple of characters at 375; no keyboard
path from verdict to remedy.
**Sam (accessibility):** the camera toggle has no `aria-pressed`, the `<video>` is unnamed, two
consecutive identical not-found verdicts may not re-announce. Positives: the undo dialog focuses
Avbryt, each Ångra carries its person's name in a visually-hidden span, the counts are a hidden
sentence.
**Casey (one hand, bad connection):** thumb zone correct and nothing scrolls, but a dropped
connection still prints "Hittades inte", the arrivals vanish on reload, and the names in them are
already cut.

## Minor Observations

- The idle verdict in dark is `rgb(23,27,33)` on a `#0e0e10` page — a 224px box that reads as a hole
  rather than a waiting instrument.
- `/responses` clips names by the same mechanism as the door row: one fix, two screens.
- The demo banner under a gold palette (`rgb(122,94,16)` light, `#f3cb5e` dark) reads as brand chrome
  rather than a warning; worth re-checking after S5 puts Loppa's kit in the seed.
- Tab order from the autofocused field is sane and unchanged.

## Questions to Consider

- If the door's claim is "rain, a queue, one hand", why is the only state with no action the one that
  happens when the queue stops moving?
- The idle panel is 224px of nothing on a phone. Why is it not the viewfinder the file already calls
  the fast path?
- `button--secondary` is requested in code and defined nowhere. How many other classes in this
  product are requests the stylesheet silently answers as "primary"?

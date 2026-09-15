---
target: Loppa marketing site and app shell
total_score: 18
max_score: 32
na_heuristics: 7,10
p0_count: 2
p1_count: 1
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
target_fingerprint: "sha256:8af73f1634a25cfe59efdb646eb69a323174372b7beaf4c1a7620651c6bbd2c0"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
timestamp: 2026-09-15T05-54-30Z
slug: apps-forms-src-site-site-tsx
---
Method: dual-agent (A: a2b1fdb217c89896d · B: a86df0145ea2f42f8)

## Design Health Score

Two surfaces, two modes, scored separately. The marketing site is Persuade; the app shell is Operate.

### Marketing site (Persuade) — H7 and H10 n/a, applicable maximum 32

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Header nav has no `aria-current`; on `/features/events` nothing says which of the three you are on |
| 2 | Match System / Real World | 4 | "A crease through the symbol still reads at a door in December" — best work in the product |
| 3 | User Control and Freedom | 2 | `#main` and `#features` have `scroll-margin-top: 0` under a sticky bar of 77px (desktop) / 214px (mobile) |
| 4 | Consistency and Standards | 1 | The page breaks its own written palette rule in four places (P0 below) |
| 5 | Error Prevention | 3 | Language switcher preserves the page — good. `/features/<anything>` returns 200 |
| 6 | Recognition Rather Than Recall | 3 | Six cards, icon + name + line; icons are near-identical 12px seafoam glyphs carrying no recognition |
| 7 | Flexibility and Efficiency | n/a | No repeat-use accelerators exist or should on a zero-JS brochure page |
| 8 | Aesthetic and Minimalist Design | 2 | Composed at 1280. At 375 a language list occupies 181px of a 214px sticky header |
| 9 | Error Recovery | 1 | There is no 404 anywhere on this site |
| 10 | Help and Documentation | n/a | The feature pages are the documentation |
| **Total** | | **18/32** | **Acceptable (56%)** |

### App shell (Operate) — applicable maximum 40

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `Loading` is well built, then discarded twice (`App.tsx:90`, `:291`); demo sign-in has no pending state |
| 2 | Match System / Real World | 3 | Responses identifies people by `FXZN-WTMB`, not by name |
| 3 | User Control and Freedom | 3 | `ConfirmProvider` gates destruction; no undo after the fact anywhere |
| 4 | Consistency and Standards | 2 | One-filled-button-per-screen rule broken on Login (3) and Check-in (2) |
| 5 | Error Prevention | 2 | `/events/<bad-id>` invites you to save an event that does not exist; `Login.tsx:46` swallows errors |
| 6 | Recognition Rather Than Recall | 2 | 14 Responses rows all bold with the identical form name; the unique reference is muted grey |
| 7 | Flexibility and Efficiency | 3 | ⌘K palette, hinted, hidden on coarse pointers — correct. No filters on Responses |
| 8 | Aesthetic and Minimalist Design | 2 | Four co-equal quiet actions per event card; the destructive one is indistinguishable from the read-only one |
| 9 | Error Recovery | 1 | `/f/<bad-slug>` is one line of small grey Swedish on an empty page |
| 10 | Help and Documentation | 1 | None anywhere in the shell |
| **Total** | | **21/40** | **Acceptable (53%)** |

## Design Specificity Verdict

**Authored for this product in its words; category-interchangeable in its pixels — and the one screen the positioning rests on has had no design attention.**

*LLM assessment:* The copy is unfakeable. Role-attributed testimonials with a comment explaining why inventing a face would be a lie; a `<mark class="pending">` that renders a missing fact as "to be confirmed" rather than plausible prose; policy pages that stay English in every locale and mark `lang` so a screen reader changes voice. No competitor could lift this. The visual system, however, could be lifted wholesale: centred hero, six icon cards in 3×2, a full-bleed tinted testimonial band, a "Nothing to install" panel, footer. Swap the strings and it sells project-management software. The single authored visual idea — the folding paper mark — is 494 KB shoved above the headline on a phone. And `/events/:id/check-in`, whose own copy sells "large type, a big input, a verdict you can read at arm's length, one hand at a door", renders as a ~350px card inside the full desktop chrome with a standard 44px input.

*Deterministic scan:* CLI scan of `apps/forms/src/site`, `components`, `Login.tsx` and `App.tsx` — **0 findings** (exit 0, identical with `--no-config`). Browser detector on three live pages: **6 anti-patterns on `/`**, 4 on `/features/events`, 1 on `/login`. The live findings are what matter: `low-contrast` on `.site__band` eyebrow at **1.1:1** and three figcaptions at 4.3:1 (dark) — measured independently at 1.08 and 1.69 (light). Page-level `line-length` ~88 chars on three feature-page paragraphs. Three findings are false positives: `bounce-easing cubic-bezier(0.2,0.8,0.3,1.4)` exists only inside a CSS comment at `styles.css:1746` explaining its removal; `all-caps-body` fired on a 33-char kicker the detector's own kicker rule also lists; `overused-font inter 100%` is the single-family decision, by design. The detector caught nothing the review missed; the review caught everything the detector structurally cannot (404s, the check-in screen, hierarchy, landmarks).

*Visual overlays:* injection succeeded, the detector ran in-page on three routes, and the live server was stopped afterwards. No persistent overlay was left in a tab.

## Overall Impression

The words are doing all the work and the pixels are letting them down. Two things are genuinely excellent — the copy, and the public respondent form — and the marketing page that carries the copy paints its most persuasive sentences at 2:1 on a phone whose first screen is a language list. The biggest single opportunity is the testimonial band: one CSS change turns the least readable section into the "one dark band on the page" `Site.tsx:279` says was intended.

## What's Working

1. **The copy is the design work.** Failure modes named from lived experience, testimonials attributed to roles with a comment refusing to invent a face, pending facts rendered as visibly pending. This is editorial integrity most products never reach.
2. **The public respondent form.** Single column, "Step 1 of 2" with a real progressbar, three 44px fields, 16px labels, one primary `Next →`, and `Save and continue later` as a first-class escape. Nothing on it needs explaining to a 70-year-old on a phone.
3. **Contrast discipline in the app is real, including derived dark mode.** Every text-bearing element on `/events`, `/invoices` and `/responses` under the shipped demo kit, both schemes: zero failures. And `--tp-focus` is applied systematically — focus visibility is the most consistently correct thing in the stylesheet (both agents confirmed, 15/15 elements, ~10.7:1 light, ~8.5:1 dark).

## Priority Issues

**[P0] Brand pastels are used as text on the light site, in four places, against the palette's own written rule**
- *Why it matters:* `DESIGN.md` spends twenty-five lines deriving that a label on seafoam must be the ink — then `.site__band` (`styles.css:4183`) paints paper on seafoam. Measured: quote body **2.12:1**, figcaptions **1.69:1**, and the eyebrow is coral on seafoam at **1.08:1** — invisible — under a comment at `:4194` claiming "the accent itself has the contrast". The same pair recurs: `.skip-link` at 2.12 (the one control that exists for keyboard users is the least readable on the site), `.feature-card__more` "Read more" at 1.92 six times, and the Login `<h1>` "Sign in" at 2.12. All pass in dark, all fail in light — the palette behaves oppositely per theme and the light rule was never enforced in CSS.
- *Fix:* Invert the band — `background: var(--tp-colour-text); color: var(--tp-colour-background)` at 10.83:1, eyebrow to `--tp-colour-accent` on ink (≈5.5:1), delete the comment. `.feature-card__more` and the Login `h1` to ink. `.skip-link` to ink on paper. All CSS; nothing needs JS.
- *Suggested command:* /impeccable polish

**[P0] The mobile marketing header is 214px of sticky language picker**
- *Why it matters:* At 375×812 `.site__bar` is **213.85px, sticky** — 26% of the viewport, on every page, permanently. `.site__langs` is 181px of it because `styles.css:4357` hides `.site__nav` at that width and does nothing about five wrapping language links. `Open the demo` is squeezed to **57.74 × 80.13px**, wrapping to three lines. The `<h1>` first appears at **y=518**. Casey — one-handed, on the go — never reaches the value proposition. And `#main` / `#features` both have `scroll-margin-top: 0`, so the skip link and `See what it does` land content behind that bar.
- *Fix:* Below 48rem, move `.site__langs` out of `.site__bar` and into `.site__foot` beside the policy links already there. Keep mark + CTA on one ~64px row. Set `scroll-margin-top` on `#main` and `#features` to the bar's height. CSS only.
- *Suggested command:* /impeccable adapt

**[P1] Every not-found path in the product is undesigned, and the site returns 200 for all of them**
- *Why it matters:* `/features/<anything>` → HTTP 200 with header + footer and nothing between (`Site`'s `<Routes>` has no `*` case — the exact failure `Site.tsx:45` warns about). `/f/<bad-slug>` → `Formuläret finns inte.` in small grey Swedish, no heading, no mark, no way back, no language control — a Finnish member with a stale printed link gets an untranslatable sentence. `/events/<bad-id>` → a blank "Edit event" form that asserts the event exists. This product's premise is that links live on printed brochures and QR codes; bad URLs are the normal case, not the edge.
- *Fix:* One `*` route in `Site` rendering a real not-found page from `copy/` (heading, the six feature links, the CTA), served as 404 from `entry-server.tsx`. `/f/<bad-slug>` gets the empty-state treatment `DESIGN.md` already specifies — mark, sentence at full contrast, the action that fixes it — plus the organiser's name and the language switcher. Guard `/events/:id` on a fetched event.
- *Suggested command:* /impeccable harden

**[P2] The door has had none of the design attention its own copy promises**
- *Why it matters:* `/events/:id/check-in` is the emotional core of the positioning — rain, a queue, one hand, bad wifi — and it renders as a ~350px card inside the sidebar, language picker and Sign out, with **two co-equal filled buttons** (`Start camera`, `Check in`) for two different input methods, the count `0 OF 40 CHECKED IN` in the smallest type on the screen, no reserved verdict area (so the layout jumps at the moment the operator needs certainty), no recent-check-ins list, no undo for a mis-scan, and no offline state despite the copy naming bad wifi.
- *Fix:* Make it a mode, not a screen: suppress sidebar and topline at `/check-in`; reference input at display size; the counter as the largest number on the page; a fixed-height verdict panel above the input; a "last five" list with per-row undo.
- *Suggested command:* /impeccable shape

**[P2] Responses cannot answer the question its user opens it to ask**
- *Why it matters:* Fourteen rows, every one bold "Spring meeting registration" — identical — with the only differentiator, `FXZN-WTMB`, in muted grey. No name column, no search, no count. The buyer is a membership secretary whose daily question is "did Anna Lindqvist register?" Invoices, one click away, already has a Recipient column and a running total.
- *Fix:* Swap the weights (respondent name bold, form name muted), add a count and a filter box. The pattern exists in this codebase and did not travel one folder.
- *Suggested command:* /impeccable layout

## Persona Red Flags

**Jordan (confused first-timer):** Five language links before any content at 375; headline at y=518. The persuasion sentences at 2.12:1. `/login` shows **three filled primary buttons** under one line of 12.8px grey with nothing saying what Administrator gets that Member does not, and its `<h1>` is the faintest thing on the page. `Login.tsx:46` is `.catch(() => undefined)` — press a demo button, nothing moves, no message, forever. Event cards offer `Attendance / Check-in / Edit event / Archive` as four identical outlines; Jordan cannot tell which one is safe.

**Sam (keyboard + screen reader):** `.skip-link` → `#main` with `scroll-margin-top: 0` under a 77/214px sticky bar; the skip lands content behind the header — one property from right. `.topline` is a bare `<div>`: language, appearance, identity and **Sign out** sit outside every landmark, so landmark navigation never reaches sign-out. `.skip-link` itself is paper on seafoam at 2.12. The event `progressbar` is labelled "250 places" with `aria-valuenow=40` — the label names the denominator. `.segmented__option`'s 44px hit-area expansion overlaps siblings by 14px, so the right edge of `System` activates `Light`. `/f/<bad-slug>` has no heading, so heading navigation finds an empty page.

**Casey (one-handed, distracted, slow connection):** 494 KB `mark-loop-256.webp` served to every phone without reduced-motion, positioned above the headline; the poster it hides is 17 KB. 214px sticky frame on every scroll of every page. `Open the demo` at 57.74×80.13, three lines. Public form inputs are 375px wide at x=0 — flush to both bezels, `.shell` padding resolves to 0. The demo banner is 95px (12% of the screen) with a "Reset demo data" button on a page where Casey is a respondent. App bottom-bar labels at 10.24px; `Brand` squeezed to 38px against 66px siblings. Eleven tap targets under 44px at 375 (all five language links at 22px tall; all five footer links at 19.8px).

## Minor Observations

- `DESIGN.md`'s YAML frontmatter still carries the pre-narrowing palette — `secondary: #2f6b5c`, `muted: #5c6a67`, `border: #7a8783` — while the table below it and the tokens have `#2e3a38 / #666666 / #858585`. The document disagrees with itself.
- "Norsk bokmål" has a zero rect at 375px — the fifth language link does not render at mobile width while the other four do.
- The shipped demo brand kit sets `--tp-colour-border: #ddd6c8` at **1.28:1** against its page. `DESIGN.md:166` fixes the floor at 3:1 "because a border may be a control's only edge", and every `button--quiet` in the demo is that edge. The Brand feature page's headline is "Contrast checked while you choose". The demo's own primary `#1b263b` is a blue-black in a palette whose document calls a green-grey "a sixth hue wearing a disguise".
- `Loading.tsx` is genuinely well made and `App.tsx:90` discards it for an empty `<main>`; `:291` replaces it with `<p className="muted">`. Three loading treatments, two worse than the component next to them.
- The `.rise` stagger caps at `nth-child(n+6)` and the feature grid has exactly six cards, so card six lands alone and the row does not finish as a row.
- Event card shows `OPEN` as a badge and `· Registration open` 30px below it. Same fact, twice.
- `.site__sectionTitle` uses `clamp(…, 2.6rem)` — the fluid upper endpoint is off the type ramp (`design-system-font-size`, `styles.css:4106`).
- Three feature-page paragraphs run ~88 characters per line at 1280; aim under 80.
- No empty list state exists in the demo — `pnpm db:seed` populates everything, so `DESIGN.md`'s empty-state rule ships unlooked-at.

## Questions to Consider

1. `DESIGN.md` derived that a label on seafoam must be the ink, and `.site__band` paints paper on seafoam anyway. If a twenty-five-line argument did not stop that, what would? Would a `checkContrast` case for "text on a brand fill" have caught what a paragraph did not?
2. "Open the demo" appears four times and every one lands in a navy product called Demo AB. If the demo is the entire conversion path, why does it show a customer's brand instead of Loppa's — and if white-labelling *is* the demonstration, why does nothing on the way in say so?
3. The check-in screen is the emotional climax of the whole positioning and it is a 350px card inside a desktop sidebar. Has anyone opened it on a phone, standing up, in gloves?
4. The site publishes in five languages and gives that fact 26% of a phone's viewport, permanently, on every page. Which number is larger: visitors who switch language, or visitors who never reach the headline?
5. The hero's animated mark is 494 KB; the poster it hides is 17 KB. The comment defending the retina gate says it "buys the least where it costs the most" — and then serves the 1x to every phone anyway. What is the fold worth on a phone?

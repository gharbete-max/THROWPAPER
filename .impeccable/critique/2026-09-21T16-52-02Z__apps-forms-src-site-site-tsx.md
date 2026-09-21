---
target: apps/forms/src/site/Site.tsx
total_score: 23
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
target_fingerprint: "sha256:286976169e7a5c236a57101b404fbb9b029cdc39bc029e10aad497bc61553706"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
timestamp: 2026-09-21T16-52-02Z
slug: apps-forms-src-site-site-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + built-in browser sub-agent, 1280/375 × light/dark, Vite dev at :5173 from worktree `claude/l0-baseline` @ 691d40a)

Scope: the marketing site only (`Site.tsx`, Persuade). The app shell was not re-scored in this run; L0 records the site trend, the shell is re-measured in the final design pass.

## Design Health Score

### Marketing site (Persuade) — H7 and H10 n/a, applicable maximum 32

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | No `aria-current` and no visual current state on `.site__nav` links (`Site.tsx:112-116`, measured `null` on `/features/events`); `document.title` is "Loppa" on every page in the dev build; 404 answers HTTP 200 |
| 2 | Match System / Real World | 4 | Copy is concrete and domain-true throughout (`en-GB.ts:120-130`, quotes `:198-210`) |
| 3 | User Control and Freedom | 3 | CSS-only pause works without JS; but feature pages have zero calls to action in `<main>` and the back link reads "Everything it does" (`Site.tsx:412`), a heading, not a direction |
| 4 | Consistency and Standards | 2 | Three filled "Open the demo" on one page (`Site.tsx:121, 198, 379`), two on screen at once at 375px, against `DESIGN.md` "at most one per screen"; `.hero__eyebrow`/`.site__eyebrow` still byte-identical (`styles.css:4275-4283`, `4297-4306`) |
| 5 | Error Prevention | 3 | Native `required`/`type=email`, honeypot out of tab order; no privacy line beside "Send" |
| 6 | Recognition Rather Than Recall | 3 | Related-feature links are seafoam at **2.12:1** — they do not read as links; header shows 3 of 6 features and is `display:none` at 375 with no menu button |
| 7 | Flexibility and Efficiency | n/a | Persuade: no expert path on a read-once page |
| 8 | Aesthetic and Minimalist Design | 3 | Feature pages: 83% of article characters in `#666` (`Site.tsx:419, 425`); 704px column → 88 cpl estimate, 71 measured; desktop landing fetches 506 KB (`mark-loop-256.webp`), 1,021 KB at dpr 2 |
| 9 | Error Recovery | 3 | Contact fields carry no `aria-describedby`/`aria-invalid` (`Site.tsx:498-512`) despite `DESIGN.md` requiring fields to own their messages |
| 10 | Help and Documentation | n/a | Persuade: `/faq` exists; no task documentation expected |
| **Total** | | **23/32** | **Acceptable (72%)** — up from 22 |

## Design Specificity Verdict

**Authored voice on a category-standard skeleton.** The words could not belong to another product ("the door", "in the rain, with a queue", role-attributed quotes, the folding mark as the only hero image, folded-corner chips echoing it). The *structure* is interchangeable — eyebrow → headline → two buttons → 3×2 icon cards with "Read more →" → dark quote band → CTA panel → footer — and the one thing a form builder's site can show that nobody else can, **its own form**, appears on none of the 14 pages. No screenshot of the builder, the grid, the admission card or the door.

**Deterministic scan.** `detect --json apps/forms/src/site/Site.tsx` → 0 findings. Directory scan → 1 warning, `broken-image` at `hero-motion.test.ts:58` — a **false positive** (a regex literal asserting on source; the same pattern is already suppressed for `lib/motion.test.ts` but the suppression is file-scoped). `styles.css:4434` → 1 advisory, `design-system-font-size`: `.site__sectionTitle` fluid max `2.6rem` is off the ramp (judgement call, not a bug). Runtime detector, injected on six pages: `all-caps-body` on `p.hero__eyebrow` (33 chars); `line-length` ~88 on the three `p.muted` point bodies of every feature page and on the CTA panel in `/sv/`; `kicker-above-heading` ×3 on the landing; `monotonous-spacing` 61–69% on feature, contact and 404 pages; and a live `bounce-easing` `cubic-bezier(0.2, 0.8, 0.3, 1.4)` that is **not** one of the three curves suppressed in `.impeccable/config.json`.

**Visual overlays.** Injection succeeded (Vite dev sends no CSP; the `script-src 'self'` policy lives in `api-forms/server.ts:234` and applies to the served build, not to `:5173`). The live server ran on :8400 and was stopped (`/health` → connection refused afterwards). Overlays were painted in the sub-agent's own tab; they are not on the tab the owner sees.

## Overall Impression

The site has a voice and holds its palette in both schemes — every dark-mode pair measured ≥ 5.07:1. What it lacks is a second act: the landing persuades, and the feature pages then hand the reader a grey column with no picture, no action and links they cannot see. The single biggest opportunity is to show the product on the pages that describe it.

## What's Working

1. **Motion that degrades honestly.** `<picture>` with `media` gates (`Site.tsx:264-294`): reduced-motion never fetches the loop, a phone gets the 17 KB poster (measured `currentSrc = mark-poster-256.png` at 375), pause is a CSS checkbox. It works with JavaScript off, which is production.
2. **The ink band for quotes** uses `text` as ground and `background` as type — the one pair that reads under any customer palette; it inverts correctly in dark (band `rgb(248,247,244)`, figcaption 7.15:1).
3. **Focus and skip are right.** 8/8 tabbed elements show a 1.6px ink outline; `#main` has `tabindex=-1` and `scroll-margin-top: 80px` against a 77px sticky bar — the skip target lands exactly at the bar's edge, not under it.

## Priority Issues

- **[P0] Related-feature links are unreadable.** `.site__more a` (`styles.css:4620-4627`) is `--tp-colour-primary` at `--tp-text-sm`: seafoam on page = **2.12:1** at 12.8px, 20px tall at 375. Nine links per feature page and the 404 fail WCAG 1.4.3, the 3:1 non-text floor and the 44px rule. `DESIGN.md` already documents 2.12:1 for exactly this pair and forbids `accent`/`primary` as text. **Fix:** `color: var(--tp-colour-text)` (or `accent-ink`), `min-block-size: 44px`, underline on hover. `/impeccable harden`.
- **[P1] Feature pages set the argument in grey, wide, with no exit.** `Site.tsx:419` (lede muted) and `:425` (every point body `className="muted"`): 790/954 characters in `#666`; column `max-inline-size: 44rem` (`styles.css:4565`) → 704px; `<main>` contains no CTA. **Fix:** body in `--tp-colour-text`, prose measure ~36rem, a quiet CTA row after `.site__points`. `/impeccable typeset` then `/impeccable clarify`.
- **[P1] Three filled primaries and no current-page state.** `Site.tsx:121, 198, 379`; at 375 two are in the first viewport. `.site__nav` has no `aria-current` and no styled current state, contrary to `DESIGN.md` § nav. **Fix:** header button → `button--quiet`; `aria-current="page"` from `useLocation()` (already imported at `Site.tsx:159` for the language switcher) and a weight rule on `[aria-current]`. `/impeccable quieter`.
- **[P2] Feature chips paint seafoam on seafoam.** Glyph `#6fb8a6` on 12% seafoam tint over the card = **1.79:1** light (1.62:1 on hover); 5.90:1 dark. `aria-hidden`, so not a WCAG failure, but the chips are the cards' only colour. **Fix:** glyph in `--tp-colour-text`, keep the tint. `/impeccable colorize`.
- **[P2] Nothing after the demo.** No pricing, no plan; `legal.ts:314` is pending. Feature pages end at the footer; the 404 has more onward links than a feature page. **Fix:** a CTA row on feature pages now; a "how it is sold" paragraph when the owner supplies the facts (§1.2 of the checklist — not engineering's to invent). `/impeccable onboard`.
- **[P3] Pending markers whisper.** `.pending` renders 12.8px inside 16px prose at **4.06:1** light (warning on 18% tint) — below AA for a marker that is meant to be loud. **Fix:** inherit font-size; carry the warning colour as border/underline with ink text. `/impeccable polish`.

## Persona Red Flags

**Jordan (first-timer, phone, from a printed link):** header + 196px decorative mark (`order:-1`, `styles.css:4729`) fill the first 321px; headline at y=381, primary at y=603. Two "Open the demo" visible at once; the target page says "Sign in as …" three times plus an email field, on a page that just promised nothing is real. On a feature page the related links are 20px tall at 2.12:1 — she will not find them, and there is no button when the page ends. Nothing tells her the cost.

**Sam (screen reader):** nav announces no current page; every page announces as "Loppa"; six feature cards are single links whose name is title + summary + "Read more" — "Read more" heard six times inside links that already have names (`Site.tsx:328-342`); contact fields have no error wiring. Working: skip link first in tab order and lands clear; pause checkbox labelled; legal links carry `lang="en-GB"`; `<mark class="pending">` reads as "to be confirmed".

**Alex (evaluating for an association, desktop):** headline says twelve languages, the switcher offers five (`SITE_LOCALES`); no screenshot of anything the copy describes; `/privacy` has ten "to be confirmed" markers including hosting and retention — the questions his committee will ask; no pricing; a 1,021 KB WebP for a 304px decoration on a 2× display; feature pages at 88 cpl in `#666`.

## Minor Observations

- Language switcher uses `aria-current="true"` (`Site.tsx:171`); `"page"` is the conventional token.
- Section nav and language bar are `display:none` at 375 with no menu button; the six features are reachable only from the cards and the footer.
- Touch targets under 44px at 375: `a.site__mark` "Loppa" 108×25; footer "Terms" 38×44; `a.site__lang` "Dansk" 42×44; `a.site__back` "Back" 51×20 on `/contact`.
- `.feature-card__more` is 4.35:1 at 12.8px light (fails AA by 0.15; 6.80:1 dark).
- The footer tagline repeats the CTA panel's demo disclaimer verbatim within one screen at 1280.
- Contact inputs are 704px wide at 1280 — a full-measure email field; "Send" is 70px wide.
- `hero-motion.test.ts:58` should be added to the detector's file-scoped `broken-image` suppression beside `lib/motion.test.ts`, so the directory scan stops reporting a regex.
- The 404 route returns HTTP 200 from the dev server (SSR status is not verified here).

## Status of the previous run's findings (2026-09-15 → 2026-09-21)

| # | Finding | Status |
|---|---|---|
| 1 | "Open the demo" leaves the site for a page titled "Sign in" | **Mostly fixed** — `/login` now heads "Open the demo" with "Nothing here is real"; residual "Sign in as …" wording and an email field |
| 2 | 494 KB loop on every phone; only 2× width-gated; "Pause the animation" first text | **Fixed** — both sources gated; 375 gets the 17 KB poster; pause label hidden under 700px |
| 3 | Three filled "Open the demo"; duplicated eyebrow rule | **Still present** |
| 4 | 404 lists every feature; skip target under the 77px bar | **Half fixed** — skip target clears (80px margin vs 77px bar); 404 still lists six, at 2.12:1 |
| 5 | Feature chips ~1.9:1 | **Still present** — 1.79:1 |
| 6 | Feature pages in muted `#666` | **Still present** |
| 7 | "Read more" 4.35:1; related links 2.12:1 | **Still present** |
| 8 | No `aria-current` on nav; `<video>` unnamed | **Half fixed** — there is no `<video>` (it is `<picture>` + `alt=""`); `aria-current` still missing |
| 9 | ~88 cpl on feature pages | **Still present** — 704px column; 71 cpl measured on a real paragraph, 88 by the width formula |
| 10 | No pricing; contact the only way onward | **Still present** — owner's decision (§1.2) |

## Questions to Consider

1. Why does a site selling a form builder never show a form — not the builder, not the admission card, not the door the copy keeps describing?
2. `DESIGN.md` says one filled button per screen; the landing has three and a phone shows two at once. Which document is wrong?
3. The headline says twelve languages and the switcher offers five. Is the site itself the first customer that "Publishing is blocked on a missing translation" should have stopped?

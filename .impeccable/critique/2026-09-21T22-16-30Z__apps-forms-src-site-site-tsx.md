---
target: apps/forms/src/site/Site.tsx
total_score: 25
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
target_fingerprint: "sha256:4278e813cee96a1d3a693eb70f81dc9f5ca8a77cf882c296b91cd92b1c047b02"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
timestamp: 2026-09-21T22-16-30Z
slug: apps-forms-src-site-site-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + built-in browser sub-agent, 1280/375 × light/dark, Vite dev at :5173 from worktree `claude/design-pass` @ 709179e+)

Scope: the marketing site only (`Site.tsx`, Persuade), fourth run; the app shell is not re-scored.

## Design Health Score

### Marketing site (Persuade) — H7 and H10 n/a, applicable maximum 32

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | `aria-current="page"` on the nav and language links (`Site.tsx:117,180`), ink + weight on the current item; but below 60rem the nav is `display:none` (`styles.css:4771`) and nothing marks place on a phone |
| 2 | Match System / Real World | 3 | "Back" on feature pages goes to `/`, not history; the 404 still says "Everything it does" (`Site.tsx:478`) |
| 3 | User Control and Freedom | 3 | CSS-only pause; language switch keeps the page; a phone loses the section nav with no menu |
| 4 | Consistency and Standards | 4 | One filled primary per viewport (bar quiet, hero filled; 2 on the landing page); every read text in the ink, both schemes measured |
| 5 | Error Prevention | 2 | Contact fields: no `aria-describedby`, no `aria-invalid`, no error slot (`Site.tsx:516-542`); a server-side reject has nowhere to land |
| 6 | Recognition Rather Than Recall | 3 | Cards named by title + summary ("Read more" `aria-hidden`); related links ink at 44px; `/privacy` is 559 words with no in-page contents |
| 7 | Flexibility and Efficiency | n/a | Persuade |
| 8 | Aesthetic and Minimalist Design | 4 | Points 608px / 71 cpl, lede at 38rem; legal prose still 704px / 78–80 cpl (`.legal__section p`, `styles.css:5330`) |
| 9 | Error Recovery | 3 | 404 lists every feature (ink links now), no CTA; contact form has no visible recovery path |
| 10 | Help and Documentation | n/a | Persuade |
| **Total** | | **25/32** | **Good (78%)** — 18 → 22 → 23 → 25 |

## Design Specificity Verdict

**Specific, and now consistent with its own `DESIGN.md`.** Five-colour mark palette on a paper ground, the ink band for quotes, folded-corner chips and CTA panel echoing the mark, no gradients, no stock imagery — and, after this pass, no place where a brand colour is doing text's job. What remains is structural (phone navigation, form feedback) and editorial (single-word Swedish headlines), not stylistic.

**Deterministic scan.** `detect --json apps/forms/src/site/Site.tsx` → 0; the site directory → 0 (the `hero-motion.test.ts` regex-literal false positive is now ignored by file); `styles.css` → 1 advisory, `design-system-font-size` at `styles.css:4436` (`.site__sectionTitle` fluid max `2.6rem`, 2.5px above `3xl`) — a judgement call, unchanged. Runtime detector on six pages: `all-caps-body` on the hero eyebrow, `kicker-above-heading` ×3 on the landing, `monotonous-spacing` 65% on inner pages, `line-length` ~88 on the Swedish CTA panel; `bounce-easing` fires only on the dev stylesheet's *comment* (`inComment: true`, 0 CSSOM rules) — the CLI suppression cannot reach the browser bundle, and a production build strips the comment.

**Visual overlays.** Injection succeeded; live server ran on :8400 and was stopped (`/health` refused afterwards). Overlays were painted in the sub-agent's own tab.

## Overall Impression

The contrast discipline is real now — every read sample ≥ 4.75:1 light and ≥ 5.07:1 dark, the composited chip at 9.12:1, the pending marker at 8.49:1 in prose size. The phone's first viewport is right: words first, one filled button, a 17 KB poster. The two dips are a phone with no section navigation and a contact form that gives nothing back when something is wrong.

## What's Working

1. **Every read pair measured, both schemes.** `.site__more a` 10.83:1 / 17.32:1 at 44px; `.feature-card__more` 9.82:1 / 15.78:1; chip glyph 9.12:1 / 12.74:1 over its tint; `.pending` 8.49:1 / 11.48:1 with the warning as a 2px edge.
2. **Phone first viewport.** h1 at y=153 (was 381), primary at y=374 (was 603), one filled button in the first viewport, no horizontal overflow, only the off-canvas skip link under 44px.
3. **No-script honesty holds:** `aria-current="page"` and the quiet bar button are server-rendered; the pause is `:checked`; languages are links with `lang`/`hreflang`.

## Priority Issues

- **[P1] Phone users have no site navigation.** `.site__nav` and `.site__langs--bar` are `display:none` below 60rem (`styles.css:4771,4783`) with no disclosure; from one feature page the only route to another is home → y=695 → a card. **Fix:** a `<details>`/`<summary>` menu (no hydration needed) or a second row of the three links under the mark at ≤60rem. `/impeccable adapt`.
- **[P1] Contact form has no feedback contract.** Four fields, `required`, no `aria-describedby`/`aria-invalid`, no error region, no privacy line. **Fix:** a help line per field with an id, `aria-describedby`, and a server-rendered error state on `/contact` (query param → `aria-invalid` + message). Needs copy — the owner's. `/impeccable harden`.
- **[P2] Single-word headings breach the phone gutter.** `/sv/features/forms` h1 "Formulärbyggaren" at 39.06px measures 336px in a 327px column. **Fix:** `overflow-wrap: anywhere` / `hyphens: auto` on `.site__article h1`. `/impeccable typeset`.
- **[P2] Legal prose measure.** `.legal__section p` 704px, 78–80 cpl, while feature prose is capped at 38rem. **Fix:** the same cap. `/impeccable typeset`.
- **[P3] The 2x loop is still 1,021 KB** on any retina viewport ≥ 1200px, for a 304px decoration. **Fix:** re-encode lighter, or drop the 2x source. `/impeccable optimize`.

## Persona Red Flags

**Jordan (phone, printed link to a feature page):** headline at y=253 under the 77px bar — fine; "Back" goes home, named as if it went back; no way to compare features without going home; "Open the demo" leads to a page called `/login`.
**Sam (screen reader):** landmarks clean (`header`, `nav[Site]`, `nav[Language]`, `main#main`, `footer`, `nav[Policies]`); skip link first; cards named by title + summary; `lang` on the English policy links. Red flag: contact fields with no descriptions.
**Alex (desktop evaluator):** nav links 25px tall (pointer-fine; permitted, but no padded hit area); no pricing, no screenshots of the product — the site's bet is the demo.

## Minor Observations

- 404's back link still reads "Everything it does" (`Site.tsx:478`); the feature pages say "Back".
- Quiet button border 3.38:1 light / 3.28:1 dark — clears 3:1 narrowly; dark cards sit at 1.10:1 on the page and rely on that border.
- Footer "Terms" 38px and "Dansk" 42px wide with 16px gaps — fine under WCAG 2.5.8, not a strict 44×44.
- `SITE_LOCALES` is five; the headline says twelve — owner decision (§1.2), noted once.
- `.site__sectionTitle` clamp ceiling 2.6rem is 2.5px off the ramp (advisory).

## Status of the previous run's findings (2026-09-21 → 2026-09-22)

| # | Finding | Status |
|---|---|---|
| 1 | `.site__more a` 2.12:1 at 12.8px, 20px | **Fixed** — ink 10.83:1, 14.31px, 44px |
| 2 | no `aria-current` on nav; switcher `"true"` | **Fixed** — `page` on nav and switcher; zero `"true"` on six pages |
| 3 | "Read more" in six link names | **Fixed** — 6/6 `aria-hidden` |
| 4 | chip glyph 1.79:1 | **Fixed** — 9.12:1 / 12.74:1 over the tint |
| 5 | `.feature-card__more` 4.35:1 at 12.8px | **Fixed** — 9.82:1 at 14.31px |
| 6 | `.pending` 12.8px at 4.06:1 | **Fixed** — 16px in the prose, 8.49:1, warning edge 4.06:1 (3:1 needed) |
| 7 | feature pages 83% `#666`, 704px, no CTA | **Fixed** — 99.5% ink, 608px / 71 cpl, two buttons in `<main>` |
| 8 | phone: figure first, h1 y=381, two filled in view | **Fixed** — h1 y=153, primary y=374, one filled, two on the page |
| 9 | duplicate eyebrow rules | **Fixed** |
| 10 | back link a heading | **Partly** — feature pages "Back"; the 404 still "Everything it does" |
| 11 | targets under 44px | **Fixed** — mark 108×44, back 51×44, footer and language links 44 tall |
| 12 | 1,021 KB 2x from 900px | **Partly** — gate 1200px; the file is unchanged |
| 13 | nav hidden at 375, no menu | **Still present** |
| 14 | contact `aria-describedby`/`aria-invalid` | **Still present** (needs copy) |
| 15 | pricing; twelve vs five | **Owner decisions**, not scored twice |

New this run: the Swedish h1 overflow at 375 (P2); the legal measure (P2).

## Questions to Consider

1. If the pitch is "it refuses to publish half a language", why does the site ship a Swedish headline that does not fit its own column?
2. The landing page sends people to `/login` three times and to `/contact` twice. What does an evaluator who will not log in get — is the demo the only evidence the site is willing to show?
3. The phone bar is a logo and a button. Is hiding the nav a decision, or a leftover from when the language row made the header 214px tall?

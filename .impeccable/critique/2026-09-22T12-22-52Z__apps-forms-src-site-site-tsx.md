---
target: the marketing site (apps/forms/src/site/Site.tsx)
total_score: 23
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\site\\Site.tsx"
target_fingerprint: "sha256:9f7c44abac85a7b643ffb606b8de33b4e6f7f79b1a2a033efb0240118f55ea4f"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\.claude\\worktrees\\l0-baseline\\apps\\forms\\src\\site\\Site.tsx"
timestamp: 2026-09-22T12-22-52Z
slug: apps-forms-src-site-site-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector + Playwright sub-agent, 1280/375 × light/dark, Vite dev at :5173 from worktree `claude/palette-loppa` @ d4e214b — the first run on the Loppa palette)

Scope: the marketing site only (`Site.tsx`, Persuade), fifth run; the app shell is scored separately.

## Design Health Score

### Marketing site (Persuade) — H7 and H10 n/a, applicable maximum 32

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | The filled primary has **no hover or pressed state**: `.button:hover:not(:disabled)` (`styles.css:149`, ink swap) is out-specified by the later `.button:not(.button--quiet):not(.button--danger)` (`:3517`, the `--tp-button-*` paint) at equal specificity; only the shadow moves 22% → 28% gold, invisible on paper. Older than the palette; measured for the first time this run |
| 2 | Match System / Real World | 3 | "Back" goes to `/`, not history; "Open the demo" lands on a page called `/login` |
| 3 | User Control and Freedom | 3 | CSS pause, language switch keeps the page; a phone loses the section nav with no menu |
| 4 | Consistency and Standards | 3 | Quiet hover swaps the edge to `--tp-colour-primary` (`styles.css:182`): gold on paper at **2.14:1**, weaker than at rest (pewter 3.75:1) — a brand colour painting a boundary unchecked, the thing the derived tokens exist to prevent. The site's h1s are ink while `.shell h1` takes `--tp-colour-heading`, so app and site disagree in dark (gold vs paper) |
| 5 | Error Prevention | 2 | Contact fields unchanged: no `aria-describedby`, no `aria-invalid`, no error slot |
| 6 | Recognition Rather Than Recall | 3 | Cards named by title + summary; the folded-corner chips at 12% gold over platinum measure **1.08:1** (dark 1.24:1) — the one place the mark's language reaches a card, invisible |
| 7 | Flexibility and Efficiency | n/a | Persuade |
| 8 | Aesthetic and Minimalist Design | 4 | 54 cpl hero body, 61 lede, ~70 points; one filled button per viewport; no product screenshots is a bet, not a flaw |
| 9 | Error Recovery | 3 | 404 lists every feature; contact form has no visible recovery path |
| 10 | Help and Documentation | n/a | Persuade |
| **Total** | | **23/32** | **Good (72%)** — 18 → 22 → 23 → 25 → 23. The two-point drop is two hover states measured for the first time; neither is new with gold, both are more visible under it |

## Design Specificity Verdict

**Specific — and the palette is honest in both schemes, thin in light.** Every rendered colour on every site page resolved to a token (B walked `color`, `background`, `border`, `outline`, `fill`, `stroke` in both schemes, both widths: no seafoam, no coral, no legacy value; the three non-palette hits are UA defaults on visually-hidden inputs and the derived `--tp-glass`). The authored things survive — the folding foil mark as the only picture, the folded-corner chips and CTA panel, the ink band, role-only testimonials. But A's verdict on the 1280 light landing stands: it reads as a grey-and-paper page with two gold buttons; gold is luminous in the mark and occupies two 141×44 buttons and six chips at 1.08:1. Dark mode (`#0e0e10`, pale-gold eyebrows, gold-edged buttons, the paper band) is where the two-metal identity lands, with nothing authored.

**Deterministic scan.** `detect --json Site.tsx` → 0; the site directory → 0; `styles.css` → 1 advisory (`design-system-font-size` at `.site__sectionTitle`, the 2.6rem fluid endpoint — the same judgement call as every run). Twelve config-suppressed findings enumerated by B; none is a site colour. In-page (24 page/width/scheme combinations, injection succeeded on all): `all-caps-body` on the hero eyebrow, `kicker-above-heading` ×3 on the landing, `overused-font` (Inter 100%), `monotonous-spacing` 78%, `line-length` ~88 on the Swedish CTA panel; `/privacy` 17–20 hits on the `mark.pending` markers (`border-accent-on-rounded`, `cramped-padding`) — the owner's placeholders. `bounce-easing cubic-bezier(0.2, 0.8, 0.3, 1.4)` fires only on a CSS *comment* Vite inlines in dev; a production build strips it (false positive, as before).

**Visual overlays**: injection succeeded in Playwright (title + `<script>` preflight, `detect.js` from the live server on 8400, stopped afterwards, port closed); there is no [Human] tab — the desktop pane is unreliable here and the run used a headless browser.

## Measured (B)

Light: page `#fafaf8`; h1 ink 18.45:1; `.hero__eyebrow` bronze **4.64:1**; hero button `#cea85c` / ink label **8.61:1** / ink border 18.45:1; quiet border pewter 3.75:1; band ink with eyebrow `#9a794d` 4.79:1; card `#e9ebee`, summary graphite 7.00:1; footer links 8.00:1. Dark: page `#0e0e10`; h1 `#fbfbf9`; eyebrow `#d1af7f` 9.32:1; button gold with a gold edge 8.61:1; quiet border `#686868` 3.46:1; band paper with eyebrow `#836f53` 4.64:1; card `#1c1c1e`. No horizontal overflow at 375 on any page; no text under 11px; targets under 44px: skip link 134×38, three inline body links 25px tall, pause label 138×28, "Dansk" 42 wide, "Terms" 38 wide. Hero loop 1,119,628 bytes served only ≥ 700px with motion allowed; poster 23,936 bytes on a phone (`currentSrc` confirms both).

## Overall Impression

The palette moved and nothing foreign survived — that is the result this run was for. What it exposes is the next layer: the two hover states nobody had measured (one dead, one gold at 2.14:1), and the question A puts plainly — on a light page gold is 2% of the pixels. The dark scheme is the brand at full strength and it is derived.

## What's Working

1. **Every read pair clears AA in both schemes, measured** — eyebrows 4.64 / 9.32, quiet border 3.75 / 3.46, card summaries 7.00 / 6.58, footer links 8.00 / 7.46.
2. **The filled button is the most defined object on the page**: gold fill, ink label at 8.61:1, ink edge on light, gold edge on dark — the mechanism, not a stylesheet exception.
3. **No-script honesty holds**: `aria-current`, `:checked` pause, `<a lang hreflang>` languages, `<source media>` gating 1.1 MB off phones.

## Priority Issues

- **[P1] The primary button has no hover or pressed feedback.** `styles.css:149` `.button:hover:not(:disabled)` swaps to the ink; `:3517` `.button:not(.button--quiet):not(.button--danger)` paints `--tp-button-background` at the same specificity, later, so the swap never applies to a filled button anywhere in the product. Only the shadow changes. **Fix:** a hover rule at or above that specificity — ink at reduced alpha over the fill (`color-mix(in srgb, var(--tp-button-background) 86%, var(--tp-button-text))`, per DESIGN.md's "hover fills are the ink or the brand at reduced alpha") and an `:active` translate. Touches shared button rules; the app inherits it. **Suggested command:** /impeccable polish
- **[P1] The quiet button's hover edge is gold on paper (2.14:1).** `styles.css:182` `border-color: var(--tp-colour-primary)`; the hovered control is less defined than the resting one. **Fix:** `--tp-colour-accent-ink` (bronze, 4.64:1) or the ink; keep the surface tint. **Suggested command:** /impeccable polish
- **[P2] The folded-corner chips are invisible.** 12% gold over `#e9ebee` = 1.08:1. **Fix:** rest at `color-mix(in srgb, var(--tp-colour-primary) 40%, var(--tp-colour-surface))`, hover at full gold with the ink glyph — gold as a fill, which is its job. **Suggested command:** /impeccable polish
- **[P2] The site's headings skip `--tp-colour-heading`.** `.hero__title` and `.site__article h1` are ink; the app's h1 goes gold in dark. Adopt the token or write down why the site stays ink. Same pass: the band eyebrow's derived `#836f53` (dark) / `#9a794d` (light) is `accentInk` walking bronze toward the far pole — legible, and a tone nobody chose. **Suggested command:** /impeccable polish
- **Carried, unchanged:** [P1] contact-form feedback contract (needs the owner's copy); [P2] no phone navigation below 60rem.

## Persona Red Flags

**Jordan (first-timer, phone):** two "Open the demo" within 340px, taps, lands on `/login` — reads as "I need an account". Reaches another feature only via home → y=760 → a card.
**Riley (stress tester, desktop):** hovers the primary — nothing; hovers the quiet — the edge fades; Tab shows a bronze ring on gold with a paper gap, legible. The Swedish h1 wraps inside its column now.
**Casey (mobile):** first viewport right (h1 y=153, primary y=374); the inner-page lede at 33 cpl runs 217px tall; the footer is ten links over four rows with "Deutsch" alone on the last.

## Minor Observations

- Hero body is `muted` at 20px while inner-page ledes are ink — the landing page's argument is the quieter one.
- The sticky bar's overlay shadow paints a dark band under the header at scroll 0.
- "Send" is 70px wide under a 704px textarea.
- Feature pages say "ICU collation", "bigint minor units", "signed token" to membership secretaries.
- `SITE_LOCALES` is five; the headline promises twelve (owner decision, unchanged).

## Questions to Consider

- If gold is "the face", why does a light-mode visitor see it on 2% of the pixels — is the light page a gold identity or a grey one with a gold button?
- The site never runs script; is a hover state its first impression, or a desktop nicety it can live without? Decide — right now it is neither.
- Dark mode is the stronger brand expression by every measure here. The owner chose light default with dark derived; is the site the one surface that should go the other way?

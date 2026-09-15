---
target: Paloppa marketing site and app shell
total_score: 22
max_score: 32
na_heuristics: 7,10
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
target_fingerprint: "sha256:2b57daf106cc25a0222ad7fd1918008b66f9f29d289692a80d6ed76f6d29e3d5"
target_path: "C:\\Users\\gusta\\projects\\THROWPAPER\\apps\\forms\\src\\site\\Site.tsx"
timestamp: 2026-09-15T07-51-16Z
slug: apps-forms-src-site-site-tsx
---
Method: dual-agent (A: design review · B: detector + live browser, Playwright, 1280/375 × light/dark)

## Design Health Score

### Marketing site (Persuade) — H7 and H10 n/a, applicable maximum 32

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Nothing says "Open the demo" leaves the site for a page titled "Sign in" (`Site.tsx:119` → `Login.tsx:29`) |
| 2 | Match System / Real World | 4 | "The door" as a noun; copy in the reader's own vocabulary throughout |
| 3 | User Control and Freedom | 2 | 494 KB loop fetched on every phone that has not set reduced motion; on a phone the first line of text is "Pause the animation" (figure is `order:-1`) |
| 4 | Consistency and Standards | 2 | Three filled "Open the demo" on one page (`Site.tsx:119,196,355`); `.hero__eyebrow` and `.site__eyebrow` are the same rule twice |
| 5 | Error Prevention | 3 | 404 lists every feature; skip target clears the bar (measured: `#main` lands below the 77px bar) |
| 6 | Recognition Rather Than Recall | 3 | Feature chips: seafoam glyph on 12% seafoam tint, ~1.9:1 — decorative but they are the only colour on the cards |
| 7 | Flexibility and Efficiency | n/a | No expert path on a read-once page |
| 8 | Aesthetic and Minimalist Design | 2 | Feature pages set the whole argument in `muted` #666 (lede + every point body); only headings are ink |
| 9 | Error Recovery | 3 | 404 is a page; nothing else to recover from |
| 10 | Help and Documentation | n/a | The feature pages are the documentation — but see Question 1: there is no price, contact or sign-up anywhere |
| **Total** | | **22/32** | **Acceptable (69%)** — up from 18 |

### App shell (Operate) — applicable maximum 40

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | `/f/:slug` renders an empty `<main>` while loading; `App.tsx:90` Suspense fallback is the same; the door's fallback is a literal `…` |
| 2 | Match System / Real World | 3 | Responses now names the person; `EventForm.tsx:105` still labels translation fields `sv-SE`; `:55` shows the literal string `load-failed` |
| 3 | User Control and Freedom | 3 | Undo at the door, cancel/back everywhere; but `<Intro />` eats the first tap on every fresh phone |
| 4 | Consistency and Standards | 2 | `.button--quiet:hover` paints the label `primary` (`styles.css:165-169`) — seafoam at 2.12:1 on page / 1.92 on surface, on every quiet button in the product |
| 5 | Error Prevention | 2 | A door opened on a wrong event id looks fully working and says "Not found" to every scan (`CheckIn.tsx:74-80` swallows the counts 404) |
| 6 | Recognition Rather Than Recall | 3 | Search and names on Responses; the door never names its event |
| 7 | Flexibility and Efficiency | 3 | Camera + typed path, ⌘K, search, undo on the last five |
| 8 | Aesthetic and Minimalist Design | 2 | Demo login: N filled "Sign in as …" plus a filled "Send sign-in link"; EventForm fieldset "Status" holds dates, venue, capacity and status |
| 9 | Error Recovery | 1 | `PublicForm.tsx:124` maps a network failure to `'missing'` → **"Form not found."**; `Inbox.tsx:39` maps one to `[]` → "No responses yet." |
| 10 | Help and Documentation | 2 | `login.devHint` ("the link is printed in the api-forms console") renders unconditionally after submit |
| **Total** | | **23/40** | **Acceptable (58%)** — up from 21 |

## Design Specificity Verdict

**Authored in voice and in the mark; interchangeable in skeleton — and the door is now the one app screen built to the positioning.**

*LLM assessment:* The words could only be this product ("Ask people things. Properly.", "A waiting list is a decision you make, not a state you discover"), the folded-corner radius carries from chip to CTA panel, and the ink band with a coral hairline is a real decision. Strip the words and the landing is still the template: hero-with-figure → six cards → three quotes → CTA. In the app, the door (`CheckIn.tsx`) is authored — fixed verdict, big count, undo — while Login, EventForm and Inbox remain generic admin.

*Deterministic scan:* CLI scan of `site`, `components`, `Login`, `PublicForm`, `Inbox`, `CheckIn`, `App` — **0 findings**, identical with `--no-config` (the 13 ignore-values mask nothing in scope). Browser overlay on three live pages: `/` 2, `/features/events` 4, `/login` 1. Real: `line-length` ~88 chars on three feature-page paragraphs (unchanged since round one); `monotonous-spacing` (~4px used 69% of the time). False positives: `bounce-easing` (exists only in a CSS comment at `styles.css:1858`; verified against `document.styleSheets`), `text-occlusion` ×3 (the overlay's own badges re-scanned), `overused-font` (single-family by design), `kicker-above-heading` ×3 (the eyebrow pattern), `cream-palette` on `/login` (the demo tenant's parchment kit — the customer's colour, not ours).

*Visual overlays:* injection succeeded (`document.title` + script preflight, no CSP meta in dev), detector ran in-page on three routes via a live server on :8400, then stopped. Demo API and Vite were started and stopped; ports 4001/5189/8400 confirmed free. No overlay was left in a tab.

*Measured since round one:* mobile `.site__bar` **77px** (was 214); `<h1>` at 375 first appears at **y=408** (was 518); CTA **140×44** (was 58×80); footer language switcher visible and bar copy hidden at 375; band text **10.83:1**, eyebrow **4.75** light / **5.07** dark, figcaptions **5.28** through the quote's tint; skip link **10.83**; Login `h1` **10.83**; door count **13.42**, idle verdict **5.7**; Responses rows **600 weight**, search input present; sidebar and topline **absent** on the door; the pause checkbox hides the `<picture>` and shows the still. Landmarks on `/` 1/4/1/1.

## Overall Impression

Round one's two P0s are gone and measured gone. What the second pass finds is different in kind: not colours, but *leaks* — the Paloppa intro overlay mounted above every public form, a hover state that repaints every quiet label in the product in the one colour the palette cannot read, and two places where a lost connection is reported as a fact about the data. The biggest single opportunity is one line: move `<Intro />` inside the signed-in shell.

## What's Working

1. **The verdict as an object.** Fixed height, always present, idle/good/warn/bad told in words not only colour, 5.8 / 5.2 / 6.7:1 label contrast. The layout does not move at the moment of judgement.
2. **`buttonSurface`.** The fill keeps the customer's colour, the label is chosen from the palette's own poles, the border carries the boundary — the hard white-label problem solved without inventing a colour, and the reasoning is in the code.
3. **The no-JS pause control.** WCAG 2.2.2 honoured with a checkbox and `:checked`; under reduced motion the 494 KB source is never fetched. Rare to see done properly.

## Priority Issues

**[P0] The Paloppa intro plays over every published form and every door**
- *Why it matters:* `App.tsx:82` mounts `<Intro />` above all routes, including `/f/:slug`. `Intro.tsx:95` prints "PALOPPA" in a `position:fixed; inset:0; z-index:100` overlay for ~3 s on first visit, and swallows the first tap as "dismiss". Every respondent is a first-time visitor on their own phone, so every white-labelled form opens with our name over their brand — the exact leak client mode exists to prevent — and the first tap on the form does nothing. Same on a fresh phone at a door.
- *Fix:* Render `<Intro />` inside `Shell` only (or gate on `!/^\/f\//.test(pathname) && !door`). One-line move.
- *Suggested command:* /impeccable harden

**[P0] Every quiet button's label turns seafoam on hover — 2.12:1 / 1.92:1**
- *Why it matters:* `styles.css:165-169` `.button--quiet:hover { color: var(--tp-colour-primary) }`; the later refinement at `:2627` re-sets only the background, and the topline got a local patch (`:2764`). Everywhere else — "Leave the door", "Undo", "Start camera", "Back", "Save and continue later", "Cancel", "See what it does" — the label vanishes under the pointer or a long-press. Round one fixed pastels-as-text in six places; this is the same fault at the root, and it is on the door.
- *Fix:* Delete `color:` from `:161` and `:168`; delete the now-redundant local overrides. Two lines removed.
- *Suggested command:* /impeccable harden

**[P1] A lost connection is reported as a fact about the data**
- *Why it matters:* `PublicForm.tsx:124` `.catch(() => setPhase('missing'))` → "Form not found." on a dropped connection — the same "false statement that makes somebody give up" the file's own comment at `:309-316` fixed for submit. `Inbox.tsx:39` `.catch(() => setEntries([]))` → "No responses yet." to a membership secretary whose responses exist.
- *Fix:* A `'failed'` phase on the public form with the existing offline copy shape and a retry; on Responses keep `entries` null and show an error with retry.
- *Suggested command:* /impeccable harden

**[P1] The sign-in page contradicts the page that sent you there**
- *Why it matters:* Three "Open the demo" buttons land on an `h1` that says "Sign in", under a yellow "Demo mode" banner and "No email can be read in demo mode, so sign in directly:" (`en-GB.ts:577`), with two or three filled buttons and no way back to the site (`Login.tsx:28` Wordmark is not a link). Then `login.devHint` — "the link is printed in the api-forms console" — renders unconditionally after submit (`:76`), in production. The confident page hands you to one that reads like a bug report.
- *Fix:* `h1` = "Open the demo" when `isDemo`; gate `devHint` on `import.meta.env.DEV`; one filled button (Administrator) and the rest quiet; wrap the Wordmark in `<a href="/">`.
- *Suggested command:* /impeccable clarify

**[P2] Five survivors of round one, each small**
- *Why it matters:* (a) `.feature-card__more` "Read more" is accent-ink on the *card's* surface at **4.35:1**, 12.8px — derived against the page, sits on the surface. (b) `.site__more a` (feature pages and the 404) is seafoam at 12.8px, **2.12:1**. (c) `Inbox.tsx:89-131` puts `<Reveal>`'s `<div>` between `<ul>` and `<li>` — invalid list, screen-reader counts break, and `.inbox__row + .inbox__row` never matches, so the rows have **no dividers**. (d) The door never names its event, and a wrong event id renders a working-looking door whose every scan says "Not found" (`CheckIn.tsx:74-80`, `:95-100`). (e) At 375 the idle verdict wraps to two lines and the panel *shrinks* 178 → 152 on the first scan — the one jump the fixed height was meant to remove.
- *Fix:* (a)(b) → `--tp-colour-text`. (c) `Reveal` on the `<li>` (pass `as="li"`) or drop it in lists. (d) Fetch the event into `door__title`; treat an attendance 404 as `EmptyState`. (e) `.verdict--idle .verdict__headline { font-size: var(--tp-text-lg) }`.
- *Suggested command:* /impeccable polish

## Persona Red Flags

**Jordan (first-timer):** "Open the demo" → "Sign in". "No email can be read in demo mode" means nothing to Jordan. Two filled "Sign in as Administrator / Member" with nothing saying which. `sv-SE` as a field label on Edit event; a fieldset called "Status" that is mostly dates. The confirmation says "Thank you." and drops the form title (`PublicForm.tsx:440`) — what did I just register for, and is a card coming?

**Sam (screen reader / keyboard):** `<div>` between `<ul>` and `<li>` on Responses. Five buttons all named "Undo" on the door — add the person's name to the accessible name. `aria-label` on a `<p>` (`CheckIn.tsx:187`) is not reliably exposed; use visually-hidden text. `EventForm.tsx:192` error has no `role="alert"` (Login and the public form have one). `<video>` with no name. Two `a[aria-current=true]` on `/features/events` are both the language pickers — the active nav link has none.

**Casey (one-handed, slow connection):** Intro overlay 3 s → blank `<main>` until the fetch → the form: nothing to read for 5–10 s on 3G. Connection drop → "Form not found." At the door, `autoFocus` + refocus after every scan (`CheckIn.tsx:103`) raises the Android keyboard over the viewfinder, which sits *below* the form. The 494 KB loop is fetched on every phone that has not set reduced motion. Under 44px at 375: `.hero__pauseLabel` 138×28, `.site__back` 130×20, related-feature links ~20px tall, `.site__mark` 122×25.

## Minor Observations

- "Forms, registrations and the door" appears three times above the fold on desktop (title, eyebrow, footer tagline).
- `App.tsx:309` shell catch-all silently redirects to `/events`; round one's 404 work stopped short of the signed-in shell.
- `styles.css:4184` and `:4203` are identical eyebrow rules under two names.
- `Inbox.tsx:125` `toLocaleString` (with seconds) vs the door's `formatDateTime`.
- `CheckIn.tsx:226` `placeholder="AB12-CD34"` is a literal; no `autoCapitalize="characters"` / `enterKeyHint="go"` while CSS fakes uppercase.
- `Login.tsx:73-77` "sent" state offers no way to try another address.
- `EventForm.tsx:47` fetches the whole event list to find one; `:216` silently converts `archived` → `closed` on save.
- Feature-page paragraphs still run ~88 characters per line at 1280.
- `.site__lang` in the desktop bar 22px tall; footer links 20px — desktop only, pointer targets.

## Questions to Consider

1. The landing page sells a **demo** — "Nothing to install", "Open the demo" ×3 — and there is no price, no contact and no sign-up. Where does a convinced membership secretary go next? Is this a marketing site or a portfolio piece?
2. "What people said afterwards" — did anyone? The code refuses to invent a name; the quotes are presented as real. If illustrative, the eyebrow should say so; if real, a name is not a lie.
3. The lead feature is "Twelve languages"; `SITE_LOCALES` has five. Does the site believe its own pitch?
4. DESIGN.md says the paper language lives under `.system` only and never on a published form, and a test holds the CSS to it. The Intro *component* walks straight past that guard. What else is scoped in CSS but unscoped in React?
5. At arm's length in the rain the operator is looking at the guest, not the phone. Why is there no sound and no `navigator.vibrate` on a verdict?

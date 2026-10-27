# Loppa made easy — a restructure of the UI and the way in (proposed 2026-10-27)

**Status:** accepted 2026-10-27 (owner approved all four decisions and the order); nothing built. From the owner's note after trying desktop 0.3.0: the app is
cluttered, the form creator should be a blank page you drag onto, signing is hard to find your way
around, the look is too professional and boring, a first-run tour is missing, and the guided
questions should reach a template in fewer clicks. Builds on `SIMPLIFY.md` (structure) and
`DESIGN-LANGUAGE.md` (look); where this disagrees with them on *what a first-time person sees*, this
wins and they get amended in the same PR as each slice.

## The one idea

**One thing on the screen at a time, and it is always obvious what to press.** Today every screen
shows what *can* be done. The new rule: a screen shows what you are *doing now*, and one big next
step. Everything else is one press away, never in view. Test for every screen: could a person who has
never used a computer for work say what to press, without reading?

## Principles (these decide arguments)

1. **Max five things on any screen** (not counting the document itself). More than five → move to a
   "More" tray, or a second step.
2. **Verbs, not nouns.** Home says "Fill in a form", "Scan a paper", "Get something signed", "Send a
   file", not Forms / Scan / Sign / Send. Same four parts, plain names.
3. **A blank page beats a toolbar.** Start empty, add by dragging or by asking; settings appear
   only for the thing you touched.
4. **Colour carries meaning and mood**: each of the four parts has its own strong colour (the room
   already has three; extend to the four parts), used for its header, its big button and its
   progress. Rounder, bigger, friendlier; photographs and small cheerful drawings in empty states.
   Gold stays a fill, never text (DESIGN.md); contrast guard stays green.
5. **Say it once, point at it once.** Words repeat less; a helper bubble names a thing the first time
   only.
6. **Nothing is lost by hiding it.** Every current feature stays reachable (More tray, the palette,
   the rail's "Earlier features"). Nothing deleted unasked (CLAUDE.md).

## Slices (in order; each is its own branch, `pnpm verify` + smoke e2e)

### E1 — Home and the shell (smallest, sets the look)
- Room's "Documents opens into four parts" becomes **the home**: four large, coloured, rounded tiles
  with a verb and a one-line promise, plus "Recent" underneath. Spreadsheets/Presentation stay
  floating placeholders, quieter.
- The side rail goes away on narrow screens and shrinks to **four coloured icons + Home + More**
  everywhere else. People, Outgoing, AI centre, Earlier features all move under More.
- Colour tokens per part in `packages/tokens` (new roles, contrast-guarded in light and dark).
- Done when: home has ≤5 pressables above the fold; rail has ≤6 entries; axe clean.

### E2 — First-run tour (speech bubbles)
- A coach layer: the first time, 5–6 bubbles pointing at the real tiles, the rail's More, the help
  button; "Next / Skip"; replayable from More → "Show me around". Each part later shows **one**
  bubble the first time it opens ("Drag a box here →").
- Implementation: one small `Coach` component, a `steps` list per screen (keys in all twelve
  catalogues), seen-flags per step in `localStorage` (like `INTRO_SEEN_KEY`), Escape skips, focus
  and `aria-live` handled, `prefers-reduced-motion` respected. No library (bundle cap).
- Done when: a fresh profile gets the tour once, a second start gets none, replay works, a keyboard
  and a screen reader can finish it.

### E3 — Form creator: a blank white page
- New form opens **straight into a white page** (title line at the top, nothing else). No
  properties, no settings, no history strip.
- **Add by dragging** from one slim tray of ~8 big pictured pieces (Short answer, Long answer,
  Choice, Tick box, Date, Number, Signature, Picture/Text note); also **click to add at the end** and
  **keyboard add** so drag is never required. Reorder by dragging; delete by a small ✕.
- **Click a piece → a small bubble beside it** with only that piece's 3–4 settings (label, required,
  choices); "More options" opens today's full properties. Rules, visibility, translations, versions
  and settings move into that "More".
- **One big button: "Share"**, which expands to Fill here / Download PDF / Send / Sign (today's
  draft actions). Publishing, versions and translations stay in More.
- Native pointer/drag events, not a library (the web bundle is 3.5 KB under its cap; the existing
  `FieldCanvas` is the base — read it first, likely a restyle plus a tray, not a rewrite).
- Done when: a first-timer adds three fields and shares without opening any panel; the current
  e2e builder specs still pass through "More".

### E4 — "Ask Loppa" in the form creator (AI mode) — needs a decision, see below
- A text box on the blank page: "Describe your form — 'sign-up for a football camp'". The local model
  returns a **proposed list of fields**; they land on the page as an editable draft marked
  "suggested", nothing saved until accepted. Offline; greyed with a plain "Set up AI" button when no
  model is installed. Never writes consent, legal, clinical or tax wording (rule 8): such pieces
  arrive as empty, labelled for a human to fill.
- **Constraint:** the builder, interpret and import cores must stay AI-free (non-negotiable 1). So
  the AI path lives in `screens/ai/` and `apps/desktop/src/ai/`, returns a plain `FormDefinition`
  patch that is validated by the existing schema and shown via the existing review step; it never
  runs inside `packages/shared/src/{builder,interpret,import}`. ADR 0023 gets an amendment.

### E5 — The questions (Akinator) in two or three taps
- Today: up to ~7 questions before a template. New: **one screen of 8–12 big pictured cards** ("Sign
  up", "Feedback", "Order", "Booking", "Contact", "Survey", "Application", "Something else") →
  at most **one** follow-up (picture choice) → the preview, with "Looks good" as the one big button
  and "Change a bit" opening the blank-page editor (E3) on that draft. Typed words still work as an
  optional shortcut.
- Reuses the existing graph and the 23 templates; the change is a **shorter graph path and a new
  front screen**, so `builder:validate` rules G0–G14 and a new fixture per changed path
  (CLAUDE.md: a behaviour change needs a fixture in the same commit). Target: median ≤3 taps to a
  previewed template, measured by a scripted e2e that clicks the default answer path.
- Done when: every template is reachable in ≤4 taps; "Something else" lands on the blank page.

### E6 — Signing as a three-step road
- Replace the one big "new request" form (documents, parties, routing, placement, declarations in
  one scroll) with **a stepper in the Scan style**: **1 Pick the paper → 2 Who signs? → 3 Where? →
  Send**. One question per step, big buttons, "Back" always.
- "Who signs?" is just names and emails, one line each, a big "+ Add person"; routing, languages,
  declarations, test mode sit behind "More options" with sensible defaults (everyone, in turn is
  off unless asked).
- "Where?" shows the page with a **ready-placed suggested box per person**; drag to move; Done.
- The list of past requests becomes **status cards** ("Waiting for Anna", "All signed ✓"), one
  clear action each (Remind / Download / Send signed copy). Table goes behind "All requests".
- The signer's own page (apps/sign) gets the same treatment last: one big "Sign here", then "Done".
- Done when: a first-timer sends a request with two people in under a minute, no panel opened.

### E7 — Scan and Send, same treatment (after E1–E6 prove the pattern)
- Scan: its three steps already exist; cut the ~14 buttons to **the 4 that belong to the step**, the
  rest in "More tools" per step. Send: one big "Who and what?" with the address book and campaigns
  behind a tab bar of two.

### E8 — Words and polish
- Rewrite the labels for these screens in plain, warm, short Swedish/English first, then the other
  ten (native review flagged as unverified, as today). Tiny celebratory moments (sent ✓, all
  signed ✓) kept short, off under reduced motion.

## What stays underneath (so the tech keeps working)

No contract, API, database or `packages/` logic changes in E1–E3, E6–E8; they are screens, tokens
and catalogues. E5 changes the guided graph and its fixtures. E4 adds one desktop IPC call and an AI
task. Every outward action still confirms and has a test mode (rule 7).

## Risks

- **Bundle cap** (1258.5 of 1262 KB gz): new screens must replace old CSS/JS, not add; the Coach and
  tray are small and hand-written. Raise the cap only with a reason in the budget header.
- **12 catalogues**: every new string in all twelve; `builder:validate` and the i18n tests enforce it.
- **e2e churn**: moved buttons break specs; each slice updates its own specs and runs smoke e2e,
  one run at a time.
- **Taste is subjective**: do E1 first and look at it before the rest. Use the `impeccable` skill
  with `--target apps/forms` and `DESIGN.md` for the look pass; screenshots go to the owner at the
  end of E1, E3 and E6.

## Decisions for the owner

1. **E4 (Ask Loppa)**: OK to add an AI-drafted form path outside the rule-based builder, with the
   rule-based builder unchanged and an ADR 0023 amendment? (Recommended: yes, as an optional extra.)
2. **Names**: use the verbs on home ("Fill in a form", "Scan a paper", "Get something signed",
   "Send a file") instead of Forms/Scan/Sign/Send? (Recommended: yes.)
3. **Colours**: one strong colour per part, extending the room's three. OK to depart from the
   bronze/gold-led look for the in-app screens? (Gold stays the brand mark.)
4. **Order**: E1 → E2 → E3 → E6 → E5 → E4 → E7 → E8 (home first so the look is judged early, then the
   two complaints, then the questions, AI last). Change?

## E1 in detail — Home and the shell (planned 2026-10-27, read at `0be71ffb`)

**What is there.** `screens/room/Room.tsx` (358 lines): a dark-grey room with three floating
catchers; Documents zooms open into four parts around a rosette (`Part`, `Rosette`, `zoom()`), plus a
"Summary and translation" centre, `RecentDocuments`, a pause button, `AiHint`. The rail is `Shell` in
`App.tsx` (`NavSection` ×5 + Outgoing + AI centre + a folding "Earlier features" group). Room colours
are three fixed hues in `packages/tokens/src/room.ts`, held by `room.test.ts`. Specs that pin this:
`e2e/room.spec.ts` (6 tests: catchers, placeholders not controls, keyboard open + Escape, parts lead
to screens, pause/reduced motion, 360 × 640 in German) and `e2e/rail.spec.ts`.

**Change.**
1. **Home replaces the two-step room.** `/room` shows the four tiles directly (no catcher to open
   first); `/room/documents` redirects to `/room` so old links and Back keep working. Each tile is a
   real `<Link>`: icon, verb ("Fill in a form"), one-line promise, own colour. Spreadsheets and
   Presentation & planning shrink to one quiet row of two labelled "Coming later" (still not
   focusable, still not controls). `RecentDocuments` stays under the tiles. The centre (summary and
   translation) becomes a fifth, smaller tile on desktop with a model; that is the max-five rule.
2. **Delete what the zoom needed**: `Rosette`, `zoom()`, `zoomFrom`, the pause button and the
   floating animation. This removes code and CSS (helps the bundle cap); a soft entrance fade stays,
   off under reduced motion.
3. **Colours.** New `PART_HUES` in `packages/tokens` (forms, scan, sign, send; strong, friendly, each
   with a ≥3:1 boundary and ≥4.5:1 label ink on both the light page and the dark room), tested like
   `room.test.ts`. Light, warm page background for home (the dark grey stays only if you ask for it);
   gold stays a fill, never text. Applied as `--tp-part-<name>` on tiles, then reused as the page
   head colour on each part's screen (small follow-up inside E1: a coloured strip, nothing more).
4. **Rail.** Four coloured icon entries + Home + More. "More" is a small popover/page listing People,
   Outgoing (with its count), Add-ons and updates, language, Earlier features (events, responses,
   invoices, users, brand: unchanged routes, folded exactly as now). Below 720 px the rail becomes a
   bottom bar of the same six.
5. **Words.** New keys in all twelve catalogues: `home.forms|scan|sign|send` + `…Hint`,
   `home.comingLater`, `nav.more`, `nav.home`. Old `room.*` keys that nothing uses are removed in the
   same PR (the i18n test shows which).

**Not in E1.** The tour (E2), any screen inside the parts, the web edition's login screen, the
second and third catchers' content.

**Specs to rewrite in the same PR.** `room.spec.ts`: the six tests become: home shows four named
links (@smoke); placeholders are not controls; keyboard reaches all four, Enter opens; each tile leads
to its screen and Home leads back; reduced motion = no entrance animation; 360 × 640 German fits.
`rail.spec.ts`: six entries, More opens, earlier features still reachable and remembered. Plus a
`tokens` test for the part hues and an axe pass on home in sv/en/ja.

**Steps (one branch `easy-e1-home`, from `main` once #250 is merged).**
1. Tokens + test (`PART_HUES`). 2. Catalogue keys ×12. 3. `Home` component + CSS, route `/room`,
redirect `/room/documents`; delete the zoom/rosette/pause code. 4. Rail + More + bottom bar.
5. Rewrite the two specs; update `docs/MAP.md` (Room row), `DESIGN-LANGUAGE.md` (the room section),
ADR 0022 amendment ("the room is now home"). 6. `pnpm verify` (individually if red), `contract:check`,
`pnpm bundle:budget` (must not rise), `pnpm test:e2e:smoke`, one full e2e run at the end.
7. Screenshots (desktop, 360 px, German, dark) to the owner before merge.

**Risks specific to E1.** ADR 0022 and `DOCUMENTS.md` §2 describe the zoom as the brand's
arrival; removing it changes the owner's own idea of the room, so the ADR amendment says so and the
owner approves the screenshots first. `introSeen`/`shouldPlayIntro` in `lib/motion.ts` is tied to the
rail; check it still fires once on home.

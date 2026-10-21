# Forms UI review, 2026-10-21

Scope: `apps/forms` (screens, lib, catalogues, styles) and `e2e/`. Built app (`vite preview`) against the e2e API and Sign, demo seed, Chromium, signed in with a planted refresh token. Measurements were taken at the branch `claude/review-forms-ui`, after merging `origin/main` at #220. Scratch scripts (sweep, axe, perf) are not in the repo; axe-core 4.10.2 was a scratch install, not a dependency.

## Journey notes (en-GB, 1280 px, plus the fake bridge for AI)

Walked: room, Documents, Forms (guided to "Build it myself", Draft PDF, Fill in, Fill in a PDF, Start from paper), Scan (two files, three steps, Make the PDF), Sign (hand-off from Scan), Send (single with a double-press on Confirm, batch CSV mapping, campaign tab), AI setup (open from disk), Summary (summarise), back and forward.

- No console error or warning, no failed request and no request to any host but this one on any screen, except `/outgoing` (below, fixed).
- Double-press on **Confirm and send**: two recipients, two mails (the API log shows exactly two). No double submit.
- Back from Scan after leaving drops the pages. This is the documented "nothing is kept"; not a defect.
- Each press of **New form** then "Start from questions" creates a draft before any answer, so abandoned starts pile up as "Untitled form" drafts in the list. Left as designed; worth a decision (finding M3).
- Focus after a route change stayed on the rail link (or body). Fixed.
- The reply helper and campaign footer are covered by their own e2e specs and were not re-walked by hand.

## Twelve languages x 1280 / 768 / 360

Twelve screens (room, forms, builder, guided, fill a PDF, scan, signing, send, to send, summary, AI setup, public form) x 12 locales x 3 widths = 432 renders, all screenshots kept in scratch and the 360 and 768 ones for de, ja, ru looked at.

| Check | Result |
| --- | --- |
| Horizontal page scroll | none, any locale or width |
| Clipped or ellipsised text (outside the closed rail disclosure and visually-hidden text) | none |
| Text past the viewport edge | none |
| Untranslated English (rendered text equal to an en-GB value the locale does not share) | none |
| Raw `{placeholder}`, `undefined`, `[object`, `NaN`, message keys | none |
| `lang` attribute follows the locale | yes; the public form follows the form's own languages (sv, en) by design |
| 200% zoom (640 px) and 200% text-only, en and de, room, scan, send | no scroll, no clipping |
| Touch targets at 360 | the bottom bar and buttons are 44 px; only stand-alone inline links in AI setup and Summary are 20 px high (low) |
| Overlap of controls | only the fixed bottom bar over page content in a full-page capture (not a defect) and the builder's row buttons laid over their row by design |

Formatting: dates in the builder's version list used the browser locale (`toLocaleString()`); now the interface locale. Other dates, numbers and plurals go through `Intl` with the session locale (`formatDateTime`, `Intl.PluralRules`). Collation is held by `lib/collation.test.ts`; no list was re-sorted here.

## Accessibility (axe-core, 22 routed screens x en, sv, ja x light, dark; 132 runs)

| Run | Violations |
| --- | --- |
| First run | 4 rules: `aria-required-attr` (builder divider, critical), `landmark-complementary-is-top-level` (builder aside), `page-has-heading-one` (`/outgoing`), `color-contrast` (Brand theme sample button, 2.14:1) |
| After fixes | 0 on every screen, theme and language |

Axe reports text on the page gradient as "incomplete", so contrast was also measured on rendered pixels (text hidden, background sampled): the success badges (Signed, Published, Paid) read 4.1:1 in light; fixed. Light and dark are otherwise at AA on forms, scan, send, signing, AI setup, summary, to send, brand, room, login. (A "New form" 1.00 reading is a measurement artefact: its colours are cream on navy.)

Keyboard (en-GB): first Tab is now a skip link that moves focus to `main`; tab order rail, language, theme, sign out, then the screen; Escape closes the confirmation (focus returns to the button that opened it, and the modal `<dialog>` traps Tab); the rail disclosure opens with Enter; the step bar is reachable. The radio groups ignored the arrow keys; fixed. Reduced motion: no running animation on any screen (the room's float and glow stop). Not done: a screen-reader pass.

## Performance (Chromium, 4x CPU throttle, gzip of served files)

| Route | JS | CSS | LCP | CLS | Long tasks |
| --- | --- | --- | --- | --- | --- |
| login | 140 KB | 17 KB | 292 ms | 0 | 2, max 64 ms |
| room | 145 KB (9 files) | 17 KB | 392 ms | 0 | 2, max 59 ms |
| forms | 160 KB (14) | 17 KB | 416 ms | 0.012 | 1, 58 ms |
| scan | 183 KB (22) | 17 KB | 456 ms | 0 | 2, max 62 ms |
| send | 162 KB (13) | 17 KB | 464 ms | 0.085 | 1, 56 ms |
| summary | 169 KB (20) | 17 KB | 652 ms | 0.024 | 2, max 154 ms |

Lazy chunks load per route (the room does not fetch Scan, Send or Summary code; Send's batch and campaign load on their radio). Bundle budget after this PR: total 1249.2 of 1250 KB (the catalogue key added 12 small strings).

## Findings

Fixed in this PR (tests: `e2e/a11y-keyboard.spec.ts`, `apps/forms/src/lib/badge-contrast.test.ts`):

- H1 No skip link in the app shell, and focus was left on the rail after navigating (`App.tsx`; `app.skipToContent` in all twelve catalogues).
- M1 Radio groups (Send, batch layout, signing order, summary, marks) did not respond to arrow keys (`lib/radio-keys.ts`).
- M2 To send on a server edition asked `/api/v1/outgoing`: a 404, a console error, an error panel with no heading. Now an empty list with its heading.
- M4 The builder's resize divider was a focusable separator without a value; its preview `aside` nested inside a landmark.
- M5 Success badges 4.1:1 in light.
- L1 The Brand theme sample button drew a text colour no real button would (2.14:1); it now uses `buttonSurface`, as the real page does.
- L2 Version dates in the builder used the browser locale.
- L3 `no-bridge.spec.ts` slept a blind second; it now watches the main thread for that second.

Full e2e at the end: 174 of 175 passed; `sign-handoff-cancel` "a cancelled request refuses its signer" failed once at its first link lookup and passed on its own straight after (5 s). Not investigated further; treat as a timing flake.

Open, by severity:

- M3 (design) Abandoned guided starts leave empty "Untitled form" drafts.
- M6 (assets, low on desktop) `mark-loop-256.webp` is 1.09 MB and is fetched by the Intro and by every `Loading` spinner, so a web user downloads it on the first screen (twice at once on Summary). A smaller loop or the 24 KB still with a CSS spin would remove it. Not changed: it is a brand asset.
- L4 Send's first paint shifts once (CLS 0.085, below 0.1).
- L5 Scan fetches the Word, camera and OCR helper chunks on entry; they could wait until used.
- L6 Standalone inline links of 20 px height at 360 px (AI setup, Summary).
- L7 The guided screen's "Build it myself" and "Show all options" are offset from the answer column in German at 360 px.
- Outside this scope, for the owners: `buttonSurface` labels in `packages/tokens` are checked only by their own preset tests; no test samples text over the page gradient or over photographs, so the scrim and chip contrast the brief asked to extend is held by the pixel measurement above and not by a test. In a full `pnpm test` run on this machine under load, two `apps/desktop` tests failed (`ai/coordinator.test.ts` priority order, `ai/graphics.test.ts` consent record); neither touches files in this PR.

## Residual risks

Chromium only; no Safari or Firefox pass. Desktop Electron shell not run (the fake bridge stands in). Translation quality was not judged. Nothing was measured on a real phone.

## Strings for a native read

I cannot judge these; they are only the ones the tools flagged.

- Much longer than the English (over 2.2x): fr `events.empty`, `forms.empty`, `brand.logoColourApply`, `conversation.edit.drag`; ru `public.eid.start`, `paper.read.items`, `conversation.edit.drag`, `review.needEye`; de `send.failed`.
- Left as English on purpose in the catalogues and worth confirming: "Check-in" (da, de), "Administrator" (da, de, nb), "Standard" (da, de, nb, sv), "Original" (es, nb, sv), "Description", "Signature", "Question", "Versions", "Sections" (fr).
- New this PR: `app.skipToContent` in all twelve ("Skip to content"), written by me, not reviewed by a native reader.

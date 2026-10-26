# ADR 0027 — The next two catchers: Spreadsheets, then Presentation & planning, on what Documents proved

**Status:** proposed 2026-10-26. Written because `docs/VISION.md` §7 says nothing more is made for the
placeholders "until Documents is done", and Documents is done and merged. Planning only; nothing here
is built. The owner may overturn any default.
**Vision:** `docs/VISION.md` §3, §5, §6, §7 · **Plans:** `docs/plan/SPREADSHEETS.md`,
`docs/plan/PRESENTATIONS.md` · **Builds on:** ADRs 0015, 0021, 0022, 0024, 0025, 0026

## Context

The room holds three catchers that never link to each other (ADR 0022 §2). Spreadsheets and
Presentation & planning are placeholders: they float, are named, say "Not built yet", and are not
focusable (`Room.tsx`, held by `e2e/room.spec.ts`). The owner's words for them are short:

- Spreadsheets: "a cheat code library full of scripts macro for excel that excel doesnt have, mainly it
  will be a tool helping with excel".
- Presentation & planning: "a tool to help with presentation, pptx and so on. group planning and
  slide-based offline editing and work".

Documents taught what works: a room with four parts around a centre; pure cores with a purity
boundary; JSON data with provenance (ADR 0021); one AI coordinator with models as manifests (ADR
0024/0025); the network only on a confirmed press (ADR 0026); a bundle budget that is now at its cap
(1 249 of 1 250 KB, `docs/MAP.md`). The two new catchers should reuse that, not re-decide it.

## Decision

1. **Order: Spreadsheets first, then Presentation & planning.**
   - Spreadsheets' first slice (Library, Convert) needs no model, no template and no rendering, and the
     owner described it most concretely.
   - Both need an OOXML zip-and-XML core; Spreadsheets builds it once (its phase 0), and Presentation &
     planning arrives second and cheap.
   - They are independent and could overlap, but the bundle cap, one shared e2e run and the review
     economy make one at a time the default. Reversible: nothing in the plans blocks starting both.

2. **Each catcher has four parts around a centre, like Documents.**
   - Spreadsheets: **Library, Convert, Clean, Inspect**; centre **Explain and suggest**.
   - Presentation & planning: **Outline, Slides, Plan, Share**; centre **Summarise, outline and notes**.
   - Each part is a screen with its own route and a way back to the room. Names are catalogue keys in
     all twelve catalogues (rule 4). The first slices are Spreadsheets phases 1–3 and Presentation &
     planning phases 1–3, no model needed.

3. **The catchers stay independent, and the repository enforces it.**
   - Code lives in new pure packages, `packages/sheets` (`@tp/sheets`) and `packages/slides`
     (`@tp/slides`), and in `apps/forms/src/screens/{sheets,slides}/`. Neither imports Documents' screens
     (`scan`, `send`, `sign`, `forms`, `room/documents`), the other catcher, or any backend.
   - An ESLint boundary is added next to the existing ones (`eslint.config.js`), and a unit test lists
     the screens and fails on a cross import. The shared infrastructure is only: `@tp/tokens`,
     `@tp/i18n`, `@tp/ui`, `@tp/ooxml`, `@tp/shared/ai`, the room, and the AI coordinator.
   - **No new HTTP route and no change to `docs/CONTRACT.md`.** Files are read and written in the window,
     in workers; bytes never reach `api-forms`. One desktop IPC is planned (render a Loppa-made deck to
     PDF through the renderer in `apps/desktop/src/main/pdf.ts`, Presentation & planning phase 6).
   - **Desktop only.** The hosted edition says "Not in this edition", as the summary does
     (`HANDOVER.md`, 2026-10-12).
   - The purity boundary of the builder (no React, DOM, `node:*`, `Date.now`, `Math.random` in a
     decision) is copied to both cores, with the same lint pattern.

4. **What is reused from Documents, and what is not.**

   | Reused | How |
   | --- | --- |
   | The room (ADR 0022) | The placeholder becomes a catcher beneath its colour (platinum, bronze). The first new catcher adds arrow-key navigation (`DOCUMENTS.md` §2 deferred it to "a second one"). The inert-placeholder guard in `room.spec.ts` shrinks to the catchers not yet built, then goes. |
   | The AI coordinator (ADR 0024) | New task kinds in `packages/shared/src/ai/task.ts` with a `TASK_CAPABILITY` case; prompts in `apps/desktop/src/ai/text/prompts.ts`. No runtime, channel or download of its own. |
   | The model catalogue (ADR 0025 §6) | The same catalogue and the same one-resident lock. **No second model.** If the catalogue's models are too weak at code, a code model is one more catalogue entry, chosen by the owner and licence-checked. |
   | The summary centre's checks | The digit check, the loop guard, the quote-only word lists for protected wording, the untrusted-input pattern and tests of the reply helper (`reply.test.ts`). |
   | Confirmation and test mode (rule 7) | §6 below. |
   | JSON data (ADR 0021) | Library entries, the function-name table, layout rules, the plan file. |
   | The zip and XML readers | Moved, not copied (§5). |
   | Not reused | Send, Scan, Sign, Forms code and routes; the ledger, events and check-in; the Documents backend. |

5. **One OOXML core, in-house, no new runtime dependency by default.**
   - `packages/ooxml` (`@tp/ooxml`): the bounded zip reader and XML reader that already read Word files
     (`apps/forms/src/screens/forms/builder/paper/{zip,xml}.ts`: DOCTYPE and entity refusal, nesting cap,
     inflated-byte budget), generalised to resolve spreadsheet, presentation and relationship namespaces,
     plus a zip writer (CRC-32 and `CompressionStream`, both already used in test fixtures and
     `screens/scan/filter/png1.ts`).
   - The first step is a **pure move** of those two files with their tests; the docx reader then imports
     the package. It is a `packages/` change and the PR says so.
   - Edits are **surgical**: a part Loppa does not understand is copied byte for byte, and the output is
     always a new file.
   - Candidates (npm registry and project pages, read 2026-10-26): SheetJS `xlsx` is Apache-2.0 but its
     npm release is `0.18.5` with newer builds elsewhere; `exceljs` is MIT but Node-stream based and last
     published 2024-12; `xlsx-populate` is MIT; `pptxgenjs` is MIT and creates decks only; `pptx-automizer`
     is MIT and Node-oriented; `fflate` is MIT with no dependencies; `jszip` is `MIT OR GPL-3.0-or-later`
     and passes `licence:check`. None is a dependency now. **Fallbacks, in order:** `fflate` for
     the zip layer, `pptxgenjs` for creating decks, SheetJS only if `.xls` is ever wanted. LGPL, GPL and
     MPL code (`ical.js` is MPL-2.0) is not used (ADR 0015).
   - The accepted risk: neither CI nor the development machine runs Excel or PowerPoint, so a
     hand-written file could be "repaired" by the program without a test failing. Mitigations: a minimal
     hashed template, a LibreOffice headless conversion check (opt-in, outside `pnpm verify`, as the real
     model suite is), and the owner opening the spike outputs once. Until then the plans call themselves
     "not yet opened in the program by a person".

6. **Executable content and generated content have their own rules.**
   - **Loppa never runs, injects or auto-installs code.** It does not drive Excel or PowerPoint, does not
     open the VBA editor, writes no `.xlsm`, `.xlam`, `.pptm` or `.ppam`, and puts nothing in a workbook's
     VBA project. A macro reaches Excel only as text the person copies or a `.bas` file they import.
   - **Every library entry is classified by a pure scanner, and the scanner outranks every label.**
     Classes: reads, writes the workbook, touches files, reaches outside Excel, unreadable. An entry
     whose declared class differs from the scan fails CI. The same scanner runs on anything pasted in and
     on anything a model returns. The screen never says "safe".
   - **Library entries are hash-listed, not signed.** A manifest holds each entry's SHA-256; a test fails
     when an entry changes without a review record; the UI says "from the Loppa library, unchanged" only
     on a match. That is integrity, not authenticity, and the screens do not claim more.
   - **Provenance and licence per entry** (author, licence, source, attribution, reviewer, date).
     Entries are written by the project, or permissive (MIT, BSD, ISC, Apache-2.0, CC0) with attribution
     in `THIRD-PARTY-NOTICES.md`. Share-alike and unlicensed material (forum answers, blog posts) is
     excluded.
   - **AI output is a draft, beside the thing it concerns, labelled generated.** It may explain, review,
     summarise, outline, draft notes and propose a formula that has passed the formula linter. It may not
     modify a file, run anything, make a network call, or write tax, payroll, legal, clinical or
     safety-critical wording (rule 8, ADR 0012). It may not draft VBA in the first release. Text taken
     from a file is untrusted data under a fixed instruction with no tools.
   - **Nothing is overwritten and nothing is sent without a press.** Every file output is a new file the
     person saves; no catcher offers "save over the original". There is no mail in these catchers (the
     person attaches a file in their own program), so there is nothing outbound except the optional
     local-network page of Presentation & planning, which asks first, names the address and scope, has a
     test mode that shows what would be served without opening a port, and stops when its screen closes.
   - A value that cannot be read with certainty (an ambiguous date, an unknown time zone, a layout a
     template cannot take) is **asked about, never guessed** (the builder's non-negotiable 3).

7. **The earlier features stay where they are.** Events, registrations, check-in, admission cards and
   the ledger remain under "Earlier features", unchanged and undeleted (`CLAUDE.md`). Neither catcher
   imports them. `HANDOVER.md` decision 4 gave the ledger to Spreadsheets and events and check-in to
   Presentation & planning; this ADR reads that as *eligibility*, not an instruction to move code now.
   The plans list what each could become and the owner picks (Presentations §8, Spreadsheets §9).

8. **The catchers' data are files, not accounts.** A plan is a JSON file passed around; two copies are
   compared and the person picks per difference. There is no identity, no sync service and no cloud
   (ADR 0026 §2's list of permitted network uses does not grow).

9. **Bundle.** The catchers' chunks get **their own budget lines** in `scripts/bundle-budget.ts` (one
   per catcher, set in each catcher's phase 1 from a measurement), so the web total of Documents and
   the room stays under its 1 250 KB cap and is not raised. The function-name table, library entries and
   layout tables are lazy JSON. Each phase reports its delta; words cost about 170 bytes each across the
   twelve catalogues, and that is paid for.

10. **Languages.** Every user-facing string is a key in all twelve catalogues. Library entries and the
    function-name table are data: English required, other languages optional with a visible fallback,
    and a language's function names carry an "unchecked" tag until a person who uses Excel in that
    language has read them. No catalogue is claimed right-to-left. Native-speaker quality stays UNVERIFIED
    for the same reason as Documents'.

## Consequences

- Two more lazy screens and two small pure packages; one pure-move refactor of Documents' zip and XML
  readers; one ESLint boundary; one budget script change; a few task kinds and prompts. No server work.
- The room's keyboard behaviour changes when the first new catcher lands (arrow keys, focus order), and
  the placeholder guard test changes with it.
- The plans carry honest unknowns: Excel and PowerPoint compatibility, function-name translations,
  small-model quality at code, memory on large sheets. Each has a named check in a phase exit.
- `MAP.md` gains rows for both plans; `docs/adr/README.md` gains this ADR; `VISION.md` is not edited (the
  owner's words stand).

## Not decided here

- Everything in `SPREADSHEETS.md` §9 and `PRESENTATIONS.md` §9: reports, the ledger and events
  placements, who verifies library entries in Excel and PowerPoint, drafting VBA, a code model, present
  mode, deck translation, group size and live editing.
- The exact catcher chunk budgets, the room's arrow-key order, and the built-in template's look (set in
  phase 1 of each plan, in front of the owner).
- Whether the hosted edition ever offers either catcher.
- Anything about monetisation, company, terms or pricing (out of scope for development, `docs/MAP.md`).

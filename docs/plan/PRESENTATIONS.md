# Presentation & planning, the third catcher — the plan

**Status:** proposed 2026-10-26. Planning only: nothing in this file is built, and no code, catalogue
or dependency changes with it. **What** this catcher is lives in `docs/VISION.md` §6 and the owner's
words (§0); this file is **how** it gets built. The decisions it shares with Spreadsheets are ADR 0027.
Every default in §1 stands until the owner says otherwise; §9 lists the questions only the owner can
answer, none of which blocks the work. It is written to be built **after** `docs/plan/SPREADSHEETS.md`,
whose phase 0 (the OOXML package) it depends on.

**Measured at** `c6d62e6` (`main`). Repository claims were checked by reading the code at that commit;
web claims carry the date they were read (2026-10-26) and a link in §11; anything not confirmed from a
primary source is marked UNVERIFIED.

## 0. What the owner asked for

> Events and planning will therefore be a tool to help with presentation, pptx and so on. group
> planning and slide-based offline editing and work.

and, for the room, that this catcher is a third tool that **does not link to the others** and opens
onto four parts around a centre like Documents.

Read plainly: Loppa does not replace PowerPoint. It helps a person **build, take apart, reorder and
re-use `.pptx` decks without PowerPoint and without a network**, and helps a **group plan** a talk or
an event with files they pass around instead of an account. The centre's local model summarises a deck,
drafts an outline and speaker notes, and proofreads. It is the lightweight helper again.

## 1. Defaults this plan takes, unless the owner says otherwise

| Open item | Default | Why |
| --- | --- | --- |
| Which presentation program | **PowerPoint's `.pptx`** (and `.potx` templates, read only). Keynote, Google Slides and LibreOffice Impress open `.pptx`; none of them is a target. | The owner said "pptx". It is an open standard (ECMA-376 / ISO/IEC 29500), a zip of XML parts. |
| What "slide-based offline editing" means | **Structure and text, not pixels:** open a deck, see it as an outline, reorder, delete, duplicate, split out and merge slides, replace text safely, extract notes, build a new deck from an outline. **Not** a drawing editor. | Faithful rendering and free-form editing of arbitrary decks is PowerPoint's job; "Not Acrobat" applies here as "not PowerPoint". |
| How a deck is made | **A template package plus slide parts the project writes**, using placeholders that inherit position and look from the template's layouts. One built-in template (six layouts, authored once, hash-pinned); a person's own `.pptx`/`.potx` is a template too. | Placeholder slides are tiny and cannot fight the template's design. No presentation library is needed (§4). |
| Edition | **Desktop only**; the hosted edition says "Not in this edition". | As Spreadsheets: `HANDOVER.md` of 2026-10-12, and nothing needs a server. |
| Where files are processed | **In the window, in a worker.** No server route, no `docs/CONTRACT.md` change. PDF export of a Loppa-made deck uses a small desktop IPC to the PDF renderer Electron already has (§3, Share). | Independence (VISION §3) and offline (ADR 0026). |
| Writing `.pptx` | **Always a new file; the original is never touched.** Parts Loppa does not understand are copied byte for byte. | Rule 7 spirit; a rewritten deck loses animations, SmartArt and charts. |
| Picture of an imported slide | **No claim of fidelity.** An imported deck is shown as an **outline** (title, text, notes, picture count) and, in a later phase, a **rough preview** labelled as such. A Loppa-made deck renders exactly (same model). | A faithful `.pptx` renderer needs a layout engine; the same call as Word to PDF (`HANDOVER.md` decision 3: rough and labelled). |
| Group planning | **A plan file the group passes around** (JSON, ADR 0021), views for agenda, timetable and board, `.ics` in and out. **No accounts, no cloud.** Sharing is by file; the local network is a later, confirmed, read-only option. | The owner's "group planning" in an offline-first product (ADR 0026). |
| Merging two people's copies | **Two-way compare; the person chooses per difference.** No automatic merge, no silent last-writer-wins. | Never destroy a person's edit; no common ancestor is kept. |
| The four parts | **Outline, Slides, Plan, Share**; the centre is **Summarise, outline and notes**. | §3. Each is one verb the person already does to a deck or a plan. |
| First slice | **Phases 1–3: the catcher opens, Slides (open, outline, notes out, reorder, delete, split), Outline → deck.** Plan is the second slice. | §6: shares the OOXML core with Spreadsheets, so it is cheap after that; "pptx" is the headline word. |
| The earlier events, check-in and attendance | **Stay where they are, out of the room, untouched,** and are not folded into this catcher in the first two slices (§8). | They are a hosted, multi-organisation, collect-from-the-public product, the opposite of a no-accounts planning file. |
| AI scope | **Summarise, draft an outline, draft speaker notes, proofread, and later translate a deck to a new copy.** Output is a draft panel; *Insert* is a press and shows what changes; the result is saved to a new file. | §7, ADR 0027 §6. |
| Protected wording | **A deck's contract, consent, declaration or clinical text is quoted, never reworded or translated** (rule 8, ADR 0012). | Same word lists as the summary centre. |
| Bundle | **A budget line of its own** for the catcher's chunks, set in phase 1 (ADR 0027 §9). The web total is not raised. | The web total is at 1 249 of 1 250 KB (MAP). |

## 2. What the formats are, and what that allows

Read 2026-10-26; the specification itself is large, so the structural facts below come from the
`python-pptx` analysis pages and a Microsoft engineer's PresentationML introduction (secondary
sources for a public standard, UNVERIFIED against ECMA-376's text).

- A `.pptx` is a zip of XML parts joined by relationships. **Slide order is `p:sldIdLst` in
  `ppt/presentation.xml`**, not the file names (`slide1.xml` need not be first). Reordering is editing
  that list; deleting is removing the entry **and** its relationship and, if nothing else uses it, its
  part.
- A slide inherits position and formatting from its **layout**, which inherits from its **master**;
  text lives in `a:p`/`a:r`/`a:t` runs inside shapes. A placeholder shape carries only
  `<p:ph type="title"/>` or an index, so a slide made of placeholders contains almost nothing but text.
- **Speaker notes** are separate `notesSlide` parts linked from the slide (the search did not confirm the
  relationship type; read it from a fixture in phase 0).
- **Text is split into runs** by formatting, spelling and editing history. "Hello {{name}}" can sit in
  three runs. Safe replacement must work over the paragraph, not the run (§3, Slides).
- **Copying a slide between decks** drags its layout, master, theme, media and relationships with it.
  PowerPoint's "keep source formatting" does exactly that; a rough version is a later phase.
- **VBA in PowerPoint (`.pptm`, `.ppam`)** is the same blocked-macro case as Excel's (Microsoft Learn,
  Windows only). Loppa opens `.pptm` read-only as a deck, flags "contains macros", and never writes one.
- **Time and calendar:** iCalendar (RFC 5545, IETF) is the exchange format every calendar program reads. It
  is lines of text, **folded at 75 octets** with CRLF line ends, text values escape `\`, `;`, `,` and
  newlines; date-times are floating, UTC (`Z`) or with a `TZID`, and a UTC-offset form is forbidden (read
  from the RFC 2026-10-26). The RFC page was only partly read; the required `VEVENT` properties
  (`UID`, `DTSTAMP`, `DTSTART`) and the escaping rules are from the standard as I know it and are held by
  fixtures taken from its examples in phase 4 (UNVERIFIED until then).

## 3. The four parts and the centre

Each part is a screen with its own route under the catcher and a way back to the room.

### Outline — write the talk as text, get a deck

- A plain-text outline with a small, documented grammar: `#` a deck title, `##` a slide, `-` bullets
  (indent for sub-bullets), `>` a speaker note, `---` a section break, and an image line pointing at a
  file the person picks. The same text is what *Slides* can export from an existing deck, so a deck can go
  out as an outline, be edited in any text editor, and come back as a **new** deck.
- **Layouts are chosen by rule from the shape of the slide** (a title only: a title slide; bullets: a
  title-and-content slide; one image: a picture slide; two lists: two columns) and shown, overridable per
  slide. Rules, weights and thresholds are data a person can read, with fixtures for each; **no model
  decides a layout** (the builder's non-negotiable 1, applied here by choice).
- **Which template:** the built-in one (Loppa's palette from `packages/tokens`, fonts the platform has) or
  the person's own `.pptx`/`.potx`; layouts are matched by their names and placeholder types, and a layout
  that cannot take a slide's content is reported before writing, never forced.
- Output is a new `.pptx`. The outline is kept beside it as a `.md` only if the person asks.

### Slides — open a deck and work on its structure

- **Open** a `.pptx`: outline view with each slide's number, title, text, notes and picture count; a
  warning list (animations, embedded video, SmartArt, charts, macros, hidden slides, slide numbers that
  restart) so nothing is a surprise.
- **Pull out** the speaker notes and all slide text as plain text, Markdown or CSV (one row per slide):
  no AI, deterministic.
- **Structure:** reorder (drag or move up/down, keyboard-operable), delete, duplicate, hide/unhide,
  **split** (keep these slides as a new deck), and **merge** (put the slides of another deck after these).
  Merge starts with the case that is safe, two decks from the same template or a Loppa-made deck; "keep
  source formatting" for unlike decks is phase 6.
- **Replace text** across the deck with a preview: a find-and-replace and a **fill from a list** (a CSV
  row per output deck, `{{name}}` placeholders), the way Send's batch reuses a list. It works on whole
  paragraphs; the replacement takes the formatting of the first run of the match, and **a match that
  crosses differently formatted runs is shown, not silently flattened**. Cap of 200 decks per list (as
  Send's batch).
- **Save as a new file.** There is no "save over".

### Plan — group planning in a file

- **The plan file** (`*.loppa-plan.json`, §5): a title, a time zone, **people** (a name; an email only if
  the person adds one), **lanes** (rooms, tracks, workstreams), and **items** of three kinds, a *session*
  (start, duration, lane, people), a *task* (due date, people, status) and a *milestone* (a date).
- **Views:** *Agenda* (a day's list), *Timetable* (lanes by time, with overlaps and double-booked people
  flagged and gaps shown), *Board* (to do, doing, done, by drag or keyboard). **Rehearsal timing:** the
  sum of session durations against the time available, and, for a deck, minutes per slide.
- **Calendar files:** *Export* the sessions as `.ics` for any calendar; *Import* an `.ics`. Import reports
  what it could not use (recurrence rules are not expanded; an attendee list or an alarm is ignored; a
  time-zone it cannot name is **asked about**, never assumed) rather than dropping them quietly.
- **Passing it around:** the file is the sharing. *Compare with another copy* shows each item that differs
  and the person chooses which to keep; the result is a new file. No identity: each edit records a free-text
  "by" the editor typed and a time.
- **Share on this network** (phase 7): the desktop serves a **read-only** page of the agenda or timetable to
  people on the same Wi-Fi while the screen is open, behind a confirmation that names the address, the
  scope and the time it lasts; a test mode shows exactly what would be served without opening a port. It
  follows the pattern of the phone-scan relay (ADR 0016's amendment: private LAN address only, a long
  random token, stops when the screen closes; `apps/api-forms/src/desktop/phone-relay.ts`), by a shared
  primitive and not by importing Documents' code (ADR 0027 §3).

### Share — get it out of Loppa

- **Files:** the deck or the plan saved as a new file; a text **handout** (titles, text, notes); an
  `.ics`; a CSV of items. Loppa does not send mail from this catcher: the person attaches the file in their
  own program. That keeps the catchers unlinked from Send.
- **PDF and pictures:**
  - *A Loppa-made deck* is rendered from its own model (16:9 pages) by the desktop's PDF renderer
    (`apps/desktop/src/main/pdf.ts`, a hidden Electron window; the same page, margins and tokens as Documents'
    PDFs) through one new desktop IPC that takes the catcher's own HTML, so no HTTP route and no contract
    change. Slides as PNG use the same page.
  - *An imported deck* becomes a **rough** PDF only in phase 6, labelled "approximate: layout is not
    PowerPoint's" (as Word to PDF is), from text, pictures and simple shapes. A faithful conversion stays out.
- **Not built here:** mail, a link to a hosted viewer, publishing.

### The centre — Summarise, outline and notes

A local-model pane (§7). *Summarise this deck*, *Draft an outline from these notes*, *Draft speaker notes
for this slide*, *Proofread this deck*, and, later, *Translate this deck into a new copy*. With no model it
says so and offers the model list; every part works without it.

## 4. The engine

**What is reused.** `@tp/ooxml` from Spreadsheets phase 0 (zip reader and writer, the generalised XML
reader with the PresentationML and DrawingML namespaces, caps as arguments). Documents' screens are not
imported.

**What is new.**
- **`packages/slides` (`@tp/slides`)**: the pure core, under the same purity boundary as `@tp/sheets`
  (no React, DOM or `node:*`; no `Date.now` or `Math.random` in a decision): the deck model, the outline
  grammar and parser, the layout rules, the package editor (reorder, delete, duplicate, split, merge, text
  replace, notes extraction), the plan schema and views, the iCalendar reader and writer.
- **The built-in template:** authored once as XML by the project (one master, six layouts: title, title and
  content, section, two content, picture with caption, blank), assembled by a script, hash-pinned; a test
  re-assembles it and compares. It contains no third-party artwork or font files; the theme names the
  platform's fonts and the palette comes from the tokens.
- **iCalendar in-house.** `ical-generator` is MIT (`11.1.2`, 2026-10-21) and would do the writing;
  `ical.js` is MPL-2.0 (`2.2.1`), a file-level copyleft that ADR 0015's permissive list does not name, so
  it is not used. An RFC 5545 subset (events, to-dos read, folding, escaping, `TZID`) is about 400 lines
  with fixtures; **default: in-house**, because reading is the risky half and must report what it skips.
- **Time zones** use the platform's `Intl.DateTimeFormat` for offsets; dates are integers in the file
  (local date-time plus an IANA zone name). No Temporal dependency (its availability in the shipped
  Electron is UNVERIFIED).
- **Caps (defaults):** 300 slides, 200 MiB inflated, 25 MiB per picture read for a preview; larger is
  refused with the reason.

**Presentation libraries considered (npm registry, read 2026-10-26; ADR 0015).**

| Candidate | Licence | State | Verdict |
| --- | --- | --- | --- |
| `pptxgenjs` | MIT | `4.0.1`, 2025-06-26; depends on `jszip`, `image-size` | **First fallback.** Creates decks only (no opening of an existing one), widely used; adopt for *creating* if hand-written parts trigger PowerPoint's repair prompt (the risk below). `jszip` is `MIT OR GPL-3.0-or-later`, which `licence:check` accepts. |
| `pptx-automizer` | MIT | `0.9.4`, 2026-09-28; depends on `pptxgenjs ^3`, `jszip`, `@xmldom/xmldom` | Template editing and slide copying across decks. Node-oriented (browser use UNVERIFIED). A **reference** for how slide merging handles layouts; adopt only if merge proves too costly in-house. |
| `officegen` | MIT | `0.6.5`, last published 2022-06-22 | Not used: unmaintained. |
| `ical-generator` / `ical.js` | MIT / MPL-2.0 | see above | In-house instead. |

**The unverifiable risk, stated.** As with `.xlsx`, neither CI nor this machine runs PowerPoint. A
hand-written `.pptx` that PowerPoint "repairs" would not fail a test. Mitigations: placeholder-only
slides on a hashed template; every output also converted by LibreOffice headless in an opt-in script
(the corpus tooling already needs `soffice`); and **the owner opens the phase-0 outputs in PowerPoint
(and Keynote, if there is one) once** (§9, question 2). Until then this plan is labelled
"not yet opened in PowerPoint by a person".

## 5. Data formats (JSON, ADR 0021)

- **Deck model** (in memory and, optionally, saved as `*.loppa-deck.json` so an outline survives): slides
  with a `layout` name, a `title`, `body` blocks, `notes`, and a `generated` flag on any text the model
  drafted and the person inserted (shown as a small label; one press marks it "mine"; not written to the
  `.pptx`, which has nowhere to put it). Keys sorted, schema-validated by Zod on load, first error by path;
  a malformed file is moved aside, never deleted.
- **Plan file** `*.loppa-plan.json`: `version`, `title`, `zone` (IANA), `people[]`, `lanes[]`, `items[]`
  (`id`, `kind`, `title`, `start` as local `YYYY-MM-DDTHH:mm`, `minutes` as an integer, `due`, `laneId`,
  `personIds[]`, `status`, `notes`, `by`, `updatedAt`). Provenance is fields, never comments; a
  "Reset" is simply opening a blank plan; the importer never overwrites the file it read.
- **Layout rules and the outline grammar** are JSON tables with a fixture per row (the builder's
  "a behaviour change needs a fixture in the same commit" applies by choice).
- **Library of templates:** none beyond the built-in one in the first release.

## 6. Phases

One branch and PR per phase, plan first, every gate run singly; `packages/` changes said so in the PR.
Exits are checks a test can make.

| Phase | What | Exit |
| --- | --- | --- |
| **0 — Spike** (shared with Spreadsheets phase 0; adds the pptx half) | Using `@tp/ooxml`: read a generated deck (invented by a script and LibreOffice, never scraped), list slides in `sldIdLst` order with notes; write a deck of three placeholder slides onto the hashed built-in template; reorder and delete with parts cleaned up; read and write an `.ics` fixture. | The deck re-reads to the same outline; **untouched parts are byte-identical** after a reorder; LibreOffice headless converts every output to PDF; an `.ics` from RFC examples round-trips; the **owner opens the outputs in PowerPoint** (§9 q2). |
| **1 — The third catcher opens** | `/room/presentation`; the placeholder becomes a catcher beneath bronze; the four parts and the centre as empty states with their words; its budget line. | `e2e/room.spec.ts` for three catchers (arrow keys, reduced motion, 360 × 640); the placeholder-inert guard is retired because no placeholder remains; contrast unchanged; `bundle:budget` green; no import from the other catchers (the boundary test from Spreadsheets phase 1). |
| **2 — Slides, read and rearrange** | Open, outline view, warnings, notes and text out (plain, Markdown, CSV), reorder, delete, hide, duplicate, split, save as new file. | Fixtures: a deck with notes, a hidden slide, a reordered `sldIdLst`, a deck with an animation and one with a chart (kept byte-identical, listed in warnings). Reordering twice is the identity. Delete leaves no orphan part and no dangling relationship (a validator in the test). Keyboard-only operation proven in e2e; axe clean in sv/en/ja. |
| **3 — Outline → deck** | The grammar, the layout rules, the built-in template, the person's template, the new `.pptx`. | A fixture outline of each shape yields the expected layouts; the same bytes in, the same `.pptx` out (hash); a template whose layout cannot take the content is reported before writing; round trip: deck → outline → deck keeps titles, bullets and notes; LibreOffice headless converts the output. |
| **4 — Plan** | The plan file, agenda, timetable, board, rehearsal timing, `.ics` in and out. | Overlap and double-booking fixtures; a 75-octet fold test with Japanese and emoji text (folding is by octet, never inside a UTF-8 character); `.ics` fixtures from three calendar programs' exports that read or report exactly what they skip; a time zone it cannot name is asked, never guessed; ICU collation orders the people list (å ä ö after z). |
| **5 — Slides II** | Replace text with preview, fill from a CSV list, merge decks of one template. | A name split across three runs is found and replaced, with the match shown when formatting differs; 200-deck cap; merge of two decks from one template keeps order, notes and media (hashes); nothing is overwritten. |
| **6 — Share and compare** | Handout, PDF and PNG of Loppa-made decks via the desktop renderer IPC; the rough PDF of an imported deck; keep-source-formatting merge; *Compare with another copy* of a plan. | A Loppa-made deck's PDF has the expected pages and page size; the rough PDF carries its label; two plan copies with 5 differing items show 5 choices and write a new file; conflicting edits are never merged silently. |
| **7 — Centre** | Task kinds, prompts, checks, the pane (§7). | Fake-engine CI tests; untrusted-input tests; protected passages quoted; Insert shows a diff; nothing written to the source. The real-model measured table is appended here. |
| **8 — Share on this network** | The read-only relay, confirmation and test mode. | Only the listed routes answer, everything else 404s before reaching any app code; the token is 256 random bits; it stops when the screen closes; a test holds the route list, as `phone-relay.test.ts` does. |
| **9 — Demo and guide** | `fixtures/demo/` gains a short deck, an outline and a plan; `docs/USER-GUIDE.md`; MAP rows. | A person can outline → build → rearrange → plan → export by clicking, on the desktop. |

**The first slice is phases 1–3:** a third catcher that opens, a deck that can be read, rearranged and
cut up without PowerPoint, and a deck built from a text outline. No model, no network. Sized at about
two weeks of agent work given Spreadsheets phase 0 exists (an estimate, UNVERIFIED). **The second slice
is phases 4–5** (the plan and `.ics`).

## 7. The centre, and what the model may and must not do

It reuses the coordinator (ADR 0024/0025); nothing new is installed.

- **Task kinds added** to `packages/shared/src/ai/task.ts` and `TASK_CAPABILITY` (all `text`):
  `slides-outline` (draft an outline from notes or a topic), `slides-notes` (speaker notes for one slide).
  **Reused as they are:** `summarise` (over the deck's text and notes, a line before each slide as Read
  with AI does for pages), `proofread` (every span looked up word for word; fixes applied to a copy) and,
  in a later phase, `translate`.
- **May:** write a draft summary, an outline, notes or proofreading marks for the person's own deck,
  shown in the pane, labelled as generated. *Insert* puts a draft into the deck model after the person has
  read it, one slide at a time, with the change shown first; the text carries the `generated` flag until
  the person marks it theirs. The output goes to a **new file**.
- **Must not:** edit a `.pptx` or a plan without the Insert press; invent facts, figures, quotes or
  dates (the digit check flags any number in a draft that is not in the source, and drafts for an empty
  topic use marked placeholders such as `[figure?]` rather than answers); decide a layout, a plan or a
  schedule; send anything; make a network call; write legal, clinical, tax or safety wording (rule 8).
  **A slide that holds a contract, consent, declaration or clinical text is quoted in the summary, never
  reworded, and never translated** (the quote-only word lists in `packages/shared/src/summary`).
- **Untrusted input:** slide text and notes are data between our own tags under a fixed instruction;
  no tools, so an instruction inside a slide has nothing to act on (the reply helper's model, D6 in
  `docs/plan/AI-SYSTEM.md`).
- **Language:** a deck is summarised in its own language or the person's, in all twelve, as the summary
  centre is, and the same per-language bar applies (a language below S1's bar offers none).
- **Vision is optional later:** reading a picture-only slide with the multimodal model is possible
  (`read-page`) and is not in the plan until the owner asks.
- **Quality is measured:** drafting an outline is within a small model's reach; speaker notes that stay
  within the slide's facts are harder (UNVERIFIED). Phase 7 measures before the pane claims anything.

## 8. The earlier events, check-in and ledger: what happens to them

The owner reserved events and check-in for this catcher (`HANDOVER.md` decision 4: "to Presentation &
planning ... they stay in place, out of the room, until then"). Measured at `c6d62e6`
(`wc -l`, whole files, tests excluded):

| Piece | Where | Lines |
| --- | --- | --- |
| Events screens | `apps/forms/src/screens/earlier/{Events,EventForm,EventReport}.tsx` | 622 |
| Check-in door | `apps/forms/src/screens/earlier/CheckIn.tsx` | 488 |
| Events and check-in routes | `apps/api-forms/src/routes/{events,checkin}.ts` | 579 |
| Events table | `apps/api-forms/src/db/schema.ts` (`events`: names per locale, start and end, venue, capacity, registration deadline, status) | |

**What they are:** a hosted-style, multi-organisation product: events in a database, registrations
collected through published forms, a QR door, admission cards, attendance. **What this catcher is:** a
file a group passes around, no accounts, no server.

**Default (A):** they **stay exactly as they are**, in the rail's "Earlier features", unchanged, and are
not moved into this catcher in the first two slices. Reasons: moving them would put a server-backed,
multi-user product inside a no-accounts, offline catcher; nothing about a planning file needs
registrations or a door; and "never deleted unasked" (CLAUDE.md) holds either way.

What the catcher *can* take from them without importing them (ideas, not code):
- the shape of an event (a name, a start and an end, a venue, a capacity) as a **session** item with a lane
  and a free-text location;
- an **attendance mark** per person per session in the plan file (a simple present/absent toggle), for a
  meeting where nobody needs a QR door.

Later options, the owner's to pick (§9, question 4):
- **B.** A one-way **`.ics` export** added to the Events screen, so an existing event can be opened in the
  Plan part as a file. That changes the earlier screen, adds no link between catchers, and is the only
  bridge this plan would allow.
- **C.** Move check-in into Presentation & planning as a fifth tool when a use appears.
- **D.** Retire events and check-in (irreversible; never without the owner's word).

The **ledger** (`routes/ledger.ts`, 419 lines; `packages/calc`) is Spreadsheets' by the same decision of
2026-10-12 and is treated the same way in `docs/plan/SPREADSHEETS.md` §9: it stays; no link.

## 9. Questions only the owner can answer (defaults taken, nothing blocked)

1. **Present mode:** should a presenter view (full screen, notes, timer) for Loppa-made decks be in scope?
   Default: no; it needs a renderer the person would trust on stage, and PowerPoint does it better.
2. **Who opens the outputs in PowerPoint,** and in which version, once in the spike, to confirm no repair
   prompt? Default: the owner, on whatever is installed.
3. **Built-in template look:** the six layouts on Loppa's palette. Default: the tokens' palette with a
   plain, high-contrast design; the owner may supply a template to ship instead (with its licence).
4. **Events and check-in:** A (stay), B (add `.ics` export to Events), C (move as a fifth tool), D
   (retire)? Default: A.
5. **Group size and trust:** is "pass a file round and compare" enough for the group planning, or is a
   shared live board on the local network wanted? Default: file plus compare, then a read-only network page;
   no live editing (it needs identity and conflict handling this product avoids).
6. **Deck translation** into a new copy (a likely request given twelve languages): in, and when? Default:
   a later phase, labelled machine translation, protected text quoted.
7. **Templates:** may Loppa ship more than one built-in template? Default: one.

## 10. Risks

| Risk | Why it matters | What holds it |
| --- | --- | --- |
| Hand-written `.pptx` triggers PowerPoint's repair | Not visible in CI | Placeholder-only slides on a hashed template; LibreOffice check; owner opens the spike; fallback `pptxgenjs`. |
| Merge of unlike decks corrupts masters or media | Hard in OOXML | Same-template merge first; byte-equal untouched parts; keep-source-formatting last and optional; `pptx-automizer` as reference. |
| Text replacement flattens formatting | Silent loss | Paragraph-level match, preview, formatting loss shown, never silent. |
| `.ics` dropped fields (recurrence, alarms) | A calendar item "disappears" | Import reports what it skipped; unknown zones are asked about. |
| Two copies of a plan diverge | People lose edits | Two-way compare, per-item choice, new file; nothing merged silently. |
| A speaker-notes draft states false facts | Read aloud on stage | Labelled generated; Insert is a press with a diff; digit check; placeholders for unknowns; flagged `generated`. |
| Local-network page exposes a plan | Plain HTTP on Wi-Fi | Read-only, token, address shown, test mode, stops on close; the phone relay's stated limits repeated on the screen. |
| Scope creep into "PowerPoint in a window" | Loses the lightweight helper | §1 says structure and text, not pixels; Present mode is out. |
| Bundle | Web total at its cap | The catcher's own budget line; lazy chunks. |
| Dependence on Spreadsheets phase 0 | The OOXML package is shared | Phase 0 is shared work, done once; this plan does not start before it. |

## 11. Sources (all read 2026-10-26)

- python-pptx analysis, *sld slide*: https://python-pptx.readthedocs.io/en/latest/dev/analysis/sld-slide.html;
  Microsoft (Brian Jones), *Intro to PresentationML*:
  https://blogs.msdn.microsoft.com/brian_jones/2006/04/11/intro-to-presentationml-part-1-core-architecture-and-the-presentation-part/
  (slide order in `sldIdLst`; secondary sources for ECMA-376).
- IETF, RFC 5545 *Internet Calendaring and Scheduling Core Object Specification*:
  https://www.rfc-editor.org/rfc/rfc5545 (folding, line ends and date-time forms read; the rest from
  the standard as known, UNVERIFIED until fixtures).
- Microsoft Learn, *Macros from the internet are blocked by default in Office*:
  https://learn.microsoft.com/en-us/microsoft-365-apps/security/internet-macros-blocked (lists PowerPoint;
  Windows only; macro-enabled `.ppam`).
- npm registry, `npm view` of `pptxgenjs`, `pptx-automizer`, `officegen`, `ical-generator`, `ical.js`,
  `jszip` (versions, licences and dates quoted in §4).
- pptxgenjs README (MIT; generates, does not open): https://github.com/gitbrent/PptxGenJS (via search
  results; the licence is also from the npm registry).

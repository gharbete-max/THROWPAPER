# The room, and finishing the Documents catcher — the plan

**Status:** accepted 2026-10-07. The owner answered two of §9's questions: the room's colours are
Loppa's own, made stronger, and the centre summarises and translates in all twelve languages. The
owner accepted the rest with its defaults ("Let's go!"). Every default in §1 stands until the
owner says otherwise. **What** Loppa is lives in `docs/VISION.md`; this file is **how** the
Documents catcher gets built and finished.

**Measured at** `eea1774`, whose app code is `main`'s at `5ede4ba`. Six read-only mappers, two
independent drafts and an adversarial critic produced it. Their measurements are quoted here; claims
they could not verify are marked UNVERIFIED.

## 1. Defaults this plan takes, unless the owner says otherwise

Each is a default for an item that `VISION.md` §10 leaves open. The owner accepted them with the
plan; §9 says which the owner answered and which stand as defaults. A later answer changes this
list, not the phases.

| Open item | Default |
| --- | --- |
| Edition | **The desktop app first.** It is offline, the summary runs on the person's own machine, and Send already hands mail to the person's own mail program. The hosted web app follows; it gets no summary. |
| Where the editing basics live | **Scan** holds the page work: put files together, take pages out or split them, turn, reorder and delete pages, and make one PDF from photos and scans. **Forms** holds filling: fill in a PDF's own fields or a Loppa form, and keep it as a PDF without publishing. |
| Word | **Input only for now.** A Word file is read into a form, or summarised. It is not written or converted to PDF yet. |
| Scan's output | **Either a PDF to keep or a form**, chosen after reading. |
| Sign | **On the desktop, the person signs on this device.** Others sign by a link only where Sign is online: the hosted edition, or a desktop connected to an online Sign. The desktop's own Sign serves its links on this computer only (ADR 0016). |
| Collecting answers | **Kept as a secondary choice in Forms ("Share to collect").** Download, Sign and Send come first, and Publish stops being the main button. |
| The placeholders | **Inert and honest.** They float, are named, and say "Not built yet". They are not focusable and offer no button that does nothing. |
| The room's look | **The room alone is dark grey**: a new grey token, not the derived dark's near-black. **Beneath each catcher is one of Loppa's own colours, made stronger** so it stands out against the grey (the owner's answer): gold beneath Documents, platinum beneath Spreadsheets, bronze beneath Presentation & planning. Each tool keeps today's look once its catcher opens, and the colours stay in the room. |
| Earlier features | **Behind one switch, off by default:** events, registrations, check-in, attendance, the inbox, invoices and the ledger. Their code, tables and tests stay, and e2e runs with the switch on. Mailer is parked. Nothing is deleted. |
| The centre | **Summary and translation in all twelve of Loppa's languages** (the owner's answer), by one model: **Qwen3-1.7B** (Apache-2.0, about 1.1–1.3 GB at 4-bit, UNVERIFIED), thinking off. It is a separate model file, downloaded once on request from Loppa's GitHub release or opened from disk, and never inside the installer. |
| What the centre reads of a form | **Both:** a blank form's labels and a filled form's answers. |
| Contracts, consents, declarations and clinical forms | **Quoted, never reworded or translated.** For these the centre picks passages and quotes them in the original language (rule 8, ADR 0012). |
| How the centre is shown | **Beside the document**, labelled as generated, never stored, and never written into the document. |
| Changing a document's text | **Not among the basics.** The basics change pages and fill fields; a Word file's text is not edited. |
| Invoices | **Behind the earlier-features switch**, neither Send's nor Spreadsheets' until the owner places them. |
| Bundle | **The 1 000 KB total stands.** Each phase pays its own cost, and a cut pass buys headroom where it does not fit. |

## 2. The room

**Where it lives.** It lives in `apps/forms` at **`/room`**: on the desktop first, and on the hosted
edition if it stays.
- `/` cannot be the room. On a server, `/` is the marketing site (`site/routes.ts`). The desktop
  ships no `dist-server`, so a hard load of `/` there client-renders the site too.
- These now go to `/room` instead of `/events`:
  - `Callback.tsx` (sign-in lands on `/`);
  - the Shell's `/` and `*` routes in `App.tsx`;
  - `Login.tsx`'s `window.location.assign('/events')`.
- The room is full screen, with no rail: it joins `App.tsx`'s door regex.
- `/room`, `/signing` and `/outgoing` join `sitemap.ts`'s disallowed list.

**The look.**
- The room is dark grey, the owner's word: a new grey token scoped to `.room`, not the derived
  dark's near-black (`#0e0e10`). Its exact value is set in phase 2.
- The three colours beneath the catchers are **Loppa's own, made stronger**: new fixed tokens in
  `packages/tokens` (**a `packages/` change**), used nowhere outside the room and never for status.
  - **Why stronger.** Measured against a dark grey of `#2a2a2e`:
    - gold's face (`#cea85c`) reads at 6.38:1;
    - platinum's face (`#c6cad1`) at 8.69:1;
    - bronze (`#8f6b3a`) at 2.95:1, under the 3:1 a shape needs, so it is lifted.
  - Gold and platinum are 1.36:1 apart, so they differ by warmth rather than lightness. Making them
    stronger pushes gold warmer and platinum cooler.
  - The contrast guard in `packages/tokens` gains a test: each colour at 3:1 or more against the
    room's grey.
- Each catcher's name is always shown as text, so colour is never the only signal.
- Each catcher is the existing mark still (`Mark.tsx`, 24 KB), floating over its colour.

**The motion.** CSS and inline SVG only, with no animation library. Only `transform` and `opacity`
animate.
- **Float:** a staggered CSS bob. The 1.1 MB chomp loop never plays in the room.
- **Zoom:** `document.startViewTransition` with `flushSync`. React Router's `viewTransition` needs
  its data mode, which the app does not use. Where the browser has no view transitions, the zoom
  is a cut.
- **Open:** an inline SVG of `mark-geometry.ts`'s top-down facets, turning on their hinges on
  `--tp-ease-unfurl`. It only adds exports, so `mark-consistency.test.ts` holds.
  - The mark therefore changes pose as it opens: from the three-quarter still to the top-down
    facets. The brand bundle has no "opened into four" state (`docs/brand/USAGE.md`: "Nothing in
    the app requests a mark or motion state that isn't covered"), so code draws it unless the brand designer does (§9).

**Access.**
- Under reduced motion there are stills, no float, no zoom and an instant open. That needs an
  explicit rule for `::view-transition-*`, which the global switch does not reach.
- A visible pause control for the float (WCAG 2.2.2).
- Targets are at least 44 px, and every string is in all twelve catalogues.
- Opening moves focus to the first part, Escape returns to the room, and a polite live region
  announces both.
- The four parts and the centre are real DOM links, never revealed by a class that script adds.
- With the placeholders inert, Documents is the only focusable catcher; there are no arrow keys
  until there is a second one.

**Getting around.**
- A small corner menu in the room holds only what belongs to no catcher: sign-out, language and
  theme. Users, Brand and the To send count stay inside Documents, so the room shows no catcher's
  state.
- Every part's screen carries a way back to the room.
- The sidebar stays inside the parts as it is, minus whatever the switch hides.

**Amendments the owner words**, landing with phase 2:
- `DESIGN.md`:
  - the sixth-hue rule ("gold, gold's tiers, and the greys — nothing else") gains the room's
    stronger gold, platinum and bronze, in the room only;
  - "Dark mode is derived, never authored" gains the room's grey;
  - "Don't add gradients as decoration" gains the colour beneath each catcher;
  - "A grid frame: a 15rem rail…" gains "except the room";
  - its description of Loppa follows `VISION.md`.
- `docs/plan/DESIGN-LANGUAGE.md`'s "it never decorates", and `styles.css`'s "Nothing here loops",
  gain the room's float, which can be paused and stays still under reduced motion.
- `docs/brand/USAGE.md` gains the opened state.
- **ADR 0022 — the room** (accepted in phase 0) records all of this.

## 3. The four parts

Measured gaps for a person who collects nothing, and what closes each. Each part reuses what
exists, reshaped where it must be.

### Forms — the Akinator and manual mode, and filling

- **Exists:**
  - the guided builder (3,542 lines of screens on a 6,657-line pure core);
  - the classic editor (3,577);
  - templates, the preview, and drafts that autosave without ever being published.
- **Gaps → fixes:**
  - **No PDF without publishing**, because every PDF route is keyed by a submission → a route
    renders the *draft*, blank or filled by the author, through the existing renderers
    (`documents/finished.ts`, `paper.ts`; Playwright on a server, Electron on the desktop). It
    builds an unsaved submission in memory and writes no row.
  - **Publish is the editor's main button, and the guided flow ends at "Publish it now"** →
    Download, Sign and Send come first, and Publish becomes "Share to collect".
  - **The doors exist only in `/forms`' state, and `openBlank` is private** → export it, and give
    the doors a URL, so the Forms part opens on "Akinator" or "manual".
  - **Nothing fills an existing PDF's own fields** → write them with `pdf-lib`'s form API in the
    Forms server, under the PDF guard, with no import and no submission.
    - `fillPaper` is not that. It draws a Loppa form's answers as an overlay on the paper the form
      was imported from (`documents/paper.ts`), so it needs that import first.
    - A PDF with no fields of its own is filled that way: imported, then the overlay. It gains the
      author as the one filling it, with no submission.

### Scan — bring it in, and the page basics

- **Exists:**
  - the PDF, Word and OCR readers;
  - crop and straighten;
  - `CameraScan`, `PhoneScan` and the desktop's LAN relay;
  - the review screen;
  - `pagesToPdf`, today reachable only inside signing.
- **Gaps → fixes:**
  - **A scan only becomes a form or a signing request** → one Scan screen under `paper/`, so
    `bundle-split.test.ts` and CAVEATS #43 hold. It takes a file, a drop, the camera or the phone,
    and ends in *keep as PDF*, *arrange pages*, *make a form*, *sign* or *send*. `pagesToPdf` moves
    out of `signing/` behind a download route.
  - **The page basics do not exist** (no merge, split, rotate, reorder or delete code anywhere) →
    page work with `pdf-lib` (MIT, already in `api-forms`), in the Forms server, desktop first.
    - Untrusted PDFs are parsed under a guard like `api-sign`'s `pdf-guard.ts` (a worker with a
      time and memory budget).
    - `pdf-lib` in the browser would cost the bundle about a whole budget's headroom, so it stays
      on the server.
    - On the hosted edition this means the server parses a stranger's PDF, which ADR 0018 and
      `extract.ts` avoid for import. That is decided when the hosted edition comes (§9).
  - **The review screen has no camera, phone or drop** although the door promises "a phone scan
    becomes the form" → mount `CameraScan` and `PhoneScan` there, and accept a dropped file.
  - **`phone-scan.ts` imports `QR_DARK` from the admission module** → move the constant (needed
    for the switch too).

### Sign

- **Exists:**
  - Loppa Sign: typed or drawn signatures, PAdES seal, audit page, test mode by default;
  - the Signing screen, which signs any unencrypted PDF up to 10 MB or camera pages, sends links,
    and opens the signing page on this device.
- **Gaps → fixes:**
  - **A PDF made in Forms or Scan must be re-uploaded** → hand it to the `upload` source directly.
  - **Signers never get the sealed copy** → "Send the signed copy" through Send, after a
    confirmation.
  - **A sender cannot cancel**, though the model has `cancelled` → a cancel route: **a
    `docs/CONTRACT.md` §5 change**, versioned, and **`packages/signing` and
    `packages/shared/src/contract` changes**.
  - **The signer page and the audit page are English and Swedish only** → their interface strings
    in all twelve languages. Operative wording is translated by a person (rule 8, ADR 0012).
  - **ADR 0009 requires Sign to run standalone, which is unmet**, and routes Sign's invitations
    through Mailer → by default "finished" does not include it (§9), and ADR 0009 is amended in phase 6.
  - **Remote signers from the desktop and a real eID** are not in the defaults (§9).

### Send

- **Exists:**
  - the mail providers;
  - the desktop's To send, which opens a message as a draft with its attachment in Outlook or
    Apple Mail, or as an addressed `mailto:`;
  - the outbox as the test mode.
- **Gaps → fixes:**
  - **Nothing sends "this document to this person"** → one route and one screen.
    - Any part's PDF, or a PDF or Word file sent as it was brought in, with recipients, a subject
      and a note, goes through a confirmation (rule 7) and into To send.
    - On the desktop the message opens as a draft in the person's own mail program.
    - Nothing leaves without their press.
  - **The hosted edition has no To send.** Hosted Send comes with the hosted edition (§9).

## 4. The centre: summary and translation

Built in the **later session** that can reach the model (see the hand-over at the end); everything
before it is built without the network. Until then the centre says plainly that the summary is not
on this computer yet. On an edition that has no summary, it says that instead.

**Languages.** All twelve that Loppa has: Danish, German, English, Spanish, Finnish, French,
Icelandic, Japanese, Norwegian Bokmål, Russian, Swedish and Chinese (`apps/forms/src/lib/messages/`).
- It summarises a document in its own language or in the person's.
- It translates between any two of the twelve, **if it fits**: the same model, no second one.
- S1 measures each language on its own. Small models are weakest in the smallest languages, and
  Icelandic is the likeliest to fall short (UNVERIFIED). A language that fails S1's bar offers no
  summary or translation in it, and says why, rather than a poor one.

**Model.**
- **Default:** Qwen3-1.7B (Apache-2.0).
- **Alternatives:**
  - Qwen3-0.6B (about 0.4 GB, weaker);
  - Qwen3-4B (about 2.5 GB, slower);
  - DeepSeek-R1-Distill-Qwen-1.5B (MIT; it writes long reasoning before answering).
- **Excluded by licence:** Qwen2.5-3B and 72B, and models under the DeepSeek or Llama licences.
- All sizes and licences come from secondary sources (UNVERIFIED) until the model cards are read.

**Runtime.** Spike S1 decides between two:
- **`node-llama-cpp` (MIT)** in an Electron `utilityProcess`.
  - It would be the app's first native module: `electron-builder.yml`'s "No native modules" note
    and `asarUnpack` change.
  - The shell hands the process to Forms the way it hands over Sign, which **amends ADR 0016** and
    `eslint.config.js`'s desktop entry list.
- **`@wllama/wllama` (MIT, wasm)** in a worker in the window: no native code, single-threaded
  without COOP/COEP headers.
- **Ruled out:**
  - transformers.js, because its LGPL `sharp` chain fails `licence:check`;
  - WebLLM, because its 2 MB of gzipped script is larger than the whole bundle budget.

**What it reads.**
- **Files and scans:** stage 2's `LayoutDocument`, flattened in reading order without page
  furniture or footnotes. The flattener is new, pure and held by fixtures.
- **Blank form:** its labels.
- **Filled form:** `flattenAnswers`.
- **Long documents:** split into chunks that fit the model. S1 reports time and peak RAM per page
  count. A 2-page summary is estimated at 20–45 s on a laptop CPU (UNVERIFIED). A translation is
  as long as its source, so it is slower than a summary and shown page by page as it is written.

**What it may and may not do.**
- It may write a draft summary or translation of the person's own open document, shown beside
  it, labelled as generated (a translation as a machine translation), and not stored.
- It may not:
  - write into, or attach itself to, a document, form, envelope or message;
  - feed any builder or import decision;
  - live in `packages/shared/src/{builder,interpret,import}`;
  - make a network call;
  - write legal, clinical, tax or safety-critical wording (rule 8, ADR 0012).
- **Contracts, consents, declarations and clinical forms are quoted, never reworded or
  translated** (the accepted default). The centre picks their passages and shows them in the
  original language. ADR 0012 counts a machine translation of a declaration as generated legal
  wording, and the plan already promises imported consent text is "never summarised or
  shortened".
  - The import's classify stage finds consent text today. Recognising a contract, a declaration or
    a clinical form needs word lists of its own: rule-based, with fixtures, in
    `packages/shared/src/import`, never the model.
- **CAVEATS #43 is test-first:** `bundle-split.test.ts` forbids `fetch` in anything that holds a
  reading. Sending a reading's text to a loopback route changes that row and its test first, and
  the hosted edition never registers the route.

**Delivery.**
- A JSON weights manifest (licence, URL, retrieval date, SHA-256; Zod, ADR 0021) is held by a
  test, because `licence:check` sees npm packages only.
- The model file is checked against the manifest before it is used.
- The setting lives in Forms' settings, in twelve catalogues, not in the desktop panel, which is in
  English and Swedish only.

**Decisions.**
- **ADR 0023 — a local summary and translation model** supersedes ADR 0013 (proposed).
- It amends ADR 0016 (an "On this computer" AI mode, the native module, the model file), ADR 0015
  (licences for model weights) and ADR 0012.
- `CLAUDE.md`'s non-negotiable (1), `docs/plan/BRIEF.md` and `PREDICTIVE-BUILDER.md` ("No AI is
  involved anywhere") gain their scope: the builder and the import.

## 5. What Documents does not need

Measured, non-test lines:

| Feature | Lines |
| --- | --- |
| Events | 765 |
| Check-in | 1,186 |
| Attendance | 204 |
| Admission cards | 818 |
| Inbox | 247 |
| Invoices | 2,050 |
| Ledger | 907 |
| Mailer | 169 |
| Old wizard (unreachable) | 605 |
| Marketing site | 2,879 |

Eleven of the 28 tables serve only events, check-in, invoices or the ledger.

**Public fill and submissions cannot be separated** (4,100 lines with the submissions grid). The
finished PDF, the filled paper, signing from paper and the desktop's "Email document" all need a
submission row today. Phase 3 removes that dependency for the person's own documents.

The options:
- **A.** Leave everything in the rail.
- **B.** One switch, off by default (the default here). It costs:
  - one shared nav list for the sidebar and the command palette;
  - the route table and the server's route registrations;
  - moving `QR_DARK` and `attendeeName` out of `admission.ts`;
  - `Login.tsx`, and a seed that opens on the room.
  - Code, tables and e2e stay, and e2e runs with the switch on.
  - It hides; it does not shrink the bundle, whose total counts every chunk.
- **C.** Each becomes its own product.
- **D.** Delete. Irreversible.

## 6. Phases

Each phase is one branch and one PR. Every gate runs on its own: format, typecheck, lint, the unit
tests, build, `bundle:budget`, `builder:validate`, `contract:check` and `licence:check`. Then the
phase's e2e, and the whole suite once, in the foreground, read from its log. **`CLAUDE.md`'s
package descriptions, `MODULE-STATUS.md` and any document a phase contradicts change in that
phase's own PR**, not in a sweep at the end. Every phase reports its bundle and source-line delta,
and pays for what it adds.

| Phase | What | Exit |
| --- | --- | --- |
| **0 — Decisions** | The owner answers §9 and accepts this plan and `VISION.md` (done: "Let's go!"), and ADR 0022 is accepted. | This PR merged. No code. |
| **1 — Spikes** (throwaway, nothing merged) | **S2 motion:** three floating catchers, the zoom and the open, traced on a 4× CPU-throttled run. **S3 the part gaps:** a draft PDF with no submission; page work under the PDF guard, including encrypted and already-signed PDFs; one document queued in To send and opened as a draft. | S2: no frame gap over 25 ms (headless Chromium's clock jitters past 16.7 ms on an idle page), reduced motion and the pause proven, and the room's CSS within 4 KB. S3: each proven, or turned into an owner question. |
| **2 — The room** | `/room`, the grey and the three stronger colours as tokens, the placeholders, the corner menu, the `DESIGN.md` amendments. The four parts link to today's screens, and the centre says the summary is not on this computer yet. | `room.spec`: keyboard, reduced motion, 360 × 640, German length, mirrored. The placeholder guard test (no href, handler, import or focus). The contrast test (each colour at 3:1 or more on the grey). `bundle:budget` green. Sign-in lands on the room. |
| **3 — Forms** | The draft PDF, filling a PDF's own fields and a Loppa form and keeping each as a PDF, Download, Sign and Send before "Share to collect", the doors by URL. | An e2e builds a form Akinator-style and one in manual mode, fills each and downloads it as a PDF, and fills an existing PDF's own fields and keeps it, all with no submission and no published version. |
| **4 — Scan** | The Scan screen, the page basics, keep as PDF, camera, phone and drop on the review screen. | e2e for phone scan → PDF; PDFs put together, pages taken out, split, turned, reordered and deleted → PDF; and drop → form. CAVEATS #43 holds. |
| **5 — Send** | "Send this document" with a confirmation and the outbox test mode. | An e2e: any part's PDF, and a Word file as it was brought in, reaches To send with its attachment, and nothing leaves without the press. |
| **6 — Sign** | Hand-off from the other parts, cancel (CONTRACT §5, `packages/`), the signed copy through Send, and the signer and audit pages in twelve languages. | e2e: form → PDF → signed → sealed copy queued to the signers, plus a cancel. `contract:check` green. |
| **7 — The earlier features** | The switch (§5 B), if the owner approves it. | The old e2e suite passes with the switch on, and the room shows none of it with the switch off. |
| **8 — Summary and translation** (later session) | S1: models × runtimes on an 8 GB Windows laptop and a Mac, over corpus and prose documents in each of the twelve languages, summarising and translating. Then ADR 0023, the manifest, the setting, the word lists for operative text, and the pane. | Each language passes S1's bar or says it has no summary. The owner's time limit is met. CI runs a fake summariser. The weights test is green. The packaged app passes a smoke test on both platforms. |
| **9 — The Documents demo** | A seed and desktop demo built around Documents: an imported PDF form, a Word form, a filled PDF, an arranged PDF, a message in To send. | A person who collects nothing can scan → arrange → fill → sign → send → summarise by clicking alone on the desktop. |

**What the demo seed cannot hold:** a signing request. `signing_requests.envelope_id` is NOT NULL,
and the seed writes only Forms' database; rule 1 keeps it out of Sign's. That item comes from a
running Sign, or is left out.

**Part B** (real documents for the import corpus) is blocked on the network. It lands in the later
session, best after phase 4 as Scan's out-of-sample test, and its prose documents feed S1.

**The placeholders** get phase 2's slice and nothing more.

## 7. What changes in the documents

- **New:**
  - this plan;
  - ADR 0022, the room (accepted in phase 0);
  - ADR 0023, the summary (phase 8).
- **Amended:**
  - ADR 0016 (phases 2 and 8);
  - ADRs 0015 and 0012 (phase 8);
  - ADR 0009 (phase 6: Sign inside Documents, without its standalone mode, by default);
  - ADR 0011 (phase 7, invoices).
- **Rewritten, each in the phase that contradicts it:**
  - `CLAUDE.md`'s framing and package descriptions;
  - `README.md`;
  - `DESIGN.md` and `DESIGN-LANGUAGE.md`;
  - `docs/ROADMAP.md`;
  - `docs/SPEC-forms.md` §1;
  - `docs/START-HERE.md`, retired;
  - `docs/MODULE-STATUS.md`, re-measured: it was measured many commits ago, and Forms has grown
    well past what it records;
  - `docs/CONTRACT.md` §5 (cancel, and its stale note on desktop invitations);
  - `LAUNCH-CHECKLIST.md` and `PRE-LAUNCH-AUDIT.md` (the AI lines, for counsel);
  - the marketing site's copy, in the owner's words (§9).

## 8. The cost, measured

At `eea1774`, gzipped:

| | Now | Budget | Headroom |
| --- | --- | --- | --- |
| Entry | 6.7 KB | 12 KB | 5.3 KB |
| Stylesheet | 16.0 KB | 20 KB | 4.0 KB |
| Total | 986.4 KB | 1 000 KB | 13.6 KB |

- **The rest of the build:**
  - the full e2e suite: 92 tests in 8.7 minutes;
  - the Windows desktop zip: 211.5 MB (Electron about 370 MB of the 494 MB unpacked);
  - the macOS zip: 440.5 MB.
- **Where the headroom goes:** the room, the Scan and Send screens, the centre's pane and their
  words in twelve catalogues must fit in 13.6 KB. A word costs about 20 bytes in each catalogue.
  - Spike S2 measures the room.
  - Each phase reports its delta.
  - If a phase does not fit, a cut pass comes first: dead CSS, unread catalogue keys, duplicate
    helpers.
- **Outside every budget:** the mark's chomp loop is 1,094 KB of the 1,319 KB a cold signed-in
  load downloads. A smaller loop from the brand bundle would save more than any code cut.

## 9. The owner's answers, and what stands as a default

**Answered on 2026-10-07:**
- **The room's colours:** Loppa's own, made stronger so they stand out against the grey, in place
  of red, green and yellow.
- **The centre's languages:** all twelve that Loppa has, and translation too if it fits: "a
  summary/translation tool".

**Accepted with their defaults** ("Let's go!"). Each is in §1 or §4, and the owner may change any
of them at any time:
1. **The room:** the exact grey; which colour sits beneath which catcher; whether the colours carry
   into a tool once it opens; what a white-labelled customer sees.
2. **The placeholders:** inert, saying "Not built yet".
3. **Where editing lives:** page work in Scan, filling in Forms. Editing a document's text is not
   a basic.
4. **Word:** input only for now. A faithful Word → PDF conversion needs a Word layout engine; a
   rough one does not.
5. **Scan's output:** a PDF to keep or a form, chosen after reading.
6. **Sign:** the person signs on the desktop; others sign by a link where Sign is online.
   Standalone Sign (ADR 0009), remote signers from the desktop and a real eID are not part of
   "finished".
7. **Collecting answers:** "Share to collect", a secondary choice in Forms.
8. **The edition:** desktop first, then hosted with no summary. Whether the hosted server may do
   the page work on a person's PDF is decided when the hosted edition comes.
9. **The earlier features:** behind one switch (§5 B), with invoices among them; Mailer parked.
10. **The centre:**
    - Qwen3-1.7B, as a separate model file;
    - a form's labels and its answers both;
    - contracts, consents, declarations and clinical forms quoted, never reworded or translated;
    - shown beside the document, labelled, never stored.
    - The time a 2-page and a 20-page summary may take on an 8 GB laptop is the owner's, measured
      in S1.
11. **The opening animation:** drawn by code from the existing geometry, unless the brand designer
    makes the "opened into four" state.
12. **Arrival:** whether the once-only intro becomes the spawn into the room is decided in phase 2,
    with the room in front of the owner.
13. **The guided builder's opening question** ("What is this form for?", and its 25 collection
    recipes): kept for now.
14. **The marketing site at `/`:** still sells events, the door and the ledger. It is reworded only
    in the owner's words.

## Hand-over: the later session with network access

- **Allow:**
  - `huggingface.co` (the model);
  - `eur-lex.europa.eu`, `e-justice.europa.eu`, `online-forms.e-justice.europa.eu`,
    `commission.europa.eu` and `ec.europa.eu` (or `*.europa.eu`);
  - `www.gov.uk`, `assets.publishing.service.gov.uk` and `www.nationalarchives.gov.uk`;
  - `www.gsa.gov`;
  - `commons.wikimedia.org` and `upload.wikimedia.org`;
  - `creativecommons.org`.
- **Or upload the files instead.**
  - The model goes to a pre-release on this repository's GitHub releases, tagged
    `model-qwen3-1.7b-q4km`, with its SHA-256 from the Hugging Face page in the description.
    GitHub release files may be up to 2 GiB each.
  - Real documents go through `fixtures/documents/SOURCES.json`'s harness (#154), each under its
    own verified licence.

# Loppa — the vision

**The owner's, 2026-10-07.** Written down from the owner's own words in the session that re-planned
Loppa ("I think we need to start over planning wise"); they are quoted verbatim at the end, with the
session's words they answered. Where any other document disagrees — the
README, `START-HERE.md`, the specs, `DESIGN.md`, older plans — this one wins until that document is
brought in line (the second-last section lists them). This file says what Loppa is. The plan for
building it is `docs/plan/DOCUMENTS.md`, which the owner accepted ("Let's go!"); the room's
decisions are ADR 0022.

Sections 1–8 are the owner's. Section 9 is the repository's rules that still apply, so they are
marked as the repository's, not the owner's.

## 1. In one paragraph

Loppa is a **lightweight helper in the office**. For documents it is **not Acrobat**: the
functionality is boiled down to the basic, most-used features. Its other two tools help with an
office program — Excel, and presentations — rather than replace it. Loppa does not necessarily
collect forms or data in the first place.

## 2. The room

You arrive in an **empty dark grey room**. Three cootie catchers — paper fortune tellers, Loppa's
mark — float in it, each with its own hue beneath it. The hues are **Loppa's own colours, made a
little stronger** so they stand out against the dark grey (the owner first named red, green and
yellow, then replaced them with Loppa's colours):

| Catcher | Now |
| --- | --- |
| **Documents** — PDF, Word and forms | built first, and finished before anything else |
| **Spreadsheets** | a floating, animated placeholder |
| **Presentation & planning** | a floating, animated placeholder |

Pressing a catcher **zooms in on it and opens it**, revealing **four parts** around **a centre**.
The two placeholders will have the same kind of opening later; they are not built now.

## 3. Three independent tools

The three catchers act independently of each other. They do not affect each other and do not link
to each other in any way. This is stricter than `CLAUDE.md` rule 1, which lets products talk over
`docs/CONTRACT.md`: the catchers share no contract at all. Inside the Documents catcher, today's
Forms and Sign products still talk to each other only over `docs/CONTRACT.md`.

## 4. Documents — the first catcher

PDF, Word and forms: scanning them, editing them and sending them. Its four parts:

| Part | What it is |
| --- | --- |
| **Forms** | Build a form, either **Akinator style** — the guided builder, one question at a time, by clicking — or in **manual mode**, the classic editor. |
| **Scan** | Bring paper and files in: a PDF, a Word file, a photo, a phone scan. |
| **Sign** | Sign a document. |
| **Send** | Send the document to someone by mail. |

Its centre:

- **Summary and translation** — an open-source AI model, such as one from the Qwen or DeepSeek
  families, run **locally and offline**, **only large enough to properly summarise documents, PDFs
  and forms**, in **all the languages Loppa has so far** (twelve), and, if it fits, translating
  them too: "a summary/translation tool".

**Editing is the basics, not Acrobat.** Everything is boiled down to the most-used features. The
basics the session proposed and the owner confirmed ("Now you get it!") are: putting files
together; taking pages out or splitting them; turning, reordering or deleting pages; filling in a
PDF's own fields or a Loppa form and keeping it as a PDF, without publishing anything; turning
photos and scans into one PDF; signing it; and sending it. A full Acrobat-style editor is not
Loppa.

**Collecting answers is optional** ("we do not collect the forms or data necessarily in the first
place"). A person can build, scan, fill, sign and send their own documents and never publish a form.

## 5. Spreadsheets — placeholder

Where **data and reports** belong. Later: mainly a tool that helps with Excel — a "cheat code"
library full of scripts and macros for the things Excel does not have. Not built now.

## 6. Presentation & planning — placeholder

What the earlier **events and planning** becomes. Later: a tool that helps with presentations
(PPTX and the like), group planning, and slide-based offline editing and work. Not built now.

## 7. The order of work

Start over planning-wise. Then focus on what is built and being built until the Documents catcher
is **completely finished**. The placeholders float and are clearly not built yet; nothing more is
made for them until Documents is done.

## 8. What carries over

There are a lot of resources to move around, and in general they are still usable. They move into
the Documents catcher's parts, reshaped where they need it:

- the **guided builder** (the "Akinator form creator") and the **classic editor** → Forms;
- the **scanner for PDFs and documents** — the document import (PDF, Word, paste, photographs and
  scans read by OCR on the device, the phone relay) and the camera scan → Scan;
- the **signing feature** — Loppa Sign: typed or drawn signatures, the sealed PDF and its audit
  page → Sign;
- the **function to mail it out** — Forms' own mail paths: drafts in the person's own mail program
  on the desktop ("To send") and the mail providers → Send.

## 9. Repository rules that still apply

Not the owner's words in this session; the repository's own rules, which the vision does not
change:

- **Nothing sends or deletes without a confirmation**, and everything outbound has a test mode
  (`CLAUDE.md` rule 7).
- **No generated legal, clinical, tax or safety-critical wording** (rule 8, extended to AI by ADR
  0012, proposed). It applies to the summary and the translation: ADR 0012 counts a machine
  translation of a declaration as generated legal wording. How it applies is open below.
- **The guided builder and the import stay rule-based and deterministic** (`CLAUDE.md`, ADRs
  0017–0021). The model lives in the centre, where the owner put it; it never decides anything in
  the builder or the import, and never runs inside `packages/shared/src/{builder,interpret,import}`.
- **Only permissive licences come in** (ADR 0015: MIT, BSD, Apache-2.0, ISC). `pnpm licence:check`
  sees npm packages only, so a model's weights need a check of their own.
- **Offline first** on the desktop (ADR 0016). The owner asked for the summary model to run
  locally and offline.
- **The bundle budget** (`pnpm bundle:budget`) still holds for Forms' web build. It does not measure
  the desktop download (about 206 MB zipped today, ADR 0016) or a summary model.

## 10. Open, and the owner's to decide

Not assumed here. `docs/plan/DOCUMENTS.md` §1 takes a default for each, and the owner accepted the
plan with those defaults ("Let's go!"). Each stands until the owner says otherwise; §9 there lists
them:

- **The room's look:** the exact grey, and which of Loppa's colours sits beneath which catcher.
- **The placeholders:** what pressing one does.
- **Editing:** which of the four parts holds the page and file basics (none of Forms, Scan, Sign or
  Send is an editor today); whether basic editing includes changing a document's text, especially a
  Word file's; whether a Word file can become a PDF (a faithful conversion needs a Word layout
  engine; a rough one does not).
- **Scan:** whether what it reads becomes a PDF to keep (the camera scan Sign seals), a form's
  questions (the document import), or either.
- **Sign:** the person signing their own document, asking others to sign by a link, or both.
  Today the Signing screen sends a PDF for signing by link and opens the signing page on this
  device; the signer's page has no sender screens of its own.
- **Collecting answers:** how prominent sharing a form for others to fill in stays inside Forms,
  given that it is optional.
- **The summary and translation:** which model (Qwen and DeepSeek were examples) and whether its
  weights' licence passes ADR 0015; its size and how it reaches a machine (in the installer, or
  downloaded once); whether "forms" means the form or the answers given to it; whether it may
  summarise or translate a contract, a consent, a declaration or a clinical form at all (rule 8, ADR
  0012, and the plan's "consent text is never summarised"); and how it is shown (labelled as
  generated and never written into the document, as ADR 0013 proposes).
- **Where:** the desktop app, the hosted web edition, or both — and, if the web edition stays,
  whether it has a summary at all, since a model on Loppa's server would not be the person's own
  machine.
- **What was built for the earlier idea:** whether the code for events, registrations, the check-in
  door and attendance (the earlier "events and planning", now Presentation & planning) and the
  ledger (data, now Spreadsheets) is kept, hidden, moved into those catchers when they are built,
  or retired — nothing is deleted without the owner's word; whether invoices (PDFs rendered from
  data and mailed, ADR 0011) belong to Documents' Send or to Spreadsheets; and whether **Mailer**
  (the email-campaign product of `SPEC-mailer.md`, of which only a stub is built) lives on beside
  Send or is dropped.

## 11. Older documents that still say otherwise

Brought in line as the work touches them; until then, this file wins:

- `CLAUDE.md` — "three independent products" are Forms, Mailer and Sign; `apps/forms` is "forms,
  inspections, measurements, reports".
- `README.md` — "Forms, registrations and email".
- `DESIGN.md` — dark mode is derived and never authored; no decorative gradients; and it describes
  Loppa as a form builder with events, a door and a ledger, plus Mailer. The room's dark grey and
  the hue beneath each catcher need the owner's amendment there. (Its palette, gold and greys only,
  no longer conflicts: the hues are Loppa's own colours.)
- `docs/plan/DESIGN-LANGUAGE.md` — "Motion explains where something went; it never decorates." The
  room's floating catchers need the owner's amendment there too.
- `docs/START-HERE.md` — says it wins over every other plan; it describes the earlier v0.1.
- `docs/SPEC-forms.md`, `docs/SPEC-mailer.md`, `docs/ROADMAP.md`, `docs/MODULE-STATUS.md` — the
  earlier products and their order.
- `CLAUDE.md`'s guided-builder non-negotiable "No AI, no LLM", and "No AI is involved anywhere" in
  `docs/plan/BRIEF.md` and `docs/plan/PREDICTIVE-BUILDER.md` — still true of the builder and the
  import, and only there.
- `docs/adr/0013-ai-data-processing.md` (proposed), with ADR 0016's "connect online" and "work in
  cloud" AI settings — AI as a server-side provider in a hosted region, opt-in, summarising
  responses; the owner's summary is a model run locally and offline that summarises documents, PDFs
  and forms. ADR 0012 still bounds what any AI may write.

## The owner's words, verbatim

> you got it totally wrong. Documents and forms is pdf/word and forms, scanning and editing and
> sending them.
>
> we do not collect the forms or data necessarily in the first place, data and reports is supposed
> to be the excel/sheets where i will focus on implementing it as a cheat code library full of
> scripts macro for excel that excel doesnt have, mainly it will be a tool helping with excel.
>
> Events and planning will therefore be a tool to help with presentation, pptx and so on. group
> planning and slide-based offline editing and work.
>
> It is not one complete project they all act independently of each other and do not interfere
> with each other. furthermore we put placeholders on sheets/excel and presentation and planning
> since we havent yet finished the docs/pdf/scanning/forms part
>
> I think we need to start over planning wise, we have a lot to resources to move around and in
> general they are still usable like the akinator form creator, scanner for pdfs/docs, signing
> feature as well as the function to mail it out.

> yes and its like you spawn into a room with three floating cootie catchers doc floating there
> with a red hue under it, then spreadsheet with green hue under it and then the presentation and
> planning with yellow hue under it. the spreadsheets and plan & present will only be two floating
> animated cootie catcher placeholders. they all float in an empty dark grey room. pressing one
> zooms in on (in our case we will demonstrate with the pdf/docx/form) then opens the cootie
> catcher up revealing 4 parts Forms/Scan/Sign/Send, then a "summary" in the middle where we will
> import a AI open source locally offline run ai model such as qwen or deepseek. it should only be
> large enough to properly summarize documents, pdfs and forms. so that is the center of the cootie
> catcher.
>
> The other cootie catchers will have this ui too but we dont build them now and we leave them as
> placeholders, the cootie catchers do not affect each other or link in any way. so lets focus on
> what we have built and building right now until we completely finish the first one.

> Not acrobat is correct all the functionality should be boiled down to basics, mostly used
> features so loppa is a light weight helper in office.

The session's proposal, which the owner's next message answered (excerpt; "[…]" marks what is
left out):

> Agreed. ADR 0004's "not Acrobat" stays, and "edit" in the Documents catcher means the few things
> office people do most with a PDF or Word file, not a full editor. I'll write that in as a
> decision rather than a question. Concretely:
>
> - **Pages:** merge files, pull out or split pages, turn, reorder or delete them.
> - **Filling:** fill in a PDF's own fields, or a Loppa form, and save it as a PDF without
>   publishing anything.
> - **Scanning:** photos or scans become one PDF.
> - **Signing and sending:** sign it, then send it.
>
> […] Whether a Word file should also become a PDF is the one item I'll still ask you about. A
> rough conversion is possible; a faithful one would need a Word layout engine, which is heavier
> than "lightweight helper".

> Now you get it! And the form builder is there too with Akinator style and manual mode.
>
> Then ai model summary in middle as before.
>
> I think our vision starts to align, so make sure to write it down.

The session's questions on the plan, two of which the owner's next message answered (excerpt):

> 1. **Room colours:** the dark grey […]; the exact red, green and yellow (may the yellow be Loppa's
>    gold?); what a white-labelled customer sees. […]
> 7. **Summary:** it quotes contracts and consents rather than rewording them; Qwen3-1.7B as a
>    separate model file; tell me the languages it must handle and how long it may take.

> Red green yellow can be removed and replaced with loppas colors but maybe exaggerated to make
> sure it's a little bit contrast?
>
> Summary, all languages we have so far really. With some potential for translation as well if
> possible to fit in. So it's a summary/translation tool.
>
> We are getting more aligned as we go on. Let's go!

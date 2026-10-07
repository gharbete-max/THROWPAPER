# Loppa — the vision

**The owner's, 2026-10-07.** Written down from the owner's own words in the session that
re-planned Loppa; they are quoted verbatim at the end. Where any other document disagrees — the
README, `START-HERE.md`, the specs, `DESIGN.md`, older plans — this one wins until that document is
brought in line (the last section lists them). The plan for building it is separate; this file
says what Loppa is.

## In one paragraph

Loppa is a **lightweight helper for office work**. It is not Acrobat, not Excel and not
PowerPoint: it does the few things people do most with documents, spreadsheets and
presentations, simply and offline first. It does not have to collect forms or data in the first
place.

## The room

You arrive in an **empty dark grey room**. Three cootie catchers — paper fortune tellers, Loppa's
mark — float in it, each with its own hue beneath it:

| Catcher | Hue beneath it | Now |
| --- | --- | --- |
| **Documents** — PDF, Word and forms | red | built first, and finished before anything else |
| **Spreadsheets** | green | a floating, animated placeholder |
| **Presentation & planning** | yellow | a floating, animated placeholder |

Pressing a catcher **zooms in on it and opens it**, revealing **four parts** around **a centre**.
The two placeholders will have the same kind of opening later; they are not built now.

## Three independent tools

The three catchers act independently of each other. They do not affect each other and do not link
to each other in any way. Each is its own tool: one can be used, changed or broken without the
other two noticing. (This is `CLAUDE.md` rule 1, one level up: today's Forms and Sign products both
live inside the Documents catcher, and still talk only over `docs/CONTRACT.md`.)

## Documents — the first catcher

Its four parts:

| Part | What it is |
| --- | --- |
| **Forms** | Build a form, either **Akinator style** — the guided builder, one question at a time, by clicking — or in **manual mode**, the classic editor. |
| **Scan** | Bring paper and files in: a PDF, a Word file, a photo, a phone scan. |
| **Sign** | Sign a document, typed or drawn, and seal it. |
| **Send** | Send the document to someone by mail. |

Its centre:

- **Summary** — a small open-source AI model (the Qwen or DeepSeek families), run **locally and
  offline** on the person's own machine, **only large enough to properly summarise documents,
  PDFs and forms**.

**Editing means the basics, not Acrobat.** Everything is boiled down to the most-used features, so
Loppa stays a lightweight helper: the everyday page and file work people do with a PDF (putting
files together, taking pages out, turning, ordering and removing pages), filling in a document and
keeping it as a PDF, turning photos and scans into a PDF, signing it and sending it. A general
editor that changes a document's printed text is not Loppa (ADR 0004 already says so).

**Collecting answers is optional.** A form can still be shared for other people to fill in, but
Loppa does not have to collect anything: a person can build, scan, fill, sign and send their own
documents and never publish a form.

## Spreadsheets — placeholder

Later: a tool that helps with Excel — a "cheat code" library full of scripts and macros for the
things Excel does not have. Not built now.

## Presentation & planning — placeholder

Later: a tool that helps with presentations (PPTX and the like), group planning, and slide-based
offline editing and work. Not built now.

## The order of work

Focus on what is built and being built until the Documents catcher is **completely finished**. The
placeholders float and are clearly not built yet; nothing more is made for them until Documents is
done.

## What carries over

Much of what is built is reused as it is:

- the **guided builder** (the "Akinator form creator") and the **classic editor** → Forms;
- the **document import** — PDF, Word, paste, photographs and scans read by OCR on the device, the
  phone relay → Scan;
- **Loppa Sign** — typed or drawn signatures, the sealed PDF and its audit page → Sign;
- **the mail paths** — drafts in the person's own mail program on the desktop ("To send"), and the
  mail providers → Send.

Events, registrations, the check-in door, invoices and the ledger were built for the earlier idea
of Loppa and are not part of the Documents catcher. Nothing of them is deleted without the owner's
word.

## What stays true

- **Offline first**, and the person's documents stay theirs.
- **Nothing sends or deletes without a confirmation**, and everything outbound has a test mode
  (`CLAUDE.md` rule 7).
- **No generated legal, clinical, tax or safety wording** (rule 8). The summary is a draft summary
  of the person's own document, labelled as one, and never written into the document.
- **The guided builder and the import stay rule-based and deterministic.** The model lives only in
  the centre; it never decides anything in the builder or the import, and never runs inside
  `packages/shared/src/{builder,interpret,import}`.
- **Lightweight.** A small download and a fast start: the bundle budget stands.

## Open, and the owner's to decide

These are asked in the plan, not assumed here:

- the exact shade of the room's grey, and the exact red, green and yellow;
- what pressing a placeholder does;
- whether a Word file can also become a PDF (a faithful conversion needs a Word layout engine;
  a rough one does not);
- the summary model's size, and how it reaches a machine (in the installer, or downloaded once);
- whether sharing a form for others to fill in stays in Forms;
- what happens to events, registrations, check-in, invoices and the ledger;
- the desktop app, the hosted web edition, or both.

## Older documents that still say otherwise

Brought in line as the work touches them; until then, this file wins:

- `CLAUDE.md` — "three independent products" are Forms, Mailer and Sign; `apps/forms` is "forms,
  inspections, measurements, reports".
- `README.md` — "Forms, registrations and email".
- `DESIGN.md` — the palette allows gold and greys only ("the sixth-hue rule"), the product is light
  by default, no decorative gradients or looping motion; the room's red, green and yellow hues, its
  dark grey and its floating catchers need the owner's amendment there.
- `docs/START-HERE.md` — says it wins over every other plan; it describes the earlier v0.1.
- `docs/SPEC-forms.md`, `docs/SPEC-mailer.md`, `docs/ROADMAP.md`, `docs/MODULE-STATUS.md` — the
  earlier products and their order.
- `CLAUDE.md`'s guided-builder non-negotiable "No AI, no LLM" — still true of the builder and the
  import, and only there.

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

> Now you get it! And the form builder is there too with Akinator style and manual mode.
>
> Then ai model summary in middle as before.
>
> I think our vision starts to align, so make sure to write it down.

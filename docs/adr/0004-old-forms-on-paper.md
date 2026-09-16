# ADR 0004 — People have old forms, and most of them are PDFs

**Status:** accepted 2026-09-16 — see "Decided" at the end
**Date:** 2026-09-15

> **Since written:** the **mapping** half of step one is built —
> `packages/shared/src/forms/import-acroform.ts` turns a list of AcroForm field descriptors into a
> `FormDefinition`, mirroring `importSurveyJson`. That needs none of the decisions below, because
> it takes descriptors rather than bytes and therefore stores nothing.
>
> The **extraction** half — `pdfjs` reading a real file — is deliberately not built, because it is
> the half that needs an uploaded PDF, and every open question in "What would need deciding" is
> about that file: where it lives, whether it is kept, and what caps a parser runs under. Those are
> still yours. This ADR stays *proposed* until they are answered.

## Context

The request was "a PDF editor embedded would be great". The reason given is the one that matters:
**people have old forms.** An association has a membership application that has looked the same
since 2011; a trade has an inspection sheet somebody made in Word. Retyping it into a builder is
the work that stops them adopting anything.

So the goal is not an editor. The goal is **the shortest path from the PDF they have to a form
this product can run**, and "editor" is one answer to that, not the only one and probably not the
first.

## Three different things wear that name

**1. Extract the questions.** Read the PDF, produce a `FormDefinition`, open it in the builder.
The output is a Loppa form: it renders on a phone, validates, exports to CSV, sends a confirmation,
scans at a door. The PDF is a source, then it is gone.

**2. Overlay.** Keep their PDF as the visual, place input boxes on top at coordinates, and fill it
in. The output is their PDF with values written into it. This is what "PDF form filler" usually
means.

**3. A general editor.** Move text, redraw, re-layout. This is a different product.

(3) is out. It is Acrobat, and nothing about this codebase suggests building Acrobat.

Between (1) and (2) the honest answer is that **(1) is worth far more here and (2) is worth
something only in a case worth naming.**

Everything this product does well happens after a form is a `FormDefinition`: twelve languages, a
brand kit, conditional visibility, a CSV that opens in Excel, an admission card, a door screen.
An overlaid PDF has none of that. It is a nicer way to type into a fax. The exception is a form
that must be *submitted as that document* — a signed authority, a regulator's sheet with a form
number on it. That exception is real, and it is narrow, and it is not the "old forms" problem.

## What extraction actually costs, which depends entirely on the PDF

A PDF is one of two very different things, and the difference decides the whole feature:

**An AcroForm** already contains its fields as structured objects: name, type, options for a
choice, required flag, coordinates. Anything produced by a form designer, or exported from Word
with form controls, is one. Extracting these is a *mapping problem*, and it is the same shape as
the SurveyJS importer added in the previous phase: read a foreign document, map what maps, report
what does not, hand back a `FormDefinition`. That importer is the precedent and it took one phase.

**A flat PDF** — scanned, or printed-to-PDF — has no fields. It has glyphs at coordinates and
possibly a picture of a table. Getting questions out means OCR plus layout inference plus guessing
which line is a label and which is a blank to write on. That is a research problem with a quality
floor nobody can promise, and the failure mode is a form that looks plausible and asks slightly
the wrong questions.

**The tooling is already here for the first one.** `pdfjs-dist` is a dependency, and Playwright
Chromium already renders PDFs for admission cards and invoices. Nothing new is needed to read an
AcroForm's field dictionary.

## What I would do, in order

**First: an AcroForm importer.** `importAcroForm(bytes) -> { definition, skipped }`, mirroring
`importSurveyJson` exactly — same shape, same honesty about what did not survive, same refusal to
guess. Text fields, checkboxes, radio groups, choice lists and signature fields all have real
equivalents here. It is bounded, testable against real files, and it turns "I have a PDF" into "I
have a form" for every PDF that was ever made by a form tool.

**Second: measure the miss rate before building anything else.** Take the PDFs people actually
send and count how many are AcroForms. If it is most of them, the problem is solved and the rest
is a support question. If it is a small minority, that is the number that justifies — or refuses —
the much larger second step. Guessing this number is how the expensive version gets built for a
case that did not need it.

**Third, only if that number says so: assisted placement for flat PDFs.** Render the page, let a
person drag boxes onto it, and name each one. Not OCR, not inference — a human doing the one thing
a human is reliably better at, over a background they recognise. That is a day's work for somebody
converting a form they know, and it produces a real `FormDefinition` rather than an overlay.

**Overlay output stays out** until somebody names the document that must be submitted as itself.
Then it is a rendering target — "print these answers back onto that PDF" — which is much closer to
the existing invoice and admission-card pipeline than to an editor.

## What would need deciding before any of it is built

- Where the uploaded PDF lives. `DOCUMENT_DIR` is local disk and already flagged as a stopgap in
  `LAUNCH-CHECKLIST.md`; an import that keeps the source document makes that decision sooner.
- Whether the source PDF is kept at all after extraction, which is a retention question and
  therefore a privacy-page question.
- A size cap and a page cap, because a PDF is an untrusted file from outside and `pdfjs` parsing it
  is a parser running on a stranger's bytes.
- Rule 8 applies with force here. A membership form carries data-protection wording and a trade
  sheet carries safety wording; **extracting their text is fine, and generating replacement wording
  is not.** An importer copies what the document says. It must never improve it.

## Recommendation

Not an editor. An **importer** first — the AcroForm one, which is a known-shape job with the
tooling already in the repository — then a measurement, then a decision about the hard half.

The request behind "a PDF editor" is "let people keep their old forms". An importer answers that
better, because the output is a form this product can actually run.

## Decided (2026-09-16)

The open questions above were answered, and the file half is built (`PROGRESS.md`, "A form from
paper"):

- **Where the file lives:** the private upload store, alongside respondent attachments, keyed by
  content hash. Read back only through `GET /v1/forms/:id/paper/:key`, which checks the key is
  in the form's current draft. No new table: `definition.paper.sources` is the ownership record.
- **Kept, not discarded.** The anchors are meaningless without the page they point at, and the
  next phase writes answers back onto it. Retention follows respondent attachments exactly —
  nothing purges yet, and that gap is already on the launch checklist.
- **Caps:** 10 MB (the existing attachment cap) and 20 pages. Parsing happens in the author's
  browser, so the server never runs `pdfjs` on a stranger's bytes.
- **Step three was taken now rather than after measuring**, because the product owner asked for
  photographed paper to work on day one. It is manual placement, as this ADR proposed — not OCR,
  not inference. Digital PDFs offer the printed text beside a box as its label, verbatim.
- **Overlay output** is the next phase, not this one.

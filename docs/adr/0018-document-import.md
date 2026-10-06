# ADR 0018 — Document import: rules may propose questions, a person confirms every one

**Status:** accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical", given in the session that built it, after every slice was built and green) — proposed 2026-09-25 from the owner's brief; built in S1b and S7–S14
(PR #147, "As built" below)
**Date:** 2026-09-25
**Supersedes in part:** ADR 0004 — its rule that OCR and layout "never create a field"
**Depends on:** ADR 0019 (deterministic rules), ADR 0021 (JSON data), `docs/plan/LAYOUT-IR.md`

## Context

ADR 0004 (accepted) answered "people have old forms" with an AcroForm importer, then manual box
placement over a PDF or photograph, and **deliberately stopped short of reading questions out of a
flat document**: "OCR plus layout inference plus guessing which line is a label… the failure mode
is a form that looks plausible and asks slightly the wrong questions." OCR was allowed to suggest
a label beside a box a person drew, never to create a field.

The owner's brief asks for the other half: drop a PDF, a Word file or a phone scan — or paste text
— and get a real draft immediately. It also names ADR 0004's fear precisely and answers it: every
decision is scored, unsure ones are flagged, and a review screen that is **never skipped** shows
the document and the draft side by side before anything enters the form.

## Decision

1. **Rules may propose questions** from a document's text layer, its OCR, its Word structure or
   pasted text. This supersedes ADR 0004's "never creates a field" — and only that sentence.
2. **What ADR 0004 protected stays protected:**
   - **A person confirms every question.** Nothing reaches the draft until the review screen's
     "Use these questions", which says how many. Flagged and review-bucket items are shown first,
     each with its alternatives and merge / split / "this is just text".
   - **Wording is copied, never improved.** Labels are verbatim (layout repairs — a line-break
     hyphen, a ligature — are recorded with the original); rule 8 and ADR 0012 apply in full.
   - **The server never parses a stranger's file.** Extraction runs in the author's browser (pdf.js
     and Tesseract, already there and lazy-loaded); the pure stages run in a Web Worker; the desktop
     runs the same bundle.
   - **Storage and caps** are ADR 0004's (private upload store, 10 MB, 20 pages), plus DOCX limits.
3. **Nine stages, each a pure function** (`docs/plan/IMPORT-PIPELINE.md`): extract, reassemble,
   enumerate, segment, classify, map + paper twin, score, review, re-import. Everything after
   extraction reads only the **Layout IR** (`docs/plan/LAYOUT-IR.md`), frozen at `irVersion: 1`,
   integer and page-relative, so the hardest stage can be tested with hand-written documents and no
   PDF at all.
4. **The numbering detector is a written decision procedure** (`docs/plan/NUMBERING-RULES.md`),
   every rule with its fixture, checked against an independent implementation before adoption.
5. **DOCX is read with the platform.** `DecompressionStream('deflate-raw')` and a small
   central-directory reader for the zip; a minimal non-validating tokenizer for the XML that
   refuses any DTD or entity declaration; Word's own `numbering.xml` for list semantics. **No new
   dependency.**
6. **The paper twin is born in the import**: stage 6 fills the existing `PaperAnchor`s and
   `definition.paper`, and `documents/paper.ts` writes answers back as it does today.
7. **Re-import adds, and asks about everything else**: removals, reorders and changed wording each
   need a press; collected answers are never touched.

## Consequences

- ADR 0004 gains a note pointing here. Its AcroForm importer becomes stage 1's first choice
  (confidence 1000), and manual placement stays as the way to fix what the rules got wrong.
- `packages/shared` gains `@tp/shared/import` — with the paste layout (`import/paste.ts`, S6: a
  string is not a file's bytes, and the ladder's T6 reads a pasted list through it); `apps/forms`
  gains `paper/docx.ts`, the clipboard, and a worker. `bundle-split.test.ts` keeps all of it out of the public form's chunk.
- The review screen is a new, substantial screen (S10); without it nothing ships, by design.
- The corpus of real documents must be sourced with redistribution rights recorded
  (`fixtures/documents/SOURCES.json`), because the repository may be public (ADR 0015).
- A document's text leaves nothing behind on the server except, when a paper twin is kept, the
  file itself in the organisation's own store — deletable, and on the purge list that
  `LAUNCH-CHECKLIST.md` already tracks.

## As built (S13, 2026-10-05)

Decisions 1–7 are built, with one part still to come:

- **Stages 2–7 run in the paper door's worker** (S7–S9): reassemble, enumerate, segment, classify,
  map and score, each with its debug artifact. The review is stage 8 (S10), never skipped. The paper
  twin is born in the import (S12b). Re-import is stage 9 (S12c).
- **Stage 1 reads three things today:** a PDF's text layer, and its own form fields over its text
  (#54); a Word file, by the platform alone, with Word's own numbering; and pasted text.
- **Photographs and scans reach the stages since S14** (`SCANS.md`). A photograph, and a PDF page
  with no text layer, are read word by word by Tesseract on the author's device, then by stages 2
  to 7 like any document, and nothing becomes a question until the author has been through the
  review. This is the part of this ADR that most depends on its acceptance: it is where OCR leads
  to fields, the one sentence of ADR 0004 this ADR supersedes. What ADR 0004 protected holds: the
  review is never skipped, a word Tesseract was unsure of caps its question below `auto`, and the
  picture is beside every question read from it. One limit is stated rather than hidden: a word
  Tesseract misreads *and is sure of* ("för" read "for", 96) passes the cap, and only the picture
  beside it shows it (`CAVEATS.md` #136). Placing boxes over a photograph, ADR 0004's own path, is
  unchanged.
- **A form keeps at most twenty documents** (`Paper.sources`, #125). A document read into a form
  with no room adds its questions without their places on the paper, and says so first.
- **There is no grid field type.** An imported grid is one choice per row under a heading, as the
  brief allows until a grid has its own ADR.
- **A consent read from a document** is drawn as a box to tick (S13), its words byte for byte (#28).
- **The corpus holds 60 documents**, the brief's number, each as a PDF and a Word file, with their
  sources recorded, in all twelve languages, and four of them scanned (S15: batch 1 added
  Icelandic, Russian, Japanese and Chinese; batch 2, §8.1's numbering traps on real pages; batch 3,
  §8.2's layout traps, a landscape page among them; batch 4, §8.3's semantic traps in other
  languages; batch 5, twelve clean forms of the product's kinds and two more scans). All are made
  for Loppa; real forms with a licence to record, and scans of real paper, are the owner's to
  supply. Every document found what it was made to find, and the faults it found were fixed with
  fixtures, each written and failing first (`CAVEATS.md` #133–#134, #139–#160).

## Rejected alternatives

- **Use an LLM or a vision model to read the document** (ADR 0013's `form-from-page` and
  `map-scanned-fields`). Rejected: the same bytes would not give the same form twice
  (determinism); the desktop reads documents offline (parity); a 20-page document per import is a
  real per-form cost (cost); the document — often a membership form full of personal data — would
  go to a provider, and the privacy page's "no transfers" would change (privacy); and "why did it
  split this question in two" would have no answer a fixture can pin down (testability).
- **Cloud OCR or document-AI services.** Rejected for the same privacy and parity reasons; the
  browser already runs Tesseract locally.
- **A DOCX library** (mammoth, docx4js, JSZip + an XML parser). Rejected: each is a dependency for
  what the platform already does, and the HTML-oriented ones discard `numbering.xml`'s real list
  definitions — the one thing the importer most needs from Word.
- **Parse on the server.** Rejected by ADR 0004 and again here: the server would run a parser on a
  stranger's bytes for every author who uploads one.
- **Skip the review screen for high-confidence imports.** Rejected: "never a silent guess". A
  confident mistake is exactly the one nobody looks for.

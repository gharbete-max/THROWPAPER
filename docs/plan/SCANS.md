# S14 — Photographs and scans through the stages

**Status:** the plan for slice S14 (`ROADMAP.md`), written before its code (non-negotiable 6),
2026-10-05. It builds what `IMPORT-PIPELINE.md` stage 1 and ADR 0018 already decided, and every
slice since S9 has carried as open: a scanned PDF, or a photograph of a paper form, read into
questions on the review screen like any other document.

## What is there already

- **`paper/ocr.ts`** reads a photographed page with Tesseract, in its own worker, from this origin
  only (`public/ocr/`, ADR 0004). It reads **lines**, to offer a label beside a box the author
  drew in the classic paper import; it never creates a field.
- **`paper/detect.ts` and `paper/warp.ts`** straighten a photograph by its four corners
  (`CropPhoto.tsx`), for that same classic import.
- **Stages 2–7 already read OCR words.** Their source is `ocr` and they carry a confidence: P3
  applies to soft wraps in OCR text, and stage 7's OCR cap (#20, `ocr-noise-budget`) lowers a
  question's confidence to its least sure word.
- **The review screen** reads PDF (text layer and form fields), Word and pasted text. "Not yet
  here: photographed and scanned pages" (`IMPORT-PIPELINE.md` §8).

## What S14 builds

### 1. Words, not lines: `ocrWords`

`ocr.ts` gains a word-level reading, `readWords(image, locale)`, and a pure conversion,
`ocrWords(result, size)`, from Tesseract's words to stage 1's `RawWord`s:

- the box in the IR's units (ten-thousandths of the page);
- the baseline;
- the font size from the line's height;
- `source: 'ocr'`;
- `ocrConfidence` rounded to an integer 0–100;
- the weight left at 400, because Tesseract's bold guess is not reliable enough to decide a
  heading on.

The conversion is where the arithmetic is, and it is tested exactly against a recorded Tesseract
result (`fixtures/ocr/*.json`). Tesseract itself is a measurement, like pdf.js. Its output is
frozen where a test needs it to be the same on every machine.

### 2. A scanned PDF: pages with no text read by OCR

`openPdf(…).raw()` takes an optional `ocr(pageIndex)`. A page with fewer than **3** text runs (the
threshold `IMPORT-PIPELINE.md` stage 1 set) is scanned: its words come from that reader instead.
The review screen's reader renders the page at twice its width and reads it with `readWords`.
Without a reader (Node, the corpus test), a scanned page stays empty, as it is today.

### 3. A photograph: one page, read as it is

The review screen's file input accepts `image/png`, `image/jpeg` and `image/webp`.
- **One page.** A photograph is one page, oriented as its file says (`createImageBitmap`,
  `imageOrientation: 'from-image'`), read by `readWords`.
- **Its size.** Its width and height in points keep its own proportions at A4's width (595).
- **The source pane** draws the image where a PDF's page would be, with the same highlights.
- **Not straightened.** A photograph is read as it is. The classic import's four-corner
  straightening is a step of its own, kept for a later slice. A crooked photo reads worse, its
  words come out less sure, and the review says so through the OCR cap.
- **No paper twin.** As with Word and pasted text, the form keeps no paper: the twin writes onto a
  PDF's pages.

### 4. While it reads

OCR takes seconds, not milliseconds. "Reading…" says so, and the page is never frozen: Tesseract
runs in its own worker, and the stages in theirs. The 30-second hard stop is the stages'; OCR has
its own: 60 seconds a page, then the author is told and nothing is added.

### 5. The corpus gets scans

A scan of one corpus document is kept as its **raw document**, frozen:
`fixtures/documents/scans/<name>.raw.json`. LibreOffice draws the page as an image; Tesseract in
Node reads it, with `scripts/corpus/scan.ts`. Its stages are read against an expectation written by
hand, like every corpus document. Where OCR misreads a word, the expectation says what was read,
and the OCR cap must have lowered that question's confidence.

## Tests

| What | Where |
| --- | --- |
| `ocrWords`: boxes, baselines, confidences, exactly | `apps/forms/src/screens/builder/paper/ocr.test.ts`, with `fixtures/ocr/` |
| A scanned PDF page reads its words from the OCR reader; a page with text never calls it | `extract.test.ts` |
| A scan's stages, against its hand-written expectation | `corpus.test.ts`, `fixtures/documents/scans/` |
| A photograph of a form, read in the browser by the real Tesseract, its questions on the review screen, added | `e2e/scan.spec.ts` |

## Not in S14

- Straightening a crooked photograph on the review screen.
- Handwriting (the brief keeps it out).
- A paper twin of a photograph.
- More than one photograph as one document.

## As built

As planned, with these differences, each found by building it:

- **The reader.** `openPageReader(locale)` keeps one Tesseract worker for a document's pages, reads
  with `{ blocks: true }`, and stops a page at 60 seconds (`ReadingPageTooSlow`, "A page took more
  than a minute to read"). Tesseract's result becomes our own shape in one function,
  `recognisedFrom`, used by the browser and by `scripts/corpus/scan.ts` alike; `ocrWords` turns
  that into stage 1's words. The raw document's `extractor` names the engine Tesseract reports
  ("Tesseract 5.1.0-…"), since `tesseract.js` exports no version of its own.
- **The size a page is read at.** Not "twice its width": a scanned page is drawn with its longer
  side 3 000 pixels (`READ_LONG_SIDE`, A4 at about 250 dots an inch, where Tesseract reads print
  best), and a photograph is read at that size at most, never made larger.
- **B1, a printed box** (`CAVEATS.md` #135), which the plan did not foresee. Tesseract has no box
  among its characters. The corpus's scans came back with "☐ Ja ☐ Nej" read as "[Ja [ Nej", and
  "☐ Jag samtycker" as "0 Jag samtycker", so a yes-or-no question was read as a short text and
  both consents as text to read. The scanned PDF, drawn larger, gave a third reading, "[J": the
  box's two sides read as two characters. Stage 1 now writes a mark back as ☐, recording what was
  read (`repair: { kind: 'box-mark', raw }`, a `packages/shared` change; stage 2 records it as L2),
  when:
  - it was read as a bracket, bar or parenthesis, alone or stuck to the word after it, or as a
    zero or an O standing alone;
  - it is square within a fifth either way;
  - it is at least half its line high.

  Characters read inside its sides are part of it. A first version also took a narrow letter for a
  box. Re-running the scans showed that wrong at once: "lämna" became "☐ ämna", because Tesseract
  had given its "l" a square box that took in the "ä". Letters stay out.
- **The fixtures.** `fixtures/ocr/box-marks.json`, which B1's tests read, is written by `pnpm
  corpus:scan` from the same pictures, the scanned PDF drawn as the review screen draws it. The
  recording can be made again, and a change to it is a diff to review.
- **The scans' expectations** are their documents' own (`expected/<name>.json`), changed only
  where OCR measurably changed what was read:
  - each misread word, and whether stage 7's cap caught it. One of four was caught: "Medlemsansokan"
    at 33. The others Tesseract was sure of ("for" at 96, "gor" and "Darfor" at 91; #136);
  - every blank, `unknown` instead of `blank`, since underscores are no words to Tesseract (#137);
  - nothing else. The stages read the frozen scans to exactly that, the first time they were run.
- **The e2e** reads both, in Swedish, as the author with these papers works: the photograph of
  `medlemsansokan` and the scanned PDF of `fotosamtycke`. The real Tesseract in Chromium takes
  about nine seconds a page. It checks what is read, not every confidence. The photograph keeps
  no paper; the scanned PDF does, for its twin.

| What | Where |
| --- | --- |
| `ocrWords`: boxes, baselines, confidences, exactly; B1 against recorded readings, with its near misses (a digit zero, a small o, "Om", "[sic]", "lämna") | `paper/ocr.test.ts`, `fixtures/ocr/box-marks.json` |
| A page with fewer than 3 runs is read by the OCR reader, one with 3 is not; without a reader a scan stays empty | `paper/extract.test.ts`, on PDFs written by hand |
| A scan's stages against its expectation; its boxes, its misreads and their caps; the scanned PDF's page goes to OCR | `paper/corpus.test.ts`, `fixtures/documents/scans/` |
| A photograph and a scanned PDF read in the browser by the real Tesseract, their questions on the review screen, added | `e2e/scan.spec.ts` |

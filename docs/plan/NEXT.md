# The next two phases, planned (2026-10-12)

Planning only, written from reading the code at `52ecc79`. Where a point is a design guess rather
than something read in the code, it says **unverified** and the phase's first step settles it.
Order and decisions: `docs/HANDOVER.md`. Context: `docs/plan/DOCUMENTS.md`.

**Status at `2669716` (2026-10-13), measured against `main`:** Phase 1 (1a, 1b, 1c, photos) is
built. Of Phase 0, items 1 and 4 are done; items 2 (ADR 0011 acceptance, the owner's) and 3 (no
cut was made; the budget was raised instead, to 1 150 KB) are not. Of the later phases, Forms, Invoice
scan, Sign hand-off and cancel, and the Summary centre are built; Send is open as PR #169; Campaigns
are not started. The model is **still not cut as a release**: the weights manifest says
`unpublished`, so the centre runs only from a file opened from disk. See `docs/ROADMAP.md` for the
table and `docs/HANDOVER.md` for the order.

## Getting the summary model

**Not downloaded yet.** The owner has the file at
`C:\Users\gusta\projects\THROWPAPER\Qwen3-4B-Instruct-2507-Q4_K_M.gguf` on their PC; this
cloud session cannot read that path, and it is not in the repository. From this container `huggingface.co` is refused by the network policy
(HTTP 403 from the gateway, logged as a policy denial; re-tried 2026-10-12). No tool reaches the
owner's PC. The Hugging Face connector in this session reads model cards and file listings only, so
it cannot carry a 2.5 GB file.

**Verified 2026-10-12 through the connector (not from memory or third parties):**

- `Qwen/Qwen3-4B-Instruct-2507`: licence **apache-2.0** (Hub metadata, and a `LICENSE` file in the
  repository), 4,022.5 M parameters, architecture qwen3, safetensors weights of about 8 GB
  (bfloat16). Qwen publishes no GGUF of it (`Qwen/Qwen3-4B-Instruct-2507-GGUF` does not exist).
- GGUF quantisations are community ones. `unsloth/Qwen3-4B-Instruct-2507-GGUF` (1.3 M downloads,
  tagged apache-2.0, base model linked to the official one) has
  `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, **2,497,281,120 bytes** (about 2.33 GiB). So does
  `lmstudio-community/` (2,497,280,448 bytes; no licence tag) and `bartowski/`; `ggml-org/` has
  Q8_0 only.
- **Not known:** the file's SHA-256 (the connector does not show it), whether a quantiser's repack
  changes behaviour for the twelve languages (that is what the spike measures), and how the model
  runs on an 8 GB laptop.

**Two ways to get the file, either is enough:**

1. In the cloud environment's settings (title-bar menu, Edit, Network access) add
   `huggingface.co` under allowed domains, plus any host a failed download names. The setting may
   only apply to a new session on this branch.
2. On the owner's PC: download the Q4_K_M file, compute its SHA-256, and attach it to a pre-release
   of this repository tagged `model-qwen3-4b-instruct-2507-q4km`, with the hash and the source
   repository in the description. The file never goes into git (`*.gguf` is ignored).
   **GitHub allows under 2 GiB per release file and this file is 2.33 GiB**, so it must go up as
   two parts (for example with 7-Zip's split volumes or `split -b 1200m`), each with its own SHA-256
   and the whole file's, and be joined again (`copy /b a+b out` on Windows). The earlier note in
   `DOCUMENTS.md` that a release file may be up to 2 GiB is right, and this file is over it.

When it is in hand: record the SHA-256 and source in the weights manifest (JSON, ADR 0021) before
anything loads it. Nothing in Phases 0 to 6 needs the model; only Phase 7 does.

## Phase 0 — alignment and headroom (small, one branch)

1. **Invoicing owns its money type — done.** `MinorAmount` moved from
   `packages/shared/src/ledger/api.ts` to `packages/shared/src/api/common.ts`, which both import.
   No invoicing file imports from `ledger`; shared tests, `typecheck` and `contract:check` pass
   unchanged. Touched `packages/`.
2. **ADR 0011 — not done.** The owner accepts it as updated, then its status line changes. Not
   Claude's call; it still says "proposed".
3. **Bundle cut pass — not done (measured 2026-10-12 at `bb82bfd`, nothing cut; the budget was
   raised later instead, see `scripts/bundle-budget.ts`).** The 992.3 KB total is
   every lazily loaded `.js`/`.css` chunk in `apps/forms/dist/assets` (`scripts/bundle-budget.ts`),
   not what a visitor downloads. Largest, gzipped: pdfjs 159.9 KB, the editor's `index` 114.9,
   `mount` 85.0, the import worker 49.6, built-in aliases 42.5, the spreadsheet export `saver` 42.0,
   `Logo` 25.8, twelve locale catalogues 19.4–23.5 each (about 245 in all), stylesheet 17.0.
   Catalogue keys are already checked in both directions by `message-usage.test.ts`, so there is no
   unused-key saving to take. **No saving of the ~7 KB wanted exists without removing a feature**,
   so none was made and the budget was not raised. Candidates, each a decision rather than a tidy-up:
   the spreadsheet export (`saver`, which belongs to the later Spreadsheets catcher), the events and
   door screens when they move out of Forms, and the ledger and events routes' screens. Revisit with
   Phase 1's real delta in hand, and raise the budget in `scripts/bundle-budget.ts` with a reason if
   a feature earns it.
4. **CLAUDE.md "Demo data"** — done: it names the Documents-shaped target. The two-page PDF fixture
   exists in the page-work tests (`apps/api-forms/src/pdf/*.test.ts`); phase 9 added the demo fixtures (`fixtures/demo/`),
   two forms standing for an imported PDF and a Word file, and a To-send message on the desktop.

## Phase 1 — Scan and page basics, PDF text, Word to PDF

### 1a. Page basics — one primitive — built (2026-10-12)

Built as designed: `apps/api-forms/src/pdf/arrange.ts`, `routes/pdf.ts` (`POST /v1/pdf/arrange`),
the screen `apps/forms/src/screens/scan/Scan.tsx` at `/scan` (reached from the room's Scan part), its
list logic `scan-plan.ts`, `e2e/arrange-pages.spec.ts`. Differences from the design below: reorder
is by earlier/later buttons, not drag; PDFs only when first built (photos, the camera and phone
scans were added after, #160); `pagesToPdf` has not moved (it is still in `apps/api-forms/src/signing/scan.ts`). Encrypted PDFs are caught by their `/Encrypt` marker before the guard
(which opens with `ignoreEncryption`), signed ones by `/ByteRange`, and the screen asks before
removing a signature. The bundle total went from 992.3 to 999.95 KB, so its budget was raised to
1 015 (see `scripts/bundle-budget.ts`).

### 1a. As designed

Merge, split, extract, rotate, reorder and delete are all the same operation: *output = an ordered
list of (source file, page, rotation)*. Build that one thing.

- **Route** (new, `apps/api-forms/src/routes/`): `POST /v1/pdf/arrange`, multipart: up to N PDFs
  plus a JSON list `[{file, page, rotate}]`; returns one PDF. A "split" is several calls or a
  zip of them (**unverified**: choose when the screen is designed; one call returning one PDF is
  enough for the first slice).
- **Safety.** Every input first passes `checkPdf` (`apps/api-forms/src/uploads/pdf-guard.ts`: a
  worker with a 5 s and 256 MB budget). Encrypted PDFs are refused with a plain message.
  Already-signed PDFs: arranging breaks the signature, so the screen says so before it proceeds
  (a confirmation, rule 7).
- **Implementation.** `pdf-lib` `copyPages` + `setRotation`; `paper.ts` already uses `copyPages`.
  Limits: total pages and bytes capped; the numbers are decided with a test, not guessed.
- **Screen.** One Scan screen under `apps/forms/src/screens/forms/builder/paper/` (`bundle-split.test.ts`
  and CAVEATS #43 hold the reading code there), page thumbnails from the existing `pdfjs-dist`
  chunk, drag to reorder with `@dnd-kit` (already a dependency), buttons to rotate and delete.
  Camera, phone scan and drop come from the existing `CameraScan` / `PhoneScan` components.
  `pagesToPdf` moves out of `apps/api-forms/src/signing/scan.ts` behind a download route.
- **Tests first:** a fixture PDF of 3 pages with distinct text per page; assert order, rotation and
  page count of the output by reading it back with pdf-lib; an encrypted PDF and a pdf bomb
  (`apps/api-forms/src/test-pdf-bomb.ts` exists) are refused; one e2e through the screen.

### 1b. PDF text (add, cover, replace, redact) - built (2026-10-13)

Built: `POST /v1/pdf/edit` and `POST /v1/pdf/redact` (`apps/api-forms/src/pdf/edit.ts`,
`text-fonts.ts`, `routes/pdf-edit.ts`); the screen is `apps/forms/src/screens/scan/edit/ScanEdit.tsx`
(a lazy chunk), opened by a button on each page of Scan, which first makes the arranged PDF and then
replaces the list with the edited one. Fonts, measured: Helvetica (not embedded) prints every letter
of da de en es fi fr is nb sv; Inter's Cyrillic subset (already a dependency, 10 KB) prints ru, with
digits and punctuation from Helvetica; Noto Sans JP (1.6 MB, vendored under OFL) prints ja (all 6 355
JIS X 0208 kanji, kana, full-width punctuation); Noto Sans SC (1.6 MB, vendored) prints zh (5 717 of
the 6 768 GB 2312 hanzi; the rest are refused by name). Only the glyphs used are embedded (a few KB)
and a CJK file is read only when a character needs it. New dependency: `@pdf-lib/fontkit` (MIT):
pdf-lib cannot embed a font without it. Fonts are woff, not woff2: fontkit throws asynchronously
when it subsets a woff2. Redaction rasterises the page in the browser at 2 px a point, burns the
boxes in, and the server builds a new document from copies of the other pages, so nothing the old
page reached (text, fonts, bookmarks, metadata) travels; a leaf-count check refuses a PDF where a
page rides along anyway. The desktop build does not carry the two CJK files yet (it refuses CJK text
with a plain message). The bundle total went from about 1001.4 to 1011.2 KB (budget 1 015).

### 1b. As designed

- **Add / cover / replace.** `POST /v1/pdf/edit` with ops `{page, x, y, text, size}` and
  `{page, rect, fill}`. Replace = cover then add. Fonts: pdf-lib's standard fonts cover Latin; the
  Cyrillic, Japanese and Chinese catalogue languages need an embedded font. **Unverified:** which
  font, its licence (ADR 0015 applies) and its size; measure before promising all twelve.
- **True redaction.** Painting a black box leaves the text underneath copyable. Design: the page
  to redact is rendered to an image in the browser (pdfjs, already present) with the boxes burnt in,
  and that image replaces the page; the page then has no text layer. The cost is that the redacted
  page is no longer searchable, which the screen says. **Unverified** design; the test is the
  proof: extract the text of the output with pdfjs and assert the redacted string is absent.
- Redaction and edits never touch a signed PDF without the same confirmation as 1a.

### 1c. Word to PDF (rough) - built (2026-10-13, #162)

- Reader exists: `readDocx` in `apps/forms/src/screens/forms/builder/paper/docx.ts:627`, returning a
  `RawDocument`. It runs in the browser, and `apps/api-forms` may not import from `apps/forms`
  (rule 1). So the client reads the `.docx` and sends the parsed document to a route that renders
  it with the existing PDF renderers (`documents/render.ts`, Playwright on a server, Electron's
  `printToPDF` on the desktop).
- **First step, unverified:** read what `RawDocument` keeps. If it drops tables, images or bold
  and italic, the reader is extended first, with fixtures from `scripts/corpus/documents.ts`.
- Kept and dropped parts, and the label, are in `docs/HANDOVER.md` (open question 4).
- Done when: a corpus `.docx` with a heading, a list, a table and an image comes out as a PDF whose
  extracted text contains each, and the dropped-parts note appears for one that has a footer.
- **Built.** `RawDocument` is a line-per-paragraph layout view and keeps no tables, pictures or
  headings, so a sibling reader, `paper/docx-blocks.ts`, reuses `docx.ts`'s styles, numbering and
  runs and returns blocks (`packages/shared/src/api/word-pdf.ts`) plus a `dropped` count per kind.
  `POST /v1/pdf/word` (`api-forms/src/pdf/word.ts`) lays them out in the house print stylesheet.
  The Scan screen's `WordToPdf` adds the result to the page list; the label is on the screen and
  in the download's name. Pictures: PNG, JPEG, GIF only (4 MB each, 8 MB in all); others are
  counted as left out. Fonts: Inter (Latin) is embedded; Cyrillic and CJK use the host's fonts
  (Segoe UI and Yu Gothic on Windows; the Playwright image's on a server), not embedded.
  Tested end to end in `scripts/corpus/word-to-pdf.test.ts` and `e2e/word-to-pdf.spec.ts`.

### Phase 1 acceptance, together

`pnpm run format:check|typecheck|lint|test|build`, `bundle:budget`, `contract:check`,
`licence:check` each green on their own; one foreground `pnpm test:e2e` read from its log. Report
the bundle delta (page work is server-side, the screen is a lazy chunk). New user-facing words in
all twelve catalogues. No new dependency without asking; a font is the likeliest ask.

## Later phases, one line each

2 Forms (draft PDF without a submission, fill a PDF's own fields) - **built**. 3 Send (single, then
batch; confirmation first) - **not on `main`**, PR #169 open. 4 Invoice scan (OCR then rules,
check-digit on the payment reference) - **built**. 5 Sign hand-off and cancel - **built**. 6
Campaigns - **not started**. 7 Summary (needs the model above) - **centre built, model release not
cut**. Details: `HANDOVER.md`.

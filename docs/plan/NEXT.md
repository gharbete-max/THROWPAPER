# The next two phases, planned (2026-10-12)

Planning only, written from reading the code at `52ecc79`. Where a point is a design guess rather
than something read in the code, it says **unverified** and the phase's first step settles it.
Order and decisions: `docs/HANDOVER.md`. Context: `docs/plan/DOCUMENTS.md`.

## Getting the summary model

**Not downloaded yet.** From this container `huggingface.co` is refused by the network policy
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
   repository in the description. The file never goes into git.

When it is in hand: record the SHA-256 and source in the weights manifest (JSON, ADR 0021) before
anything loads it. Nothing in Phases 0 to 6 needs the model; only Phase 7 does.

## Phase 0 — alignment and headroom (small, one branch)

1. **Invoicing owns its money type — done.** `MinorAmount` moved from
   `packages/shared/src/ledger/api.ts` to `packages/shared/src/api/common.ts`, which both import.
   No invoicing file imports from `ledger`; shared tests, `typecheck` and `contract:check` pass
   unchanged. Touched `packages/`.
2. **ADR 0011** — the owner accepts it as updated, then its status line changes. Not Claude's call.
3. **Bundle cut pass — measured 2026-10-12 at `bb82bfd`, nothing cut.** The 992.3 KB total is
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
4. **CLAUDE.md "Demo data"** — done: it now names the Documents-shaped target. Phase 1 still needs
   a two-page PDF fixture for page work.

## Phase 1 — Scan and page basics, PDF text, Word to PDF

### 1a. Page basics — one primitive — built (2026-10-12)

Built as designed: `apps/api-forms/src/pdf/arrange.ts`, `routes/pdf.ts` (`POST /v1/pdf/arrange`),
the screen `apps/forms/src/screens/Scan.tsx` at `/scan` (reached from the room's Scan part), its
list logic `scan-plan.ts`, `e2e/arrange-pages.spec.ts`. Differences from the design below: reorder
is by earlier/later buttons, not drag; PDFs only (photos and the camera are the next increment);
`pagesToPdf` has not moved. Encrypted PDFs are caught by their `/Encrypt` marker before the guard
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
- **Screen.** One Scan screen under `apps/forms/src/screens/builder/paper/` (`bundle-split.test.ts`
  and CAVEATS #43 hold the reading code there), page thumbnails from the existing `pdfjs-dist`
  chunk, drag to reorder with `@dnd-kit` (already a dependency), buttons to rotate and delete.
  Camera, phone scan and drop come from the existing `CameraScan` / `PhoneScan` components.
  `pagesToPdf` moves out of `apps/api-forms/src/signing/scan.ts` behind a download route.
- **Tests first:** a fixture PDF of 3 pages with distinct text per page; assert order, rotation and
  page count of the output by reading it back with pdf-lib; an encrypted PDF and a pdf bomb
  (`apps/api-forms/src/test-pdf-bomb.ts` exists) are refused; one e2e through the screen.

### 1b. PDF text (add, cover, replace, redact)

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

### 1c. Word to PDF (rough)

- Reader exists: `readDocx` in `apps/forms/src/screens/builder/paper/docx.ts:627`, returning a
  `RawDocument`. It runs in the browser, and `apps/api-forms` may not import from `apps/forms`
  (rule 1). So the client reads the `.docx` and sends the parsed document to a route that renders
  it with the existing PDF renderers (`documents/render.ts`, Playwright on a server, Electron's
  `printToPDF` on the desktop).
- **First step, unverified:** read what `RawDocument` keeps. If it drops tables, images or bold
  and italic, the reader is extended first, with fixtures from `scripts/corpus/documents.ts`.
- Kept and dropped parts, and the label, are in `docs/HANDOVER.md` (open question 4).
- Done when: a corpus `.docx` with a heading, a list, a table and an image comes out as a PDF whose
  extracted text contains each, and the dropped-parts note appears for one that has a footer.

### Phase 1 acceptance, together

`pnpm run format:check|typecheck|lint|test|build`, `bundle:budget`, `contract:check`,
`licence:check` each green on their own; one foreground `pnpm test:e2e` read from its log. Report
the bundle delta (page work is server-side, the screen is a lazy chunk). New user-facing words in
all twelve catalogues. No new dependency without asking; a font is the likeliest ask.

## Later phases, one line each

2 Forms (draft PDF without a submission, fill a PDF's own fields). 3 Send (single, then batch;
confirmation first). 4 Invoice scan (OCR then rules, check-digit on the payment reference). 5 Sign
hand-off and cancel. 6 Campaigns. 7 Summary (needs the model above). Details: `HANDOVER.md`.

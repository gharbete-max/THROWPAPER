# Handover

Written 2026-10-12 at `bb82bfd`, after an audit that ran every gate. The previous handover (the
"signing first" prompt and the Forms-only desktop) is in git history at that commit; it described
the earlier product. Read `CLAUDE.md`, then `docs/VISION.md`, then this file, then the section of
`docs/plan/DOCUMENTS.md` for the phase you take.

## What Loppa is

A lightweight, local-first office helper. `docs/VISION.md` is the owner's words. Three independent
catchers in a dark room; only **Documents** is being built, and it must be finished before
anything else. Its four parts are Forms, Scan, Sign and Send, with a summary and translation
centre. Editing is the basics, not Acrobat.

## Baseline at `bb82bfd` (re-measure after any `git switch`)

| Command | Result |
| --- | --- |
| `format:check`, `typecheck`, `lint`, `build` | exit 0 |
| `pnpm test` (Postgres up) | 254 files, 6523 tests passed |
| `bundle:budget` | entry 6.7 / 12 KB, CSS 17.2 / 20, total **992.3 / 1000** gzipped |
| `contract:check` | 9 of 15 implemented, the rest deferred |
| `licence:check`, `builder:validate` | passed (874 packages; 44 nodes, 12 catalogues) |
| `pnpm test:e2e` | **not run** in the audit. A green `verify` is not a green e2e. |

Run the gates one at a time; `pnpm verify` is a serial chain and hides what follows its first
failure. Desktop installer sizes (211.5 MB zipped on Windows, 440.5 MB on macOS) are quoted from
`DOCUMENTS.md` §8 and were not re-measured.

## Decisions of 2026-10-12 (the owner's)

1. **Send includes campaigns** (`SPEC-mailer.md`), built inside Documents, after Sign hand-off.
   First comes batch send: one personalised PDF per recipient from a list, for monthly invoices.
2. **Editing includes a PDF's text**, in two tiers: add a text box, cover an area, replace text by
   covering and writing over it; and true redaction that removes the text underneath. A Word
   file's text is edited inside the `.docx`. CJK and Cyrillic text needs an embedded font; measure
   its size before promising all twelve languages.
3. **Word to PDF is in**, as a rough, labelled conversion built on the existing reader
   (`paper/docx.ts`) and the existing PDF renderers. A faithful conversion stays out.
4. **Ledger** goes to the later Spreadsheets catcher; **events and check-in** to Presentation &
   planning. Nothing is deleted; they stay in place, out of the room, until then. **Invoices stay
   in Documents.** `MinorAmount` now lives in `packages/shared/src/api/common.ts`, so invoicing
   no longer imports the ledger and the ledger can move without it.
5. **Invoice scan:** optical reading (on-device tesseract) then deterministic rules for amount,
   due date, bank number and payment reference, checked by the reference's check digit, asking
   when unsure. Not to be confused with the Swedish "OCR number" in `invoicing/ocr.ts`.
6. **Summary and translation:** one model, Qwen3-4B-Instruct-2507, desktop only, downloaded on
   request, never in the installer. Apache-2.0 and the ~2.5 GB size are from secondary sources:
   confirm on the model card first. Contracts, consents, declarations and clinical forms are
   quoted, never reworded or translated (rule 8, ADR 0012).
7. **Order** was left to Claude: below.

## Where the work stands (2026-10-12)

- **Phase 0:** done, except the owner's acceptance of ADR 0011 (`docs/plan/NEXT.md`).
- **Phase 1a (arrange pages):** built and tested end to end: `POST /v1/pdf/arrange`,
  `apps/forms/src/screens/Scan.tsx` at `/scan`. PDFs only, reordering by buttons. Next in Phase 1:
  photos and the camera into the same screen, then 1b (PDF text) and 1c (Word to PDF).
- **Forms (phase 2 of the order below, built 2026-10-13):** a form's draft is a PDF with no
  submission and no published version (`POST /v1/forms/:id/draft.pdf`, blank or with the author's
  answers; `buildDraftDocument` in `documents/finished-service.ts`); a PDF's own fields are listed
  and filled (`POST /v1/pdf/fields`, `/v1/pdf/fill`, `pdf/fill.ts`, under the same encrypted and
  signed guard as arrange via `openChecked`). Screens: `FillIn.tsx` at `/forms/:id/fill` and
  `/forms/pdf`. The editor's header leads with Download PDF, Fill in, Sign (`/signing`) and Send
  (`/outgoing`, desktop); "Share to collect" is the quiet publish. Doors have addresses:
  `/forms?new=questions|paper|manual`, and a form made by hand opens in the editor. Limit: a PDF's
  own fields take the standard fonts' letters only; Cyrillic and CJK need an embedded font (ADR 0015).
  `e2e/forms-draft-fill.spec.ts` holds it, asking the database for no submission and no version.
- **Invoice scan (phase 4, built 2026-10-13):** a button on Scan opens
  `apps/forms/src/screens/invoice-scan/` (lazy): a photo, scan, camera shot or PDF is read in the
  browser (a PDF's text layer if it has one, else Tesseract through the import's `openPageReader`),
  then the rules in `packages/shared/src/payable` (`@tp/shared/payable`, pure, no model) pick the
  total (bigint minor units; separators by rule, asked when `1.234` is ambiguous), currency, due date,
  bank number (bankgiro, plusgiro, IBAN) and payment reference (Swedish OCR number by Luhn and length
  digit, RF by mod 97), each with its box on the page, its check digit result and its flags. Nothing
  is kept until the person confirms each field; a failed check digit needs a second decision and the
  record names it (`keptDespiteFailedCheck`). Output: JSON, CSV and a payment note, copied or
  downloaded. **No seam into `invoicing/`:** its types are for invoices this organisation sends. Not
  done: Norwegian KID (read as free text, unchecked), the Swedish giro strip's `#` line, payment
  terms ("30 days") never become a date, month names only in sv/da/nb/de/en. Fixtures:
  `fixtures/invoices/invoices.ts` (invented invoices, drawn as words, PDF and HTML);
  `e2e/invoice-scan.spec.ts` reads them through the real Tesseract.
- **Bundle:** the total is 999.95 KB and its budget was raised to 1 015 for this phase
  (`scripts/bundle-budget.ts` says why). Every later phase reports its delta against that.

## Order of work

One phase per branch, plan mode first. Each phase reports its bundle delta.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | Docs aligned (this change). Then `MinorAmount` into invoicing, ADR 0011 accepted, a cut pass for bundle headroom. | Gates green; budget total under 985 KB. |
| 1 | **Scan and page basics:** merge, split, rotate, reorder, delete; photos to one PDF; PDF text tier; Word to PDF (rough). | e2e for each; encrypted and already-signed PDFs tested under `uploads/pdf-guard.ts`. |
| 2 | Forms: draft PDF without publishing; fill a PDF's own fields; "Share to collect" demoted; doors by URL. | An e2e builds a form both ways and downloads it as a PDF. |
| 3 | Send: one document, then batch send. Confirmation first, outbox as test mode. | Nothing leaves without the press. |
| 4 | Invoice scan (decision 5). | Fixtures for each field; wrong or missing references ask. |
| 5 | Sign hand-off and cancel route (`CONTRACT` §5, so `packages/` change). | `contract:check` green. |
| 6 | Campaigns. | Plain email, no open or click tracking, confirmation and test mode. |
| 7 | Summary: the spike (12 languages; speed and peak RAM on an 8 GB laptop; a native speaker rates each summary), then ADR 0023, manifest, pane. | Measured table committed first. Can start any time the network allows. |

## Rules that bite

- Page work stays on the server with `pdf-lib`: in the browser it costs about 206 KB gzipped
  against 7.7 KB of headroom. Untrusted PDFs pass `uploads/pdf-guard.ts` first.
- Redaction must remove the text, not paint over it, and needs a test that extracts text after.
- `packages/shared/src/{builder,interpret,import}` stay pure and deterministic. The model never
  runs there.
- Invoice arithmetic is exact (bigint minor units). A VAT rate is only ever one a human typed.
- A behaviour change to the ladder or import heuristics needs a fixture in the same commit.
- At most one `pnpm test:e2e` at a time; the suite takes minutes. Kill stale preview servers on
  4173 and 4001 between runs.
- No new dependency without asking; `pnpm licence:check` must stay green; model weights need
  their own licence check.
- Internal names stay `throwpaper` / `@tp/*`. Never mass-rename.

## Still true from the earlier handover

- The app sets no cookies and has no analytics or external origins; fonts are self-hosted.
- Gold `#cea85c` is a fill, never text. Text on light takes bronze `#8f6b3a`. Use the derived
  tokens in `packages/tokens/src/derive.ts`; `loppa.test.ts` and `locked.test.ts` are the guard.
- `LAUNCH-CHECKLIST.md` is the list of what the owner must still decide (legal entity, hosting
  region, retention). Do not invent those.
- The owner cannot test by hand; Playwright is the acceptance channel.
- The dev machine is Windows: `&` in npm scripts does not background. Use `pnpm --parallel`.

## Open questions, answered by Claude's reasoning (2026-10-12; the owner may overturn any)

The owner asked for the remaining questions to be answered by logic. Each answer says why.

1. **OCR models stay in the installer for now.** They are about 25 MB of the ~211 MB Windows zip
   (`apps/forms/public/ocr/lang`, twelve languages), and offline-first means a first scan must
   work with no network. Splitting them needs a download mechanism the summary model needs anyway,
   so decide again after Phase 7 has built one. A cut that needs no new mechanism: the build
   copies three tesseract cores (`scripts/ocr-assets.ts`, ~2.9 MB wasm each plus ~3.9 MB of glue);
   the desktop's Chromium supports the newest, so measure whether shipping one is safe.
2. **The room's look is already decided and built.** Dark grey `#2a2b30`; gold under Documents,
   platinum under Spreadsheets, bronze under Presentation & planning, each lifted to at least 3:1
   (`packages/tokens/src/room.ts`, ADR 0022, held by `room.test.ts`). Keep it. A colour change is
   a token edit.
3. **The hosted web edition stays as it is and gets nothing new.** The desktop is where "local,
   private, no account" is true, so Documents is finished there first. The hosted edition gets no
   summary (a model on Loppa's server is not the person's machine) and no page work or redaction on
   strangers' PDFs. Revisit after Phase 7.
4. **The rough Word to PDF keeps:** headings, paragraphs, bold and italic, lists (Word's own
   numbering is already read), tables, images, and page breaks. It drops, with a visible note
   naming each: headers and footers, text boxes, footnotes, tracked changes, and fields. It is
   labelled "layout may differ from Word" on the screen and in the file's name.
5. **Campaigns wait until after Sign hand-off** (order above): invoicing needs batch send, not
   campaigns, and campaigns bring unsubscribe and consent wording, which a human must write
   (rule 8).

Still the owner's, because only the owner can supply them: the legal and hosting rows of
`LAUNCH-CHECKLIST.md`, and any wording a rule 8 template needs.

## Code graph (Graphify)

Installed 2026-10-12 for asking "who calls this / what does this touch" without reading files. It
is a dev tool, not a dependency: Python, outside `package.json`, nothing in the app or the build.

- **Install:** `python3 -m venv ~/.gfy && ~/.gfy/bin/pip install graphifyy==0.9.87` (the package
  name has two y's; others called graphify* are not the project). Metadata read on PyPI:
  repository `Graphify-Labs/graphify`, MIT per its site (the package's licence field is empty,
  so confirm before relying on it).
- **Build, no model and no network:** `graphify update . --no-cluster`, then
  `graphify cluster-only . --no-label --no-viz`. Measured at `546df74`: 16 s, 8,787 nodes, 21,476
  edges, 340 communities, in `graphify-out/` (git-ignored). Query with `graphify explain "name"` and
  `graphify path "A" "B" [--undirected]`.
- **Not run:** `graphify install` (it writes a skill, a `CLAUDE.md` entry and tool hooks into the
  project) and anything that labels communities with a model. Both change instructions or call out;
  do them only if the owner wants.
- **Limits seen:** SQL files are skipped (a parser is missing), 100 TypeScript files produced no
  symbols (mostly tests and config), and a graph says what imports or calls what, never whether the
  code is right: read the file before editing it.

## Where things are

`docs/plan/NEXT.md` (Phases 0 and 1 planned in detail, and how to get the model),
`docs/plan/DOCUMENTS.md` (the plan), `docs/adr/` (0022 the room, 0016 desktop, 0011 invoices),
`docs/CONTRACT.md` (Forms to Sign), `docs/MODULE-STATUS.md` (re-measured at `2669716` at its top; the rest is history).
`docs/PROGRESS.md` is a 3,500-line log: search it, never read it whole.

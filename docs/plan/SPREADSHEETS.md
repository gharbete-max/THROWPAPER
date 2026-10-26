# Spreadsheets, the second catcher — the plan

**Status:** proposed 2026-10-26. Planning only: nothing in this file is built, and no code, catalogue
or dependency changes with it. **What** Spreadsheets is lives in `docs/VISION.md` §5 and the owner's
words (quoted in §0); this file is **how** it gets built. The decisions it shares with Presentation &
planning are ADR 0027. Every default in §1 stands until the owner says otherwise; §9 lists the
questions only the owner can answer, none of which blocks the work.

**Measured at** `c6d62e6` (`main`). Repository claims below were checked by reading the code at that
commit. Web claims carry the date they were read (2026-10-26) and a link in §11; a claim I could not
confirm from a primary source is marked UNVERIFIED.

## 0. What the owner asked for

> data and reports is supposed to be the excel/sheets where i will focus on implementing it as a
> cheat code library full of scripts macro for excel that excel doesnt have, mainly it will be a
> tool helping with excel.

Read plainly: Loppa does not replace Excel and does not need Excel installed. It is a **library of
things to paste into Excel** (formulas, LAMBDA functions, VBA macros, Power Query steps), plus a few
**file tools** that fix what Excel makes awkward (a Swedish CSV that opens in one column, leading zeros
eaten, duplicates), plus the centre's local model to **explain** a formula or a macro. It is
lightweight and offline, like Documents.

## 1. Defaults this plan takes, unless the owner says otherwise

Each is reversible, with its reason. The first column is the question the vision leaves open.

| Open item | Default | Why |
| --- | --- | --- |
| Which Excel | **Desktop Excel for Windows and Mac, Microsoft 365 first, older versions labelled per entry.** Excel for the web, Google Sheets and LibreOffice are not targets. | The owner said "excel". VBA does not run in Excel for the web (§2), so the macros need the desktop program. |
| Which kinds of "cheat code" | **Four kinds:** formulas (including LET and LAMBDA), VBA macros as text, Power Query M steps, and short how-to notes. | These are the four that paste into desktop Excel offline. Office Scripts and Apps Script are out (§2). |
| How code reaches Excel | **The person copies it, or saves it as a `.bas` file and imports it.** Loppa never drives Excel, never opens the VBA editor, never writes a macro into a workbook, never produces `.xlsm`/`.xlam`. | Putting code inside a workbook needs `vbaProject.bin` (binary OLE) and trips Office's macro blocks (§2). Text on a clipboard is inspectable and cannot run by itself. |
| Edition | **Desktop only.** The room shows the catcher on the desktop edition; the hosted edition says "Not in this edition" (as the summary does). | `HANDOVER.md` decision of 2026-10-12: the hosted edition gets nothing new. Files never need a server (§4). |
| Where files are processed | **In the window, in a worker. No server route.** | No `docs/CONTRACT.md` change, no `api-forms` change, nothing leaves the computer. |
| Spreadsheet file library | **None in the first release: Loppa's own bounded OOXML reader and writer** (§4), built on the zip and XML readers Documents already has. | Zero new licences and no 3 MB parser in a bundle that is at its cap; the caps are already coded. Reversible: §4 names the fallback. |
| Writing `.xlsx` | **Always a new file; the original is never touched.** Parts Loppa does not understand are copied byte for byte. | Rule 7 spirit: nothing is lost without a press. Round-tripping a workbook through a model loses charts, pivots and styles. |
| Formats | **In and out:** `.csv`, `.tsv`, `.txt`, `.xlsx`. **Read and report only:** `.xlsm` (flagged "contains macros"). **Refused with a plain reason:** `.xls`, `.xlsb`, encrypted files. | `.xls`/`.xlsb` need a binary compound-file reader; "Save as .xlsx in Excel" is a one-line fix for the person. |
| The four parts | **Library, Convert, Clean, Inspect**; the centre is **Explain and suggest**. | §3. They parallel Forms, Scan, Sign, Send: each is one verb the person already does to a sheet. |
| First slice | **Phases 1–3: the second catcher opens, the Library, Convert.** No model needed. | §6: value without a model, and Library is the owner's core idea. |
| Library content | **Written by the project** for the first release; permissive outside material only with attribution (§5). No forum snippets. | Closed product (ADR 0015). Stack Overflow content is CC BY-SA, share-alike: excluded. |
| Function names in twelve languages | **A table, not the model.** Excel stores formulas in English in the file but shows local names and separators (§2); the table converts between them. | Deterministic and testable. |
| AI scope | **Explain a formula or macro, suggest a formula, review a macro. It may not draft VBA, change a workbook, or run anything.** | §7. Generated executable code is untrusted; a formula is one visible cell and reversible. |
| Tax, payroll, legal, clinical | **No library entry hard-codes a rate, a threshold or a legal rule** (rule 8). A VAT entry takes the rate as an input. | Templates come from a human; the project does not know this year's rates. |
| Ledger, invoices | **Stay where they are** (the rail's "Earlier features" and Documents). Spreadsheets neither imports nor calls them. | The catchers share no contract (VISION §3); `ledger.ts` is a double-entry book, not an Excel helper. |
| Bundle | **A line of its own for the catcher's chunks**, set in phase 1 (ADR 0027 §9). The web total (1 250 KB) is not raised. | The web total is at 1 249 of 1 250 KB (MAP). |

## 2. What "a cheat-code library Excel does not have" can be, offline and safe

The research that decides what the library holds. Primary sources are Microsoft Learn and
specifications; vendor blogs are marked.

| Kind | Runs where | Offline? | Verdict |
| --- | --- | --- | --- |
| **Formulas and LET/LAMBDA** | Any desktop Excel | Yes | **In.** LET is in Excel 2021 and 365; LAMBDA only in 365 and Excel 2024, not Excel 2021 or 2019 (Microsoft's LAMBDA page lists Excel 2024; the 2021 gap comes from a Microsoft Q&A thread, so UNVERIFIED as an official statement). Every entry carries `requires`. |
| **VBA macros (`.bas` text)** | Desktop Excel, Windows and Mac | Yes | **In, as text the person pastes or imports.** VBA does not run in Excel for the web, iOS or Android (Microsoft Q&A, 2026-10-26). Office on Windows blocks macros in files that carry the Mark of the Web (since 2022); that applies to Office *files*, so text pasted into the editor is unaffected, while a downloaded `.xlsm` is blocked until unblocked (Microsoft Learn). Loppa produces no file that carries a macro, so it never meets that block. |
| **Power Query M** | Excel 2016+ (Get & Transform) | Yes | **In, as text** for the Advanced Editor. M is never localised (UNVERIFIED), so no translation table is needed. |
| **Office Scripts** | Excel on the web / desktop with OneDrive | **No** | **Out.** Scripts are stored in OneDrive or SharePoint and "Excel needs internet connectivity to access Office Scripts" (Microsoft Learn); they cannot be linked from a local disk. A business subscription is needed for Power Automate. |
| **Google Apps Script** | Google's servers | **No** | **Out.** A bound script lives in a Google Sheets file and runs under Google's quotas (Google developers). |
| **Office Add-ins (Office.js task pane)** | Hosted web page | No | **Out.** They need a web server for the pane. |
| **COM automation of a running Excel** | Windows only | Yes | **Out.** It would let Loppa change a workbook the person has open, which this plan forbids (§7). |

**Macro safety is a property of the text, so Loppa measures it in the text** (§5.3). Microsoft's own
guidance for macros is "disabled unless signed or trusted"; Loppa's part is to say plainly what a macro
*does* before the person pastes it, and to never be the thing that runs it.

**Formulas are stored in English.** SheetJS's documentation (a third-party source) states that Excel
saves US-English function names and comma separators whatever the interface language, so a French
Excel shows `=SOMME(A1:C3)` while the file holds `SUM(A1:C3)`; newer functions are stored with an
`_xlfn.` prefix (UNVERIFIED against the specification, to be confirmed with a fixture in phase 2). It
follows that (a) reading or writing a formula in a file needs no translation table, (b) **pasting one
into the formula bar does**, and (c) VBA's `.Formula` takes English while `.FormulaLocal` takes the
local form, a trap worth a note on every macro that sets formulas.

**CSV is the other trap.** Excel takes a CSV's delimiter from the Windows list separator; in countries
where the comma is the decimal mark that is a semicolon, so an English-style CSV opens in one column and
a Swedish one gets its decimals read as text (third-party guides; no primary Microsoft page found,
UNVERIFIED). Fixing this is Convert's reason to exist.

## 3. The four parts and the centre

Each part is one screen with its own route under the catcher, a way back to the room, and no
dependency on Documents' screens.

### Library — find a snippet, read what it does, copy it

- **Search by task**, not by function name: "remove duplicates", "split full name", "sum every other
  row", "first non-empty value". Tokens plus a synonym table per language (JSON, §5.2); deterministic;
  no model in the search path.
- **An entry shows:** what it does, a three-row example (input and output), the code, **a safety label**
  (§5.3), **the Excel version it needs**, **where it was verified** (§5.4), its source and licence, and
  notes (for example the `.Formula` vs `.FormulaLocal` trap).
- **Actions:** *Copy*; for a formula, *Copy for my Excel* (names and separators in the person's Excel
  language, §5.5); for VBA, *Save as .bas* (the standard module file the editor imports). Every action is a
  press; nothing is written to a workbook.
- **Not Stack Overflow:** the library is curated and small (a target of 150 entries over the first
  releases, 30 in the first slice), because a snippet site is a different product.

### Convert — files in the shapes Excel does not make easy

- **CSV/TSV/TXT ⇄ XLSX.** Delimiter detection shown and changeable (comma, semicolon, tab, pipe);
  **encoding detection** (UTF-8 with or without a mark, Windows-1252, Windows-1251, Shift_JIS, GBK; the
  platform's `TextDecoder` reads all of them); decimal and thousands marks; date order. Output CSV can be
  UTF-8 with a byte-order mark and an optional `sep=;` line so desktop Excel opens it right (the `sep=`
  trick is documented by third-party guides; UNVERIFIED).
- **Never a silent guess** (the builder's non-negotiable 3, applied here). A column that mixes `03/04/2025`
  styles, or numbers with both `.` and `,`, is shown with the evidence and the person chooses. A long
  digit string (a personal number, an account number, 16+ digits) or one with leading zeros stays
  **text**, because Excel's numbers carry 15 significant digits and drop leading zeros (from general
  knowledge of Excel, not checked against a Microsoft page: UNVERIFIED; a fixture in phase 3 holds the
  behaviour Loppa chooses either way).
- **Exact numbers** (rule 5): values move as decimal strings, never through a float; `0.1 + 0.2` is not
  a thing Convert can produce.
- **Sheets:** one or all sheets of an `.xlsx` to CSV files; several CSV files into one workbook with a
  sheet each.
- **Output is a new file**, named from the input with a suffix, saved on a press.

### Clean — tidy a column or a table, with a preview, into a new file

- **Operations,** each a small pure function on a column or table: trim (including the no-break space
  U+00A0), collapse inner spaces, change case (locale-aware), remove empty rows and columns, remove
  duplicates (choose the columns, keep first or last, case and accent sensitivity chosen), split a column
  (by a delimiter or fixed width) and merge columns (with a separator), find and replace (with the match
  count shown first), text to number and number to text, dates to ISO, **sort with ICU collation** (Swedish
  å ä ö after z; numeric columns by value: rules 5 and 6).
- **A recipe** is the list of operations as JSON (§5.2: provenance, stable order, schema-validated). It
  can be saved and applied to next month's export, the way Send reuses a list's column mapping. A recipe
  that no longer fits the file (a column missing) stops and says which, rather than doing half.
- **Preview first:** the first 50 rows before and after, the count of cells changed, rows removed and
  rows that would be ambiguous. *Apply* writes a new file; the original is untouched; there is no undo to
  need.
- **Surgical `.xlsx` edits:** Clean rewrites only the sheet parts it changes (and the shared-strings part
  if text changed) and copies every other part unchanged, so charts, pivots, conditional formats and
  styles survive. A sheet that holds something Clean cannot rewrite safely (a table with structured
  references it would break, merged cells inside the target, an array formula over the range) is
  refused with the cell named.

### Inspect — a read-only report on a workbook

- Sheets (hidden and very hidden, flagged), used range, count of formulas, **volatile functions**
  (`NOW`, `TODAY`, `RAND`, `OFFSET`, `INDIRECT`), **external links**, defined names, **numbers stored as
  text**, error cells, merged cells, data validation and conditional-format counts, and the file's size by
  part. **Macros present** is reported from the package alone (`vbaProject.bin` exists), never read.
- Every finding names the cell or part. It changes nothing and writes nothing; its "report" may be saved
  as a plain-text or CSV file on a press. It is the part that makes a stranger's workbook less
  frightening before it is opened in Excel.

### The centre — Explain and suggest

A local-model pane (§7), reached from any part with the thing selected: *Explain this formula*, *Explain
this macro*, *Review this macro for risks*, *Suggest a formula for…*. It sits in the middle of the opened
catcher as the summary does in Documents. With no model installed it says so and offers the model list
(ADR 0025 §6); every other part works without it.

## 4. The engine: reading and writing files in the window

**What exists (checked).**
- `apps/forms/src/screens/forms/builder/paper/zip.ts`: a zip reader with the platform's
  `DecompressionStream('deflate-raw')`; stored and deflated entries only; refuses zip64, encryption and
  split archives; caps counted while reading (200 entries, 20 MiB inflated).
- `.../paper/xml.ts`: a non-validating XML reader that refuses any document-type or entity declaration
  and caps nesting at 64; it resolves WordprocessingML names.
- A CRC-32 and a stored-zip builder exist only inside a test fixture (`.../paper/docx.fixture.ts`) and a PNG
  writer (`screens/scan/filter/png1.ts`) uses the platform's `CompressionStream`.
- `screens/send/send-list.tsx` reads a CSV in the browser for Send. It belongs to Documents; Spreadsheets
  does not import it (rule: no cross-catcher imports, ADR 0027 §3). If its rules are worth keeping, phase 3
  lifts the pure part into a neutral package by a pure-move PR.

**What is new, and where.**
- **`packages/ooxml` (`@tp/ooxml`)**: the zip reader, the XML reader generalised to resolve the
  SpreadsheetML, PresentationML, DrawingML and relationship namespaces, a **zip writer** (CRC-32 plus
  `CompressionStream('deflate-raw')`) and the caps as arguments. The first step is a **pure move** of
  `zip.ts` and `xml.ts` out of the Documents screens with their tests, then the docx reader imports the
  package. This is a `packages/` change and is said so in that PR. The same package serves Presentation &
  planning (ADR 0027 §5).
- **`packages/sheets` (`@tp/sheets`)**: the pure core. No React, no DOM, no `node:*`, no `Date.now` or
  `Math.random` in a decision (the builder's purity boundary, enforced by an ESLint pattern like the one
  at `eslint.config.js` for `packages/shared/src/{builder,interpret,import}`): the CSV reader and writer, the
  cleaning operations, the formula tokenizer and linter, the macro scanner, the library schema and loader,
  the function-name table. Bytes are touched only in `apps/forms/src/screens/sheets/` workers.
- **Streaming cell reader.** `xml.ts` builds a tree, which is wrong for a 100 MB sheet. Spreadsheet work
  needs an event-style reader for `<sheetData>` rows. This is the largest new piece of code in the plan
  and phase 3's first task.
- **Caps (defaults):** 200 000 rows by 200 columns and 128 MiB inflated per workbook in the first release;
  a larger file is refused with its size and the reason (Excel allows 1 048 576 rows × 16 384 columns;
  Loppa promises less and says so). Stated in the screen, held by a test, raised after measuring.

**Dependencies considered (npm registry and project pages, read 2026-10-26; ADR 0015).**

| Candidate | Licence | State | Verdict |
| --- | --- | --- | --- |
| SheetJS `xlsx` | Apache-2.0 (docs.sheetjs.com) | npm `0.18.5`; newer builds are served from SheetJS's own site, not npm (UNVERIFIED); known advisories against old builds (UNVERIFIED) | Not used. Reads `.xls`/`.xlsb`, which are out; a vendored tarball would sit outside the lockfile's story. **Fallback** if `.xls` is ever wanted. |
| `exceljs` | MIT | `4.4.0`, last published 2024-12-20; depends on `archiver`, `unzipper`, `fast-csv` (Node streams) | Not used: Node-stream dependencies in a browser worker, no maintenance. |
| `xlsx-populate` | MIT | `1.21.0`, 2025-09-09; depends on `jszip`, `lodash` | Not used: loads and re-serialises the whole workbook. |
| `fflate` | MIT | `0.8.3`, 2026-07-20, no dependencies | **First fallback for the zip layer** if the in-house writer's deflate proves slow. |
| `jszip` | MIT OR GPL-3.0-or-later | `3.10.2` | Allowed by `licence:check` (an `OR` is satisfiable from the allowlist) but not needed. |
| `fast-xml-parser` | MIT | `5.11.2` | Not used: `xml.ts` already has the entity and depth guards. |
| `papaparse` / `csv-parse` | MIT | `5.7.0` / `7.0.3` | Not used: Convert's delimiter, encoding and "ask when unsure" rules are the product, and a CSV reader is about 150 lines. |

**The unverifiable risk, stated.** Neither the CI nor this machine runs Excel, so a hand-written `.xlsx`
could open with Excel's "repair" prompt and no test would say so. Mitigations: write the *minimum* the
format needs, from a template the project authors once and hashes; check every output with LibreOffice
headless (the corpus tooling already needs `soffice`, `scripts/corpus/build.ts`) in an opt-in script
outside `pnpm verify`; and the owner opens the phase-0 outputs in Excel once (§9, question 3). Until that
is done the first release is labelled "not yet opened in Excel by a person" in this file, not on the
screen.

## 5. The library

### 5.1 What goes in, and from whom

- **Written by the project,** from standard idioms, in its own wording, and read by a person before it
  lands. That is the default for everything in the first release.
- **Permissive material** (MIT, BSD, ISC, Apache-2.0, CC0) only with its attribution in the entry and a
  line in `THIRD-PARTY-NOTICES.md` (ADR 0015). Microsoft's documentation samples are reported to be MIT
  in some repositories and not others (UNVERIFIED): check the repository's licence file before any use.
- **Never:** forum answers (Stack Overflow is CC BY-SA), blog posts, paid add-ins' code, anything
  without a licence, anything scraped. A test cannot see a copied snippet, so the `provenance` field is a
  statement the reviewer signs, and the review checklist asks "did you write this?"

### 5.2 The data model (JSON, ADR 0021)

One file per kind under `packages/sheets/src/library/entries/`, plus `library.manifest.json`. Zod
validates on load and reports the first error by path; keys sorted; two-space indent; **provenance is
a field, not a comment**; `pnpm builder:validate`'s pattern gets a sibling, `sheets:validate`.

```json
{
  "id": "formula.split-full-name",
  "kind": "formula",
  "title": { "en": "Split a full name into first and last" },
  "summary": { "en": "Takes the text before and after the last space." },
  "tags": ["text", "split", "name"],
  "code": "=TEXTBEFORE(A2,\" \",-1)",
  "example": { "in": [["Anna Maria Berg"]], "out": [["Anna Maria"]] },
  "requires": { "excel": "2024", "since": "365" },
  "safety": "none",
  "verifiedIn": [{ "app": "Excel 365 Windows", "on": "2026-11-02", "by": "owner" }],
  "provenance": {
    "author": "project",
    "licence": "LicenseRef-Loppa",
    "source": null,
    "attribution": null,
    "reviewedBy": "owner",
    "reviewedAt": "2026-11-02"
  },
  "notes": { "en": "Needs a version with TEXTBEFORE." }
}
```

The entry is an illustration of the shape: its function, its `verifiedIn` and its reviewer are invented
for the example and are not a review.

- `kind`: `formula`, `lambda`, `vba`, `power-query`, `note`. `requires.excel` is the first perpetual version
  that has it or `365`-only; `since` is free text for the UI.
- `title` and `summary` are per-locale maps with `en` required; a missing locale falls back to English with
  an "English" tag, and search covers every available language. **Whether the other eleven are written by
  hand now or later is the owner's** (§9, question 5); no model writes them (the content is not UI chrome,
  but a machine-written snippet note is still unreviewed).
- **Task tags** are a closed vocabulary; their labels are catalogue keys in all twelve catalogues (rule 4).
  The synonym table (`search/synonyms.<locale>.json`) maps words people type to tags.
- **The manifest** lists every entry's id and the SHA-256 of its canonical bytes. A test fails when an
  entry changes without its hash and `reviewedAt` changing together, and the Library shows "from the Loppa
  library, unchanged" only on a hash match (the media and skills folders are held by hash tests in the same
  spirit: `scripts/media.test.ts`, `scripts/skills.test.ts`). Hash-listing is **integrity**, not
  authenticity: there is no certificate and no VBA signature, and the screen does not say "signed".
- **Reset to defaults** (ADR 0021 §3): a person may add their own entries to a file in the user-data
  folder (same schema, marked "yours", never shown as from the library); a malformed file is moved aside,
  not deleted, and "Reset" restores the shipped set.

### 5.3 Safety classification of macros (and formulas)

A pure scanner reads the code text and returns a class. **The scanner decides; the label is derived from
it; an entry whose declared `safety` differs from the scan fails CI.**

| Class | Meaning | Examples the scanner looks for |
| --- | --- | --- |
| `none` (formula) / `read` (VBA) | Reads cells and shows a result. Writes nothing. | `Range(...).Value` on the right of an assignment; `MsgBox`; no assignment to a Range, no `Save`. |
| `writes` | Changes the open workbook. | Assigning `.Value`, `.Formula`, `.Interior`; `.Delete`, `.Clear`, `.Insert`; `Sheets.Add`; `ActiveWorkbook.Save`. |
| `files` | Touches files or folders on the computer. | `Open … For Output`, `Kill`, `FileCopy`, `MkDir`, `Name … As`, `Dir`, `Workbooks.Open`, `SaveAs`, `Scripting.FileSystemObject`. |
| `system-or-network` | Reaches outside Excel. | `Shell`, `WScript.Shell`, `CreateObject` of anything, `MSXML2`, `WinHttp`, `URLDownloadToFile`, `Declare … Lib`, `SendKeys`, `Environ`, `Application.OnTime`, `VBProject`, `Outlook.Application`. |
| `unreadable` | The scanner cannot tell. | `Execute`, `CallByName`, `Application.Run` of a built string, a string assembled with `Chr(...)` that is then used as code, anything it fails to tokenise. Shown in the strongest warning. |

For formulas the scanner flags `WEBSERVICE`, `RTD`, `HYPERLINK`, `CALL`, `REGISTER.ID`, external
references `[Book.xlsx]` and `INFO`/`CELL("filename")`.

- The class is shown on the card in words and with a text label, not by colour alone, and at the top of
  the code for the **highest class** reached. `system-or-network` and `unreadable` cards say: *"This
  macro can act outside the sheet. Read it fully before you run it. Loppa never runs it."* The wording is
  a catalogue key written by a person.
- **Honest limit:** a scanner flags, it cannot prove. The card says what was found and never says "safe".
- **The same scanner runs on code the person pastes** into Explain, and on anything a model returns
  (§7), before it is shown.

### 5.4 Verification: running is the only real test

Nothing here can run VBA in CI. So every entry carries `verifiedIn`: who ran it, in which Excel, on which
date. The Library's default view shows verified entries; *Show not yet verified* is a visible switch, and
an unverified card says *"Not yet run in Excel."* Formula entries can also be checked in an **opt-in**
script (`sheets:verify-formulas`, outside `pnpm verify`, like the real-model suite) by loading them into
LibreOffice headless and comparing the example's output; LibreOffice lacks some Excel functions
(UNVERIFIED which), and those entries stay "by hand". Who verifies, since the owner is one person, is
question 3 in §9.

### 5.5 Localisation of formulas: the function-name table

`packages/sheets/src/functions/functions.json`: one row per function with `id` (the English name, as
stored in files), `since`, `args` (minimum and maximum), and `names` per locale. Locales are the twelve
catalogue locales: `da-DK de-DE en-GB es-ES fi-FI fr-FR is-IS ja-JP nb-NO ru-RU sv-SE zh-CN`.

- **Facts, not a copy.** Function names are short facts; the table is the project's own compilation with
  `provenance` per row (who checked it, in which Excel language, when). Microsoft's *Excel Functions
  Translator* page says the tool "is no longer available and no longer supported" (read 2026-10-26), so
  there is no official source to lean on, and community lists (a Chandoo forum thread offers one in
  sixteen languages) carry no licence and are not used.
- **Starting size:** the 150 most-used functions, then growth by use. Every row's translated names are
  **UNVERIFIED until a person who runs Excel in that language has read them**; the screen shows that
  state for the language (a small "unchecked" tag) rather than pretending.
- **Believed to keep English names: Japanese and Chinese.** (UNVERIFIED: both are believed to display
  English function names; the table's `ja-JP` and `zh-CN` columns are therefore expected to equal the
  English ones. Confirm in phase 2.) That leaves nine columns to author.
- **Separators:** argument separator (`,` or `;`), decimal mark, array-row and column separators per
  locale. A fixture per locale holds `=IF(A1>1,SUM(B1:B3),0)` ⇄ its local form.
- **What it converts:** names, separators, and nothing else; not sheet names, not defined names, not
  string literals (the tokenizer protects them), not R1C1 labels (left out and said so).
- **Direction:** *Copy for my Excel* (English → local) in the Library; *To English* in Explain (a
  formula pasted from a local Excel into canonical form so the model sees English names).

## 6. Phases

One branch and PR per phase, plan first; every gate run singly (`format:check`, `typecheck`, `lint`, `test`,
`build`, `bundle:budget`, `licence:check`); a phase that touches `packages/` says so. Each phase reports
its bundle delta and pays for it. **Exits are checks a test can make.**

| Phase | What | Exit |
| --- | --- | --- |
| **0 — Spike** (throwaway, then a short note appended here) | Pure-move `zip.ts` and `xml.ts` into `@tp/ooxml` and generalise names; a zip writer; a minimal new `.xlsx` written from a hashed template; a streaming `<sheetData>` reader. Corpus: invented workbooks built by a script with LibreOffice (as `scripts/corpus` does), never scraped. | The docx tests pass unchanged on the moved code. A written `.xlsx` is re-read to identical cell values and opens in LibreOffice headless. A 100 000-row sheet reads under the cap without building a tree. The **owner opens the outputs in Excel** (§9 q3). |
| **1 — The second catcher opens** | `/room/spreadsheets`; the placeholder becomes a catcher beneath platinum; the room gains arrow keys (there are now two focusable catchers, `DOCUMENTS.md` §2); the four parts and the centre as empty states with their words; the catcher's budget line; the ESLint import boundary between catchers. | `e2e/room.spec.ts` keyboard, reduced-motion and 360 × 640 cases for two catchers; the placeholder-inert guard now covers only Presentation & planning; contrast test unchanged; `bundle:budget` green with the new line; a test fails if `screens/sheets` imports from `screens/send`, `screens/scan`, `screens/sign` or `screens/forms`. |
| **2 — Library** | The schema, loader, manifest and hash test; the macro and formula scanner; search with synonyms; the cards; Copy, Copy for my Excel, Save as `.bas`; 30 entries (15 formulas, 5 LAMBDA, 6 VBA, 4 Power Query); the function-name table for 100 functions with fixtures per locale. | Every entry validates; every declared `safety` equals the scan (a fixture of 20 macros per class, including 5 obfuscated ones that must read `unreadable`); a hash change without review fails; search returns the right entry for 10 task phrases in each of 3 languages; a formula round-trips English ⇄ each locale on its fixture; the `.bas` file has CRLF line endings and the `Attribute VB_Name` line (checked against the format); axe clean in sv/en/ja. |
| **3 — Convert** | CSV reader/writer in `@tp/sheets` with delimiter, encoding, decimal and date detection; the "ask" screen; CSV ⇄ XLSX single and multi sheet; text kept as text for long digits and leading zeros. | A fixture set: a Swedish `;`/comma-decimal CSV, a Windows-1252 file with å ä ö, a Shift_JIS file, a UTF-8-with-BOM file, a tab file, a quoted field with embedded newline, `03/04/2025` ambiguity: each reads right or asks, never guesses. `0012345` and a 16-digit id survive a round trip as text. Output opened by LibreOffice headless matches. |
| **4 — Clean** | The operations, recipes as JSON, the preview, surgical `.xlsx` edits. | For every operation, a golden before/after; **untouched parts are byte-identical** in the output (hash per part); a workbook with a chart and a pivot keeps both (part list equal); a recipe applied to a file missing a column refuses and names it; ICU sort puts å ä ö after z and numbers by value. |
| **5 — Inspect** | The read-only report. | A fixture workbook with each finding gives exactly the expected report; a macro-enabled fixture says "macros present" and the scanner never reads `vbaProject.bin` (asserted by a spy on the zip reader). |
| **6 — Explain and suggest** | The centre: task kinds, prompts, checks, the pane (§7). | With the fake engine in CI: untrusted-input tests pass; every returned formula goes through the linter; no output is written anywhere; with the real model (opt-in suite) a measured table of 40 prompts lands in this file's appendix. |
| **7 — Demo and guide** | `fixtures/demo/` gains a messy Swedish CSV and a workbook to inspect and clean; `docs/USER-GUIDE.md`; MAP rows. | A person who has never seen it can library → copy → convert → clean → inspect by clicking, on the desktop. |

**The first slice is phases 1–3.** It delivers, with no model and no network: a second catcher that
opens, a searchable verified library of 30 pasteable things in twelve languages' interface, and the one
file fix everyone with a Swedish, German, Danish or Spanish Excel has needed. Sized as about a week of agent work for
phases 1–2 and a second week for phase 3 (an estimate, UNVERIFIED).

## 7. The centre, and what the model may and must not do

It reuses the coordinator of ADR 0024/0025; nothing new is installed (ADR 0027 §6).

- **Task kinds added** to `packages/shared/src/ai/task.ts` and `TASK_CAPABILITY` (all `text`):
  `sheets-explain-formula`, `sheets-explain-macro`, `sheets-review-macro`, `sheets-suggest-formula`.
  Prompts live beside the others in `apps/desktop/src/ai/text/prompts.ts`; pure checks in `@tp/sheets`.
- **May:**
  - Explain, in the person's language, what a pasted formula or macro does, step by step.
  - Review a macro and list what it appears to do to files, other programs and the network. This is
    informational: the **scanner's class is authoritative** and is shown first; the model can add detail
    but cannot lower the class.
  - **Suggest a formula** from a description, as a draft. The model must answer in canonical English
    names and commas; Loppa then (a) parses it with the formula linter (balanced brackets, known function,
    argument counts, version needed), (b) scans it, (c) shows it English and *for my Excel* via the table.
    A formula that does not lint is shown as "does not parse" with the reason, not hidden.
  - Use up to five **sample rows** the person chooses, to ground a suggestion. Nothing else from a file is
    sent to the model; the model is local either way, and minimal context is still the default.
- **Must not:**
  - **Modify a workbook, a library entry or a file.** Its output appears beside the thing explained,
    labelled as generated, kept for the session only.
  - **Write VBA** from a description in the first release (§1; question 4). Reviewing and explaining are
    allowed because they only describe.
  - Run, evaluate or "test" anything (there is no formula engine or VBA host; phase 6 does not build one).
  - Write tax, payroll, legal, clinical or safety wording (rule 8, ADR 0012). A formula that appears to
    compute tax or payroll gets a fixed human-written notice ("check the rates with a professional").
  - Treat a file's text as instructions. Cell text, macro comments and pasted code are **untrusted
    data**: placed between our own tags under a fixed instruction, the model has no tools, and the
    prompt-injection tests of the reply helper (`apps/desktop/src/ai/text/reply.test.ts`) are the template.
- **Checks reused:** the digit check (a number in the explanation that is in neither the code nor the
  sample is flagged); the loop guard; the quote-only word lists apply to any text of the kind
  `packages/shared/src/summary/passages.ts` protects.
- **Quality is measured, not assumed.** The Light tier (Qwen3-VL-2B) is the likeliest model on a laptop.
  Explaining a formula is within a small model's reach; reviewing VBA is less certain (UNVERIFIED).
  Phase 6 measures 40 prompts across the tiers (`scripts/model-bench.ts` is the pattern) before the pane
  claims anything. If the catalogue's models are too weak for code, a code model is a catalogue entry
  (question 4), never a second resident model (ADR 0025's lock).

## 8. What is not built

A formula engine or recalculation; charts, pivots or conditional formats authored by Loppa; a macro
recorder or runner; editing or injecting a VBA project; `.xlsm`/`.xlam` output; `.xls`, `.xlsb`, `.ods`;
encrypted workbooks; Office Scripts, Apps Script and Office Add-ins; automating a running Excel;
collaboration; cloud anything; the ledger or any accounting; tax or payroll templates; drafting VBA with
the model; reports as a product (VISION §5 says "data and reports"; the first release treats "reports"
as the Inspect report and leaves report-building to the owner's later word, question 6).

## 9. Questions only the owner can answer (defaults taken, nothing blocked)

1. **"Reports."** Does "data and reports" mean anything beyond Inspect's report? Default: no.
2. **A fifth thing, the ledger.** Should the ledger (`apps/api-forms/src/routes/ledger.ts`, 419 lines,
   and `packages/calc`) ever surface here? Default: it stays under Earlier features and Spreadsheets
   never touches it. The owner said on 2026-10-12 it "goes to the later Spreadsheets catcher"; this plan
   reads that as a home it may take once the owner wants a ledger-to-workbook export, which would be a
   one-way file the ledger writes and Spreadsheets opens, never a link.
3. **Who runs the entries in Excel,** and which Excel (Windows, Mac, version)? Default: the owner, on
   whatever they have; unverified entries stay hidden behind a switch until then.
4. **May the model ever draft a macro,** and is a code model (for example a Qwen coder model, whose
   licence per size must be read first, UNVERIFIED) worth a catalogue entry? Default: no and no.
5. **Library text in twelve languages:** by hand and by when? Default: English plus Swedish for the first
   30, the rest falling back to English with a tag; native read before any language claims "checked".
6. **Excel on the web / Google Sheets users:** any wish to serve them (formulas only)? Default: no.

## 10. Risks

| Risk | Why it matters | What holds it |
| --- | --- | --- |
| A guessed date or number silently corrupts a file | The worst failure for a data tool | The ask rule; fixtures per locale; text kept as text; preview before write. |
| A hand-written `.xlsx` triggers Excel's repair | Cannot be seen in CI | Minimal template, LibreOffice check, owner opens the spike outputs, fallback to `fflate` or a library. |
| A library entry is wrong or malicious | People paste code into their business workbook | Project-written, human-reviewed, hash-listed, scanner-classed, verified-in-Excel label, never auto-run. |
| The scanner gives false comfort | "read" can still mislead | Never says "safe"; `unreadable` class; the card says what was found. |
| Translations of function names are wrong | Wrong name = `#NAME?` | "Unchecked" tag per language until a native Excel user reads it; fixtures; only 150 functions at first. |
| Memory on a 200 000-row sheet in the window | A renderer that dies loses work | Worker, streaming reader, cap and refusal, no whole-tree XML. |
| Bundle | The web total is at its cap | Catcher chunks on their own budget line; the function table and entries are lazy JSON. |
| Scope creep into "a snippet website" or "Excel in a window" | Loses the lightweight helper | Curated 150-entry target; §8; the two-week slice. |
| The small model is weak on code | Wrong explanations read as authoritative | Measured table first; labelled generated; scanner outranks it; digit check. |
| Rule 8 | A VAT or payroll snippet ships a stale rate | No constants in entries; notice on tax-like formulas; review checklist. |

## 11. Sources (all read 2026-10-26)

- Microsoft Learn, *Macros from the internet are blocked by default in Office*:
  https://learn.microsoft.com/en-us/microsoft-365-apps/security/internet-macros-blocked (Windows only; not
  Mac, not Office on the web; Unblock; trusted locations).
- Microsoft Learn, *Office Scripts file storage and ownership*:
  https://learn.microsoft.com/en-us/office/dev/scripts/overview/script-storage (OneDrive/SharePoint; needs
  internet; no local-disk scripts).
- Microsoft Learn, *Office Scripts platform limits and requirements*:
  https://learn.microsoft.com/en-us/office/dev/scripts/testing/platform-limits (via search result
  summary; licence and Conditional Access limits).
- Microsoft Support, *LAMBDA function*: https://support.microsoft.com/en-us/excel/lambda-function
  (applies-to list read via search result; Excel 2021 gap from Microsoft Q&A, UNVERIFIED).
- Microsoft Support, *Excel Functions Translator*:
  https://support.microsoft.com/en-us/office/excel-functions-translator-f262d0c0-991c-485b-89b6-32cc8d326889
  ("no longer available and no longer supported").
- SheetJS documentation: https://docs.sheetjs.com/docs/miscellany/license (Apache-2.0 for Community
  Edition) and the formulae docbit (English storage), https://deno.land/x/sheetjs/docbits/61_formulae.md.
- Google, *Bound scripts* and *Quotas for Google Services*: https://developers.google.com/apps-script/guides/bound,
  https://developers.google.com/apps-script/guides/services/quotas.
- npm registry, `npm view` of `xlsx`, `exceljs`, `xlsx-populate`, `jszip`, `fflate`, `fast-xml-parser`,
  `papaparse`, `csv-parse` (versions, licences and dates quoted in §4).
- Third-party, lower trust: Office-Watch, *Excel formulas in different languages*
  (https://office-watch.com/2026/excel-formulas-different-languages-how-it-works/); vendor pages on VBA in
  Excel for the web; guides on CSV list separators (Ablebits and others). Cited only where marked.

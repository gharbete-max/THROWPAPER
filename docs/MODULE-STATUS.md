# Module status — measured, not remembered

**Commit measured:** `f0300002a1677d224b1bd5f4bb2af6cf8046c513` (`origin/main`, branch
`claude/ground-truth`)
**Measured:** 2026-09-22
**Machine:** Windows 11, portable Postgres 16, no Docker

Every number below carries the command that produced it. Nothing here is an estimate. Where a
measurement failed, the failure is written down instead of a guess.

---

## 1. Environment truth

### Starting the database

`docs/PROGRESS.md` § L0 has the command, and it is correct:

```
C:\Users\gusta\pg16\pgsql\bin\pg_ctl -D C:\Users\gusta\pg16\data -l C:\Users\gusta\pg16\postgres.log -o "-p 5432" start
```

The cluster persists between sessions, so only `start` is ever needed. It was already running when
measured:

```
$ "C:/Users/gusta/pg16/pgsql/bin/pg_ctl.exe" -D "C:/Users/gusta/pg16/data" status
pg_ctl: server is running (PID: 18220)
C:/Users/gusta/pg16/pgsql/bin/postgres.exe "-D" "C:/Users/gusta/pg16/data" "-p" "5432"
```

`pnpm db:migrate` → `migrations applied`
`pnpm db:seed` → `seed complete — sign in as admin@example.com, form at /f/varmotet-2026`

### The four commands

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm verify` | **1** | Fails at its first step, `format:check`. Nothing after it ran. |
| `pnpm typecheck` | 0 | Clean. |
| `pnpm lint` | **1** | Errors only in `.claude/worktrees/`; 2 warnings in real source. |
| `pnpm test` | **1** | 1 file failed of 139; 2 tests failed of 1782. |
| `pnpm build` | 0 | Clean. |
| `pnpm contract:check` | 0 | `contract:check passed — 0/6 implemented, rest deferred` |
| `pnpm test:e2e` | 0 | **`19 passed (2.0m)`** — see E-2 for what it took |

`pnpm verify` is a serial chain (`format:check && typecheck && lint && test && build`), so its
exit 1 hides everything downstream. The typecheck / lint / test / build rows were obtained by
running those steps individually.

### E-1 — `pnpm verify` is red at `main`, and it was green a day ago

This is a **regression**, not a standing condition. `docs/PROGRESS.md` § L0 recorded, on
2026-09-21 at `691d40a`:

> | `pnpm verify` | exit 0 — format, typecheck, lint (2 `exhaustive-deps` warnings, 0 errors),
> 127 files / 1710 tests, both builds |
> | `pnpm test:e2e` | **11 passed (27.1s)** — genuinely ran, not SKIPPED |

Today at `f030000` — 1 merge commit later — verify exits 1, and the tree has grown to 139 files /
1782 tests and 19 e2e tests. The two `exhaustive-deps` warnings are unchanged and were already
known. **What is new is the two test failures (E-1b) and the worktree noise (E-1a).** L0 also ran
e2e successfully on this machine without mentioning `DOCUMENT_SIGNING_SECRET` — at 11 tests there
was no `restart.spec.ts`, and the document routes it exercises came in with it.

Three distinct causes:

**E-1a — `format:check` and `lint` fail on the nested worktrees, not on the product.**
All 15 prettier offenders and every eslint *error* sit under `.claude/worktrees/`, where two git
worktrees live inside the repo:

```
$ git worktree list
C:/Users/gusta/projects/THROWPAPER                                              691d40a [claude/scan]
C:/Users/gusta/projects/THROWPAPER/.claude/worktrees/l0-baseline                ab2abcc [claude/palette-loppa]
C:/Users/gusta/projects/THROWPAPER/.claude/worktrees/optimistic-swanson-340f11  1f06434 [...]
```

`.prettierignore` already ignores `apps/forms/public/ocr` and `.impeccable/critique/`, but its
patterns anchor at the repo root, so the worktrees' *copies* of those same paths — for example
`.claude/worktrees/l0-baseline/apps/forms/public/ocr/tesseract-core-lstm.wasm.js` — are not
matched. `eslint .` walks them for the same reason.

Falsifiable: adding `.claude/worktrees/` to `.prettierignore` and to the eslint ignore list should
take both steps to exit 0 with no source change. Not done here — Phase 0 is doc-only.

**E-1b — two real tests fail.** Not environmental:

```
FAIL apps/api-forms/src/jobs/worker.test.ts > a job the last worker never finished
  > is taken back once it is older than the lease, and runs again
      expected undefined to be '8185a002-a88d-47af-be18-65bd27213c63'   (worker.test.ts:189)
  > fails for good when its attempts are spent
      expected 'queued' to be 'failed'                                  (worker.test.ts:214)

 Test Files  1 failed | 138 passed (139)
      Tests  2 failed | 1780 passed (1782)
```

Both are job-lease reclaim. 1780 of 1782 tests pass; these two do not.

**E-1c — the two lint findings in real source are warnings, not errors:**

```
apps/forms/src/components/LanguagePicker.tsx     91:6  warning  missing dependency: 'optionId'
apps/forms/src/screens/builder/FormBuilder.tsx  129:6  warning  missing dependency: 'history'
```

### E-2 — `pnpm test:e2e` cannot run on this machine as configured

`apps/api-forms/src/main.ts:9` refuses to start without `DOCUMENT_SIGNING_SECRET`. The root `.env`
does not set it — `.env.example` does, and marks it required. Playwright's `webServer` block in
`playwright.config.ts` passes `DATABASE_URL`, `JWT_SECRET`, `API_FORMS_PORT`, `APP_URL`,
`MAIL_PROVIDER` and `NODE_ENV`, but not this one. Reproduced with the exact command Playwright
runs:

```
$ pnpm --filter @tp/api-forms exec tsx src/main.ts
Error: DOCUMENT_SIGNING_SECRET must be set to at least 32 characters before the server can start.
See .env.example.
    at <anonymous> (C:\Users\gusta\projects\THROWPAPER\apps\api-forms\src\main.ts:10:9)
```

`e2e/restart.spec.ts:51` already defaults this secret for the server *it* spawns, so the repo knows
the suite needs it; the gap is only the shared `webServer` block. Supplying it in the environment
produced the gate:

```
$ DOCUMENT_SIGNING_SECRET='...32+ chars...' pnpm test:e2e
  ok 19 e2e\restart.spec.ts:132:1 › data, a document, an asset and an in-flight job all survive a hard restart (1.5m)
  19 passed (2.0m)
```

The `.env` file was not modified. The fix is one line in `playwright.config.ts`'s `webServer` env,
mirroring `restart.spec.ts` — proposed, not done.

### E-3 — the e2e suite skips silently by design

`scripts/run-e2e.ts:39` exits **0** when no database is reachable, printing `SKIPPED:`. A green
`pnpm verify` therefore proves nothing about e2e. Any future claim of "verify passed" has to be
read alongside the e2e line.

### Counts

```
$ git ls-files | grep -E '\.(test|spec)\.tsx?$' | wc -l         → 142 test files
$ pnpm test                                                      → 139 vitest files, 1782 tests
$ git ls-files e2e | grep spec | xargs grep -cE '^test\('        → check-in 12, public-form 6, restart 1 = 19
```

---

## 2. The scorecard

| # | Module | Source files | Source LOC | Test files | Tests | Endpoints owned | Tables | e2e | **Rank** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Forms** | 180 | 44,469 | 100 | 776 | 74 live + 2 contract (deferred) | 25 | 19 | **Established** |
| 2 | **Mailer** | 8 | 125 | 0 | 0 | 1 live (`/health`) + 4 contract (deferred) | 0 | 0 | **Skeleton** |
| 3 | **Reports** | 15 | 2,769 | 6 | ~110 | 1 route module, inside api-forms | 0 of its own | 1 (indirect) | **Established, unbounded** |
| 4 | **Capture** | 9 | 1,998 | 6 | 40 | 3 route modules, inside api-forms | 0 of its own | 0 | **Partial, embedded** |

Commands behind the first two numeric columns:

```
$ for d in apps/forms apps/api-forms apps/mailer apps/api-mailer; do
    git ls-files "$d" | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' | wc -l
    git ls-files "$d" | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' | xargs wc -l | tail -1
  done
apps/forms        108 files  27473 loc
apps/api-forms     72 files  16996 loc
apps/mailer         3 files     74 loc
apps/api-mailer     5 files     51 loc
```

Reports and Capture are measured over the file sets listed in §5 and §6. They are **subsets of
Forms' 180 files**, not additions to them — the table's rows do not sum.

---

## 3. Module 1 — Forms · **Established**

**The claim:** Forms is the only module that is a product.
**What would falsify it:** a core journey with no endpoint, no screen and no test. None was found.

- **180 source files, 44,469 LOC** — `apps/forms` 108 / 27,473 and `apps/api-forms` 72 / 16,996.
- **100 test files, 776 tests** — `apps/forms` 47 / 211, `apps/api-forms` 53 / 565.
- **74 route handlers** across 15 route modules:
  `grep -rhoE "app\.(get|post|put|patch|delete)\(" apps/api-forms/src --include=*.ts | grep -v test | wc -l` → 74
- **All 16 migrations and all 25 tables.**
  `git ls-files | grep -cE 'drizzle/.*\.sql$'` → 16; `psql \dt` → 25 tables, every one defined in
  `apps/api-forms/src/db/schema.ts`.
- **29 screens.**
  `git ls-files apps/forms/src/screens | grep '\.tsx$' | grep -v test | wc -l` → 29
- **All 19 e2e tests.** Every spec drives Forms.

**Next honest step:** fix the two failing `jobs/worker.test.ts` cases (E-1b) and the two
hook-dependency warnings (E-1c). Forms does not need building; it needs its own gate green.

---

## 4. Module 2 — Mailer · **Skeleton**

**The claim:** Mailer is a health check and a paragraph of prose.
**What would falsify it:** one test, one table, or one endpoint that is not `/health`. None exists.

- **8 source files, 125 LOC total** — less than `packages/calc` (4 files, 346 LOC).
- **0 test files, 0 tests.**
  `git ls-files apps/mailer apps/api-mailer | grep -cE '\.(test|spec)\.tsx?$'` → 0
- **0 migrations, 0 tables.** No `drizzle/` directory, no schema module.
- **1 live endpoint.** `apps/api-mailer/src/server.ts` serves `GET /health` and nothing else.
- **4 of the 6 contract endpoints**, all `deferred`: `messages.send` (B6), `contacts.upsert` (B2),
  `audiences.push` (B7), `templates.list` (B6).
- **0 e2e tests.**
- The UI says so itself. `apps/mailer/src/App.tsx` renders: *"Scaffold only. v0.1 ships a thin
  transactional sending path inside Loppa; Mailer becomes a real product later."*

**On "believed partially built":** it is not partially built. It is scaffolding that correctly
advertises itself as scaffolding. The transactional sending that does exist lives in
`apps/api-forms/src/mail/`, which is Forms.

**Next honest step:** Mailer is the one module that must be built from nothing, and
`pnpm contract:check` already names the order — B2 contacts, then B6 templates, then B7 audiences,
then B11 delivery events. Start with B2; it is the only one with no upstream dependency.

---

## 5. Module 3 — Reports · **Established, but unbounded** (§1.3)

Reports is real, tested and shipping — and it has no boundary. It is not a folder that can be
moved.

### Where it lives today

| Path | LOC | Role |
| --- | --- | --- |
| `apps/api-forms/src/documents/admission.ts`, `admission-service.ts` | — | admission document + bulk job |
| `apps/api-forms/src/documents/invoice.ts`, `invoice-copy.ts` | 619 | invoice rendering and wording |
| `apps/api-forms/src/documents/render.ts` | 76 | the PDF renderer itself |
| `apps/api-forms/src/documents/store.ts` | 102 | where documents are written |
| `apps/api-forms/src/documents/qr-token.ts` | 77 | signed admission QR |
| `apps/api-forms/src/documents/client-identity.ts`, `link-preview.ts` | 264 | — |
| `apps/api-forms/src/documents/paper.ts` | 316 | **shared with Capture** — see §6 |
| `apps/api-forms/src/routes/documents.ts` | 325 | the HTTP surface |
| `apps/forms/src/screens/EventReport.tsx` | 204 | the screen |
| `packages/tokens/src/compile-pdf.ts`, `pdf.ts` | 178 | print CSS / PDF tokens |

**15 source files, 2,769 LOC, 6 test files (≈110 tests).**

### Who imports it — the finding that decides ADR 0008

Nine modules outside `documents/` import from it:

```
$ grep -rn "from '.*documents/" --include=*.ts --include=*.tsx apps packages \
    | grep -v "^apps/api-forms/src/documents/" | grep -v "\.test\."
apps/api-forms/src/checkin/service.ts         → documents/qr-token.js
apps/api-forms/src/demo/main.ts               → documents/store.js, documents/render.js
apps/api-forms/src/mail/send-job.ts           → documents/admission-service.js, documents/admission.js
apps/api-forms/src/routes/checkin.ts          → documents/admission.js
apps/api-forms/src/routes/documents.ts        → documents/admission-service.js, store.js, paper.js
apps/api-forms/src/routes/forms.ts            → documents/admission.js
apps/api-forms/src/routes/invoices.ts         → documents/render.js
apps/api-forms/src/routes/public-invoices.ts  → documents/render.js, invoice.js, invoice-copy.js
apps/api-forms/src/server.ts                  → documents/link-preview.js, client-identity.js, render.js
```

Check-in depends on Reports for QR verification; mail depends on it for the admission attachment;
the server wires its renderer at startup. Extraction is a dependency-inversion job, not a move.

**Next honest step:** write ADR 0008 against this import list. Option (a), `packages/reports`, is
the only one the list supports — a standalone `apps/api-reports` would put an HTTP hop inside the
check-in door's verification path.

**Nothing was moved.**

---

## 6. Module 4 — Capture · **Partial, and already decided**

**The brief says Capture "does not exist. New product." That is the one premise the measurements
contradict, and it is the most consequential finding in this document.**

Capture exists, ships, is tested, and its architecture was decided six days ago in an **accepted
ADR**.

### What exists

```
$ git ls-files | grep -iE "paper|ocr|scan|capture|extract|crop"
apps/forms/src/screens/builder/paper/CropPhoto.tsx
apps/forms/src/screens/builder/paper/ImportPaper.tsx
apps/forms/src/screens/builder/paper/PaperCanvas.tsx
apps/forms/src/screens/builder/paper/extract.ts        + extract.test.ts
apps/forms/src/screens/builder/paper/ocr.ts            + ocr.test.ts
apps/forms/src/screens/builder/paper/warp.ts    (200)  + warp.test.ts (117)
apps/api-forms/src/documents/paper.ts           (316)  + paper.test.ts
apps/api-forms/src/routes/paper.test.ts, paper-fill.test.ts
packages/shared/src/invoicing/ocr.ts                   + ocr.test.ts
scripts/ocr-assets.ts
docs/adr/0004-old-forms-on-paper.md
```

**9 source files, 1,998 LOC, 6 test files, 40 tests.** Zero e2e coverage — the only gap that is
genuinely a gap.

### ADR 0004 already rules on the central question

`docs/adr/0004-old-forms-on-paper.md` is **`accepted 2026-09-16`**. It already decides the thing
the brief proposes to re-open: *OCR never creates a field.* From
`apps/forms/src/screens/builder/paper/ocr.ts`:

> `docs/adr/0004-old-forms-on-paper.md` rules out guessing questions from a scan […] So OCR here
> never creates a field. The author draws a box; this offers the words next to it, verbatim.

That is the brief's own "human review and correction UI before anything is committed" — already
built, already tested.

### The engine question is also already answered, and answered harder

The shipped engine is **tesseract.js**, self-hosted. From the same file:

> `tesseract.js` defaults its worker, WebAssembly core and language data to a CDN. The content
> security policy is `'self'` with no CDN, on purpose, so `scripts/ocr-assets.ts` copies all three
> into `public/ocr/` […] The photograph never leaves the browser: recognition runs in a worker on
> this machine.

This is a **stronger** privacy position than ADR 0007 proposes. The brief's cascade — PaddleOCR and
TrOCR — is Python. Adopting it means a server-side service that receives photographs of forms,
replacing an in-browser pipeline where the image never leaves the device at all. The brief's own
deciding argument against cloud OCR (CSP posture, third-country transfer, GDPR) argues at least as
hard against a server-side Python cascade.

### What is actually missing

1. **Handwriting.** Tesseract is printed-text only, as the brief correctly notes. This is the
   single real capability gap, and the only honest reason to open ADR 0007.
2. **The extraction half of ADR 0004 is deliberately unbuilt**, blocked on owner answers. The ADR
   says so itself: *"This ADR stays proposed until they are answered."* Those questions — where an
   uploaded file lives, whether it is kept, what caps a parser runs under — are the same retention
   and region questions the brief lists as Capture's legal blockers. **They are already written
   down in ADR 0004 and still unanswered.**
3. **Zero e2e coverage.**

**Next honest step:** answer ADR 0004's open questions before writing ADR 0007. If ADR 0007 is
written, scope it to **handwriting only**, as a delta on ADR 0004 — not as a ground-up product
decision that re-litigates a shipped, accepted, more-private design.

---

## 7. The three questions, answered plainly

**1. Which module is most thoroughly built, and what is the evidence?**

**Forms**, by roughly two orders of magnitude: 44,469 LOC to Mailer's 125; 776 tests to Mailer's 0;
74 endpoints to Mailer's 1; 25 tables to Mailer's 0; 19 e2e tests to Mailer's 0.

**2. Which are stubs or partial?**

**Mailer is a skeleton** — 8 files, 125 lines, no tests, no tables, one `/health` route, and a UI
that says "Scaffold only". **Capture is partial and embedded** — 1,998 LOC of working
photograph-to-form code inside Forms, missing handwriting and e2e coverage. **Reports is neither
stub nor module** — 2,769 lines of shipping code with nine importers and no boundary.

**3. The honest next step for each:**

| Module | Next step |
| --- | --- |
| Forms | Fix `jobs/worker.test.ts` (2 failures) and the 2 hook-dependency warnings. Get its own gate green. |
| Mailer | Build B2 (contacts) first. It is the only module that genuinely starts from zero. |
| Reports | Write ADR 0008 against the nine-importer list in §5. Option (a), `packages/reports`. |
| Capture | Answer ADR 0004's open questions. Scope ADR 0007 to handwriting only, or do not write it. |

---

## 8. Premises in the brief that the measurements corrected

| Brief says | Measured |
| --- | --- |
| Capture "does not exist. New product." | Exists: 1,998 LOC, 40 tests, ADR 0004 **accepted**, tesseract.js shipped self-hosted |
| Postgres start command is in `docs/PROGRESS.md` § L0 | Correct. Cited in §1 above |
| Mailer "believed partially built" | Skeleton: 0 tests, 0 tables, 1 endpoint |
| `LAUNCH-CHECKLIST.md` §2.3 has "seven measured rows" | **8** rows |
| e2e "must report 19 passed" | Correct — but only on `main`, and only with `DOCUMENT_SIGNING_SECRET` set (E-2) |
| `pnpm verify` is the gate | It is **red at `main`** (E-1), and was green at `691d40a` a day earlier. A regression, not a standing condition |

Two further drifts found while measuring, both in `CLAUDE.md`'s package descriptions:

- **`packages/calc`** is described as "Formula AST, statistics library, chart definitions". It
  contains `errors.ts`, `money.ts`, `ledger.ts`. There is no AST, no statistics and no charts.
- **`packages/ui`** is described as "Headless + styled primitives, including the data grid". It
  contains one 4-line `cn()` helper. Its own `index.ts` says the grid "is deliberately NOT in
  v0.1", so the code is honest and the description is not.

---

## 9. For the phases after this one

- **`.claude/agents/` does not exist.** The Phase 5 roster has to be created from scratch.
- **`.claude/worktrees/` holds two live worktrees inside the repo**, which is what breaks
  `format:check` and `lint` (E-1a). Any agent given `isolation: worktree` adds more.
- **`git lfs ls-files` → 23 files; `.git` is 19 MB.** LFS weight is not yet a problem.
- **The contract is entirely unimplemented** — `0/6`. Every inter-product endpoint is deferred, so
  there is currently no contract drift to find, only contract absence.

# MAP — read this first, then open only the area you work on

A router for a coding session, written to save tokens. It summarises `docs/VISION.md`, `CLAUDE.md`,
`docs/HANDOVER.md` and the ADRs; where it is thin, the linked file is the authority. **Change this
file in the same PR that changes an area** (a stale map is worse than none). Last updated 2026-10-20 (cleanup: Mailer stubs, the old wizard and finished plans removed).

## What Loppa is
A lightweight, **local-first office helper**, not Acrobat. A room of three independent catchers
(Documents, Spreadsheets, Presentation & planning). Only **Documents** is built: **Forms, Scan, Sign,
Send** around an optional **AI centre**. The other two are inert placeholders. Desktop (Electron) is
the product; the hosted web edition is secondary. Internal names stay `throwpaper` / `@tp/*`.

## Rules that decide most questions
1. **Offline by default.** The network only on a user press, with a confirmation naming the host
   (ADR 0026). No telemetry, no cloud AI, no update ping.
2. **AI is optional.** Loppa works with no model. One model resident at a time. AI output is labelled
   generated, kept beside the document, never written into it. The builder/import stay rule-based:
   the model never runs in `packages/shared/src/{builder,interpret,import}`.
3. **Rule 8: no generated legal, clinical, tax or safety wording.** Contracts, consents, declarations,
   clinical forms are quoted, never reworded or translated (ADR 0012). A human writes such text.
4. **Nothing sends or deletes without a confirmation; every outbound action has a test mode.**
5. No hard-coded strings, colours, fonts: strings are keys in **all twelve** catalogues
   (`apps/forms/src/lib/messages/`: da de en es fi fr is ja nb ru sv zh), colours/type from `packages/tokens`.
6. Exact arithmetic (bigint minor units, never floats). ICU collation for sorting; numbers sort numerically.
7. Products never import each other (Forms, Sign) — only HTTP via `docs/CONTRACT.md`.
8. Only permissive licences (ADR 0015); weights need their own licence check. No new dependency without need.
9. Page work (merge/split/redact) stays server-side with `pdf-lib`; untrusted PDFs pass `uploads/pdf-guard.ts`.
10. Monetisation, company, terms, pricing are **out of scope** for development. Don't raise them.

## Where to look (open only the row you need)
| Working on | Code | Read first |
| --- | --- | --- |
| `screens/` is one folder per part: `room/ scan/ send/ sign/ forms/ ai/`, plus `earlier/` (events, door, inbox, users, brand kit: the rail's "Earlier features") and `shell/` (login, callback). Pure moves (SIMPLIFY 4); tests sit beside their screen. | `docs/plan/SIMPLIFY.md` |
| Room, catchers, arrival, side rail | `apps/forms/src/screens/room/` (`Room.tsx`, `documents/`: hand-offs, keep panel, recent documents), `packages/tokens/src/room.ts`; the rail is `Shell` in `App.tsx` (four parts + AI centre; events, responses, invoices, users, brand folded under "Earlier features", routes unchanged) | ADR 0022, `docs/plan/DOCUMENTS.md` §2, `docs/plan/SIMPLIFY.md` |
| Scan (three steps: Bring in, Fix, Keep; pages, photos, filters, digital copy, invoice, PDF text/redact, Word→PDF) | `screens/scan/` (`Scan.tsx` state and hand-offs, `StepBar.tsx`, `edit/`, `filter/`, `digital-copy/`, `invoice/`, `Invoices.tsx`, `PhoneScanPage.tsx`, `WordToPdf.tsx`), `api-forms/src/pdf/`, `routes/pdf*.ts`, `packages/shared/src/{import,payable}` | `docs/plan/IMPROVEMENTS.md`, `NEXT.md`, `archive/plan/SCANS.md` |
| Forms (builder, fill, draft PDF) | `screens/forms/` (`Forms.tsx`, `FillIn.tsx`, `FormResponses.tsx`, `PublicForm.tsx`, `builder/`), `packages/shared/src/{builder,interpret,import}` | ADRs 0017–0021, `docs/plan/PREDICTIVE-BUILDER.md`, `CAVEATS.md` |
| Sign | `screens/sign/` (`Signing*.tsx`, `MarkMaker`, `PlaceMarks`), `apps/sign`, `apps/api-sign`, `packages/signing` | `docs/CONTRACT.md` §5, ADR 0009 |
| Send (single, batch, campaigns, reply helper) | `screens/send/` (`Send*.tsx`, `Outgoing`, address parts, reply helper), `api-forms/src/{send,mail}`, `routes/send.ts`, `campaign.ts` | `docs/HANDOVER.md`, ADR 0026 |
| AI (coordinator, engine, models, reader, summary) | `apps/desktop/src/ai/` (`coordinator`, `engines/`, `text/`, `vision/`, `resolve`, `download`, `cache`, `graphics`, `runtime-fetch`, `server/gpu`), `packages/shared/src/{ai,summary,quoted}`, `apps/forms/src/lib/{ai-bridge,model-bridge}.ts`, `screens/ai/` (`Summary.tsx`, `AiSetup.tsx` the one Set up AI page: recommended model, Choose another, Advanced, with `summary/{ModelsPanel,ModelTiers,GraphicsSetting}.tsx`; `read-ai/`, `proofread/`) | `docs/plan/AI-SYSTEM.md`, `docs/plan/VISION-TUNING.md` (speed and accuracy numbers per setting and model), ADRs 0023–0025 |
| Desktop packaging, AI pack | `apps/desktop/` (`scripts/build.ts`, `electron-builder.yml`, `scripts/{fetch-runtime,make-ai-pack,join-ai-pack,publish-ai-pack}.ts`, `src/ai/pack.ts`) | ADR 0016, 0025 §6, `docs/DEPLOY.md` |
| Bundle / budgets | `scripts/bundle-budget.ts` (web total 1250 KB gz, 1248.9 on 2026-10-21; entry 12, entry css 14.5; lazy css counts in the total) | its header comment. CSS: `apps/forms/src/styles.css` is the entry (tokens, reset, shell, site, controls); `styles/app.css` loads with `App.tsx`, `styles/builder.css` with the builder, fill and public-form screens |
| Demo data | `fixtures/demo/`, seed in `apps/api-forms/src/demo` | `CLAUDE.md` § Demo data |
| Design | `DESIGN.md`, `docs/plan/DESIGN-LANGUAGE.md`, `docs/brand/`, `docs/plan/DESIGN-PASS.md` (the 2026-10 critique, what is left) | gold is a fill, never text |
| Photographs (twelve: empty states and screen heads, never the room) | `apps/forms/public/media/`, `EmptyState`'s `media` prop | `docs/brand/MEDIA.md` (source, licence, hash per file; `scripts/media.test.ts`) |
| What the app shows a user (words, flows) | `apps/forms/src/lib/messages/en-GB.ts` | `docs/USER-GUIDE.md` (keep it in step with the screens) |
| Structure, simplification | `docs/plan/SIMPLIFY.md` | its ranked table and order |
| Reviews (coverage map, findings, residual risks) | `docs/reviews/` (`2026-10-forms-ui.md`: Forms UI, twelve languages, axe, perf, keyboard; `2026-10-backend-and-shared.md`: backend and shared packages; fuzz tests are `*/fuzz*.test.ts`, seeded, `FUZZ_SEED=<n>` replays; `2026-10-sign-and-carryover.md`: Sign and seal, checked by OpenSSL and `sealing/node-verifier.ts`, tamper tests `sealing/tamper.test.ts`, plus the carry-over fixes: LAN relay, Outlook unknown outcome, lazy guided draft, spinner, scrim guard; A-7..A-10 closed: clock-skew refusal in `packages/signing`, `ipFlood` in `api-sign/src/rate-limit.ts`, `#`-escaped names and object-stream signatures in `api-forms/src/pdf/arrange.ts`, signed-copy mail once per signer) | `docs/SECURITY-REVIEW-2026-10.md` |
| Which decision says what | `docs/adr/README.md` | one line per ADR with its status |
| Contract / API | `docs/CONTRACT.md`, `packages/shared/src/contract`, `pnpm contract:check` | |
| Reviews (security 2026-10, desktop and AI 2026-10: scenario table, soak, installer numbers) | `docs/SECURITY-REVIEW-2026-10.md`, `docs/reviews/2026-10-desktop-ai.md`; tests `apps/desktop/src/ai/reliability{,.real}.test.ts`; installed-program smoke `apps/desktop/scripts/smoke-installed.ts` | the finding tables |

## AI in one paragraph
One multimodal model, **Qwen2.5-VL-7B-Instruct** (Q4_K_M + f16 or lighter Q8_0 projector; Apache-2.0;
files sit in the repo root in dev, Git-ignored), run by a pinned **llama.cpp `llama-server`** child
process on loopback (ADR 0025); killed when idle so memory is truly freed. Needs ~12 GB RAM (9.8 GB
measured peak); CPU only by default. An optional catalogue of smaller Apache-2.0 models (Qwen3-VL
4B/2B, SmolVLM2) is in the catalogue and was measured 2026-10-20: **Qwen3-VL-2B** reads a page in 21 s (3.7 GB) against the 7B's 56 s at 41/48 against 44/48 known strings; the 4B has no edge over the 2B; both SmolVLM2 models do not work yet. A table is asked for as `rows`, the Q8_0 projector is preferred, and the Vulkan (graphics card) build is an **optional setting**, off by default (VISION-TUNING §5, ADR 0025 amendment): "Use the graphics card (faster, optional)" in the model list, Windows x64 only (macOS says "not available yet"). Turning it on without the program asks first (github.com, file, size) or takes it from a `runtime-vulkan` folder placed by hand; the pinned build fits the layers to free memory itself (`-ngl auto`, `--device` the first listed card); any failure (no device, start, memory, first request) falls back to the processor with a plain notice and a remembered, clearable failure (`graphics.json`); the status says what it runs on. Tasks: read-page (vision), summarise, translate, quote, proofread,
compose-email, reply. Never in the installer (≈6 GB): ships as a separate AI pack (parts < 2 GiB + `PACK.json`; `make-ai-pack.ts`, `join-ai-pack.ts`, `publish-ai-pack.ts`, `src/ai/pack.ts`; install offline via *Open a file from disk* → `PACK.json`). The Windows installer carries `llama-server` in `resources/ai-pack/runtime`. Results are cached
per page. Local file resolution: `LOPPA_AI_DIR` → `local-models/` → repo root (dev) → `resources/ai-pack`
→ user-data. `LOPPA_MODEL_PATH` points a dev run at a file.

## Navigating cheaply (use before opening files)
- **Graphify** (code graph, local, no model; `graphify-out/` is git-ignored). Install once:
  `python -m venv ~/.gfy && ~/.gfy/Scripts/pip install graphifyy==0.9.87` (two y's). Build: `graphify update . --no-cluster`
  then `graphify cluster-only . --no-label --no-viz` (~30 s, ~11 k symbols). Query: `graphify explain "Name"` (callers,
  callees, tests with `file:line`), `graphify path "A" "B" --undirected` (how two things connect). It says what calls
  what, never whether code is right: read the file before editing. Don't run `graphify install` (it writes hooks into the repo).
- **Search before read:** `Grep` with `output_mode: files_with_matches`, then `-n` with `head_limit`; read a file with
  `offset`/`limit` around the hit. Glob by area (`apps/forms/src/screens/send/**`).
- **Exports at a glance:** each package's `src/index.ts` and subpath exports (`@tp/shared/ai`, `/summary`, `/import`) are the API.
- **Tests name the behaviour:** `grep -n "it('" file.test.ts` reads faster than the code.
- **Decisions:** ADR headings only (`grep -n "^#" docs/adr/00NN-*.md`); the Status line says if it is current.
- **Heavy sweeps** (many files, one conclusion) go to a read-only `Explore` subagent; an agent costs its own tokens,
  so run one at a time and ask for a 25-line report.

## Commands
`pnpm verify` (serial chain; exit 1 tells only the FIRST failing step — run `format:check`, `typecheck`,
`lint`, `test`, `build` singly) · `pnpm test:e2e:smoke` (about 1 min: the `@smoke`-tagged specs via `playwright --grep @smoke`, for UI-only changes; CI and merges run the full suite) · `pnpm test:e2e` (full; ONE run at a time; at most one agent) · `pnpm bundle:budget` (after build) ·
`pnpm contract:check` · `pnpm licence:check` · `pnpm builder:validate` · `pnpm --filter @tp/desktop start|package:win`.
Postgres is portable at `C:\Users\gusta\pg16` (no Docker). After dependency changes: `pnpm exec playwright install chromium`.

## Known quirks (don't chase)
- Unit tests: all green on Windows (2026-10-20, 7575 tests; `mail/queue.test.ts` skips its POSIX file-mode check there). In a nested worktree under `.claude/` vitest can still end with one unhandled `mkdir C:\C:\…\fixtures\sessions` snapshot-path error after every test passed: not a failing test.
- Desktop build needs `NPM_CONFIG_USERCONFIG=<empty file>` (global `~/.npmrc` has an `allow-scripts` line npm 11 rejects).
- Desktop installer: build from a SHORT path (a copy at `C:\tpb`); a deep worktree path broke NSIS once. An AI pack cut by `make-ai-pack.ts` is `<name>.partN` files: the app finds them by that name (the manifest lists files whole). Real-model suite is opt-in (`LOPPA_REAL_MODEL=1`, header of `reliability.real.test.ts`); never damage a hard link to the owner's model files, copy first. The modern Windows file dialog has no UI Automation Value/Invoke pattern: `smoke-installed.ts` types into it with SendKeys.
- Shell: Bash tool mangles `|` in quoted args to pnpm scripts — call `pnpm exec playwright test --grep …` directly.
- Guided-builder layout checks (`answersFit`, `nothingCut`) finish the slide-in animation before measuring (`settle`); a node 24 px along its way reads as off the screen. Full e2e on 2026-10-20: 156/156, 12 min.
- a11y smoke (axe-core 4.10, injected from a scratch install, not a dependency): room, Scan, Send, Summary, Signing in sv/en/ja were clean on 2026-10-20 apart from the two minors since fixed in #206 (Send's `textarea role=combobox`, the empty actions `<th>`). A contrast hit on Signing is the start-up intro fading in, not a defect.
- e2e sign-in: the magic-link callback is rate-limited (20 per 15 min for the whole suite, `routes/auth.ts`) and the suite is near it; a new spec signs in with `signInAs` (a planted refresh token), never `/auth/callback`. Past the cap, a later spec fails with "Back to sign in" on the page.
- CSS lives in three files (`styles.css`, `styles/app.css`, `styles/builder.css`). A rule goes in a lazy file only if no later rule in another file has equal weight, shares a property and can hit the same element; such overrides stay in the entry. More, smaller files compress worse: 13 files cost +5.9 KB in the total. A new rule goes in the file of its screen; tests that read CSS use `lib/all-css.ts`.
- `pdfjs-dist` pinned 6.3.289 (6.4 changes golden-corpus reading).
- Zod 4 (ADR 0005 #99). Where it differs from 3: an enum-keyed record is exhaustive (`z.partialRecord` for the old behaviour); `.default(x)` skips parsing (`.prefault` when `x` must still gain nested defaults); `z.string().uuid()` is RFC-strict (the workspace says `z.guid()`); a `z.unknown()` key is required unless `.optional()`; error wording is `Invalid input: expected …`. Each API has its own `zod-serializer.ts` (parse, then stringify) because the provider's encodes and refuses `.transform()`. Forms' `vite.config.ts` stubs Zod's JSON Schema generator out of the page and worker bundles and minifies with terser: that, not slack, is what keeps the 1 250 KB total.
- Gitleaks scans every PR commit: no secret-looking literals in tests.
- A green `verify` is not a green e2e; a backgrounded exit code is not the command's; re-read files after `git switch`.
- `.claude/` is ignored by prettier/eslint/vitest: gates run inside the worktree you work in.

## Working style
Plan before a phase; one branch/PR per phase; `pnpm verify` + `contract:check` before done; say when
`packages/` or `docs/CONTRACT.md` changes; batch questions; decide small things yourself. Shared test
resources (one Postgres, fixed ports): take the lock `mkdir C:/Users/gusta/AppData/Local/Temp/tp-e2e.lock`
before DB tests/e2e, `rmdir` after. Run agents one at a time unless work is truly disjoint.
Merge `origin/main` in (never rebase or force-push a PR branch that Auto-fix watches).

## Current state (2026-10-21)
**Built and merged** (everything is on `main`; no PRs or agents are open):
- **Documents catcher**: the room, Forms (guided and manual, draft PDF, fill), Scan as three steps (Bring in, Fix,
  Keep) with filters, digital copy, searchable PDF, redaction, Word to PDF, invoice reading; Sign (own marks, placement,
  cancel, second seal verifier); Send (one document, batch, campaigns with a footer you complete, do-not-email list,
  reply helper, corporate email, proofreading).
- **AI**: one model (Qwen2.5-VL-7B) through a pinned llama-server, a catalogue of smaller Apache-2.0 tiers, a 'Set up
  AI' page, an optional graphics-card setting with a processor fallback, the AI pack (split/join/publish scripts,
  offline install), measured speeds (docs/plan/VISION-TUNING.md).
- **Structure**: the rail follows the room (earlier features folded), `screens/` in feature folders, CSS split (entry
  11.8 KB), Mailer stubs and the old wizard removed, finished plans in `docs/archive/`, ADR index, this map.
- **Quality**: reviews of backend/shared (fuzz tests, 11 fixes), forms UI (432 renders in twelve languages, axe
  clean), desktop/AI (50-task soak, installer smoke) and Sign (8 fixes), all in `docs/reviews/`; e2e 178/178,
  unit 7 778; security review in `docs/SECURITY-REVIEW-2026-10.md`.

**Published**: the AI pack is a public release, `ai-pack-qwen2.5-vl-7b-instruct-q4_k_m` (5 files, 6.89 GB, hashes
verified from GitHub's side); the app's Get button downloads tiers from Hugging Face, the pack opens from a folder.
**Not done**: the graphics card on macOS (Metal); SmolVLM2 tiers marked not-working-yet. SIMPLIFY 8 (one word per
step) is decided against until a native reader can check it; SIMPLIFY 9 is done (`recommendModel` by memory).
**Unverified**: macOS, 8-12 GB laptops, CPUs without AVX2, other graphics drivers, screen readers, native-speaker
quality (strings for a native read are listed in docs/reviews/2026-10-forms-ui.md).
Web bundle total is at its cap (1 249 of 1 250 KB): a new feature must cut elsewhere or raise the cap with a reason.

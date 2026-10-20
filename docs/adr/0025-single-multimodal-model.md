# ADR 0025 — One multimodal model for everything, run by a pinned llama-server, shipped as an AI pack

**Status:** accepted — the owner's decision of 2026-10-19. The migration is built; reading a page
from a picture (the page pipeline of `docs/plan/AI-SYSTEM.md` D4) and the pack's distribution are not.
**Date:** 2026-10-19
**Amends:** ADR 0023 (the model, the runtime and the settings), ADR 0024 (the registry holds one model; the
vision seam is filled), ADR 0016 (no utility process and no native Node module are left in the shell; the
desktop starts one ordinary child program), ADR 0015 (a runtime binary is pinned and licensed like a model)
**Supersedes:** the model choice of `docs/plan/AI-SYSTEM.md` section 5 (two models, routed by task) and its
D2 (a benchmark decides). The owner decided; the benchmark is the real-model suite below.

## Context

ADR 0023 shipped Qwen3-4B-Instruct-2507 for text through `node-llama-cpp`. ADR 0024 added a coordinator and
kept a seam for a second, vision, model that `node-llama-cpp` 3.22.1 cannot run (it has no projector or
image API). The owner then placed Qwen2.5-VL-7B-Instruct (Q4_K_M, with its f16 projector) on the disk and
decided: **one model for everything.** It reads scans, PDFs, Word files and pictures, and it writes
summaries, translations and email replies. The Qwen3-4B text model and the 3B vision files are removed on
purpose and are not shipped.

## Decision

### 1. One model

`qwen2.5-vl-7b-instruct-q4_k_m`, **Apache-2.0** (the base model's card, `Qwen/Qwen2.5-VL-7B-Instruct`; the
`ggml-org` GGUF repository carries the same tag, and unlike the 3B this is not a research licence). Two
files, hashed in `packages/shared/src/ai/models/qwen2.5-vl-7b-instruct-q4_k_m.json`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` | 4,683,072,032 | `9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392` |
| `mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf` | 1,354,162,912 | `c24a7f5fcfc68286f0a217023b6738e73bea4f11787a43e8238d4bb1b8604cde` |

Capabilities `text` and `vision`. About 6.04 GB together. A third file is an **optional** lighter projector,
`mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf` (853,119,712 bytes, SHA-256
`2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506`, role `projector-lite`): not part of the
required size or of "installed", hashed when present. The engine loads the f16 projector unless the person chose
`lite` (`LOPPA_AI_PROJECTOR`) or, on `auto`, free memory is under 11 GB; if only one exists it loads that one.

### 2. One runtime: llama.cpp's `llama-server`, as a child process

`node-llama-cpp` is gone from the desktop, with its worker, its utility process and its packaging scripts.
`apps/desktop/src/ai/engines/server-engine.ts` starts the pinned program from
`packages/shared/src/ai/runtimes/llama-server.json` (release **b11741**, MIT, 2026-10-19) and talks to it over
its OpenAI-style `/v1/chat/completions`, streamed:

- it listens on `127.0.0.1`, an ephemeral port, behind a bearer key made for the run; `--no-webui`,
  `--offline`, the in-memory prompt cache off, CPU only, one slot, flash attention on;
- threads are physical cores minus one, between 2 and 8 (as before); the context is 8,192 tokens and a picture
  may take at most 1,280 (`LOPPA_AI_CTX`, `LOPPA_AI_THREADS` until the Settings window has a place for them);
- `choose` (the passage picker) is a JSON schema in `response_format`, so the model cannot name a passage
  that is not there; cancel is an aborted request; `dispose` kills the process and waits for it, which is how
  memory comes back;
- the program is hashed file by file against the manifest (51 files, 50 MB) before it is started, once a
  session; a changed file is `damaged` and nothing in the folder runs;
- the pipeline is unchanged (`text/pipeline.ts`: prompts, chunking, the digit check, the loop guard, quoting).
  Only the engine under it changed. `FakeEngine` stays for CI.

Pinned for Windows x64 only as **verified** (downloaded, hashed, run by this project). Windows arm64, macOS
arm64/x64 and Linux x64/arm64 are pinned by the hashes the release page gives and marked **UNVERIFIED**: they
have not been run. `apps/desktop/scripts/fetch-runtime.ts` downloads, hashes, unpacks and checks it into
`local-models/runtime/` (Git-ignored); nothing is committed.

### 3. What is wrong on a computer, said plainly

| Case | Result |
| --- | --- |
| Under about 12 GB of memory in all (the test is 11.5 GB, because "12 GB" computers report 11.7 to 12.9) | `too-little-memory`, nothing started |
| Under about 10 GB free when asked | `too-little-memory` (the manifest's `requiredMemoryBytes`) |
| No `llama-server` on the computer | `cannot-start` |
| A processor without AVX2 (the program prints its features; checked on x64) | `cannot-start`, "this computer cannot run the on-device model", process ended |
| The program ends while loading | `cannot-start` with its last lines in the log; out of memory in them is `too-little-memory` |
| The program ends under a task | the task fails `cannot-start` and the coordinator drops the engine |

**Hardware minimum, honestly:** a 64-bit computer with AVX2, **12 GB of memory or more** (16 GB is
comfortable), about 6 GB of disk, no GPU needed. An **8 GB laptop will not run it**, and Loppa says so rather
than swap and freeze; the rest of Loppa (forms, scan, sign, send) does not need the model.

### 4. Size consequences: an AI pack beside the app, not inside the installer

The model files are 6.04 GB and the program 20 MB. An installer cannot carry that: NSIS tops out near 2 GB,
Apple notarisation at about 4 GB, and a GitHub release file may not exceed 2 GiB. So the model ships as a
separate **AI pack** placed in `ai-pack/` beside the app (`<resources>/ai-pack`), split into parts under
2 GiB with a SHA-256 each, joined and verified on the computer, and fully offline once placed. The manifest
already carries the parts (three for the weights, one for the projector, 1.5 GiB each at most) with
`unpublished:` addresses. **The pack's distribution workflow is not built here.** Until it is, the model is
opened from disk or found by `LOPPA_AI_DIR`, `local-models/` or the repository root in development
(`docs/plan/AI-SYSTEM.md` D7, plus `ai-pack/` and `<kind>/` folders). **Built since: section 7.**

### 5. Measured on this computer (2026-10-19)

32 GB of memory, 28 logical processors, Windows 11, `llama-server` b11741 CPU build, the owner's files.
`LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=<dir> pnpm exec vitest run --disableConsoleIntercept
apps/desktop/src/ai/server/server.real.test.ts` (opt-in; outside `pnpm verify`).

| Measure | Result |
| --- | --- |
| Load, model and projector (files already in the system cache) | 5.0 s |
| Free memory, before load / with the model loaded / 3 s after the process was killed | 11.5 / 2.0 / 11.8 GB |
| Peak working set of the process | 9.82 GB |
| Generation, 8 threads / 4 threads | 12.5 / 10.0 tokens a second |
| One invented invoice picture (820 x 760), 8 threads | 44.6 s: 829 prompt tokens in 19.4 s, 294 tokens out at 11.6 a second |
| The same page, 4 threads | 62.8 s: 833 prompt tokens in 30.1 s, 304 tokens out at 9.3 a second |
| Summary of an invented English / Swedish page (about 250 tokens) | 17.4 / 20.3 s |
| Translation of the Swedish page to English | 24.6 s |
| Email reply draft, Swedish | 12.3 s |
| Connections of the process that are not to this computer (`netstat -ano`) | none |
| Same two invented pages (invoice, form with checkboxes and small print), f16 vs Q8_0 projector, 8 threads | f16: 42.0 / 31.8 s, 12 of 12 expected strings on both, peak 9.82 GB. Q8_0: 41.4 / 31.8 s, 12 of 12 on both, peak 9.32 GB. Both read the checkboxes right; the Q8_0 page put the unticked box as `[]` |
| Memory after the process was killed | back to the starting level; kill took 0.6 s |

What the output showed (read by a person, not asserted): the page was read with its table, amounts and both
checkboxes, once with a misspelt word at 4 threads; the summaries kept every date and amount; the translation
left the title untranslated and the digit check flagged the dates it had reformatted (as designed); the reply
copied a note almost verbatim ("Fråga om det kostar något") instead of phrasing it. `estimateTokens` (the
chunker cannot wait for the server) was calibrated on the server's own `/tokenize` over the 36 corpus files and
lands between 1.01 and 1.61 times the real count: never low, so a cut text fits.

**Not measured:** an 8 GB or 12 GB computer (the minimums above are reasoning plus this machine's numbers,
UNVERIFIED); macOS and Linux (the archives are pinned, never run); a cold disk (the load time above had the
files cached); a processor without AVX2 (only the stand-in server, which prints such a line, was run); a
GPU; battery; a ten-page document through the real model; reading many pages (the page pipeline is not
built); more than two invented pages with the Q8_0 projector.

### 6. AI is optional and the model is a choice: a catalogue (2026-10-20)

Loppa works fully without any model. Nothing is fetched at start-up or on its own. The Summary
pane lists a catalogue of models, best first, each pinned in `packages/shared/src/ai/models/*.json`
(Zod, ADR 0021): source repository, revision, file URL `https://huggingface.co/<repo>/resolve/<revision>/<file>`,
size, SHA-256 (the LFS oid), licence, tier, a memory figure that says whether it was measured, and
whether it has been run (`support`: working, untested or not-working-yet, with the evidence). All are Apache-2.0
(Qwen2.5-VL-3B is left out: its base licence is the Qwen Research Licence).

| Tier | Model | Download | Memory (measured peak) | Run here |
| --- | --- | --- | --- | --- |
| Full | Qwen2.5-VL-7B-Instruct Q4_K_M + f16 projector (the owner's files) | 6.04 GB | 9.8 GB (section 5) | yes, section 5 |
| Balanced | Qwen3-VL-4B-Instruct Q4_K_M + Q8_0 projector | 2.95 GB | about 6 GB, estimate | no |
| Light | Qwen3-VL-2B-Instruct Q4_K_M + Q8_0 projector | 1.55 GB | 3.54 GB | yes: 12 of 12 strings of an invented invoice, 9.8 s a page, 5.7 s for a Swedish summary |
| Very light | SmolVLM2-2.2B-Instruct Q4_K_M + Q8_0 projector | 1.71 GB | about 3.5 GB, estimate | no |
| Very light | SmolVLM2-500M-Video-Instruct Q8_0 + Q8_0 projector | 0.55 GB | 0.94 GB | yes, and **not working yet**: 1 of 12 strings (it invents numbers), the summary repeats the source |
| Very light | SmolVLM2-256M-Video-Instruct Q4_K_M + Q8_0 projector | 0.24 GB | about 0.7 GB, estimate | no |

The runs were made with `scripts/model-bench.ts` (llama.cpp b11741, 8 threads, CPU, files fetched by
Loppa's own download manager). Qwen3-VL and SmolVLM2 need no flag beyond `--mmproj`; the server's built-in
chat template is used. Smaller models read and write worse; the list says so beside each.

- **One resident at a time.** The coordinator's lock is unchanged. The person's choice is kept in
  `selected.json` in the models folder; with none, the best installed model is used. The first-use
  suggestion ("Recommended for this computer") is the best tier whose memory fits the computer's total
  (with 15 per cent over) and free memory. It never downloads anything.
- **Download.** Only on a press, after a confirmation that names the host (huggingface.co), the files and the total
  size. The same three facts are sent as a consent object and must equal what the manifest would fetch,
  or nothing starts; each consent is appended to `consents.jsonl` (when, model, host, files, size, never a document).
  The download is resumable (`Range`), follows redirects by hand and only to `huggingface.co` and `hf.co` over https,
  hashes while streaming, checks the size, writes `<name>.partial` and renames it whole, deletes it on a mismatch,
  can be cancelled, reports speed and time left, and first checks that the disk has room (the files, less
  any part already fetched, and 256 MB).
- **Open from disk** stays for files obtained elsewhere. The owner's current files are the Full tier.
- **Not measured:** the Balanced, 2.2B and 256M rows, a cold disk, macOS and Linux.

### 7. Distribution, built and measured (2026-10-20)

- **Runtime in the package.** `scripts/build.ts` stages `ai-pack/` for every target (a README) and, for
  Windows x64 only (the one verified asset), `ai-pack/runtime/` with the CPU build and `RUNTIME.json`
  (the asset's hash list). `electron-builder.yml` copies it as an `extraResources` folder beside
  `app.asar`: plain files, found by the resolver as tier 4 (`resources/ai-pack/runtime`), hashed file by
  file before use. macOS and Linux get the folder without the program (their assets are UNVERIFIED);
  a Mac gets `llama-server` with the pack once it has been run there.
- **Packaged build, driven over CDP** (`Loppa.exe --remote-debugging-port`, `LOPPA_AI_DIR` at the owner's
  files, a throwaway Playwright script, deleted): status showed the model `installed`, files `env`, the
  runtime `ai-pack`, `verified`; a summary of an invented minutes text took 10.5 s and kept every date and
  amount; `read-page` of an invented invoice picture took 34 s and returned the heading, the table rows,
  the total, the due date and both checkboxes; `llama-server` listened on `127.0.0.1` only, and `netstat`
  showed no connection of Loppa or `llama-server` to anything but this computer.
  **The fuse worry is disproved:** `onlyLoadAppFromAsar` governs what Electron loads as code, not a child
  process started from `resources/`; `runAsNode: false` and `enableNodeCliInspectArguments: false` did not
  block `--remote-debugging-port` (a Chromium switch), which is how the build was driven. Memory
  came back after the idle kill (see the measurement below).
- **The pack.** `scripts/make-ai-pack.ts` cuts the files into parts of 1.5 GiB (below the 2 GiB asset
  limit; the default equals the manifest's parts, so the hashes already in the manifest are the pack's)
  and writes `PACK.json`; it says whether every file and part matches the manifest (it does: 6.89 GB,
  five files, 7 s). `scripts/join-ai-pack.ts` and the app's _Open a file from disk_ (choose `PACK.json`
  or a `.part1`) share `src/ai/pack.ts`: each part is checked as it is streamed into
  `<name>.joining` in Loppa's folder, the whole before the rename, and the pack folder is never
  changed. A finished file is skipped, so a retry resumes at the file that stopped. A missing part is
  `not-installed`, a wrong size or hash `damaged`; nothing that looks like a model is left behind.
  Fully offline. Joining the real pack took 6 s.
- **Download.** The same manifest drives _Get_, with the existing confirmation that names GitHub and the
  size (ADR 0026). `scripts/publish-ai-pack.ts` prints the release, the files, their sizes and the
  exact `gh` command and uploads nothing; `--yes` uploads, publishes and rewrites the part URLs. Not
  run: the upload is the owner's decision. The old `model-qwen3-4b-instruct-2507-q4km` release is
  obsolete and can be deleted. CI never fetches the pack (about 14 GB of runner disk).
- **NSIS.** The installer step failed in the agent's deep worktree because `makensis` could not open
  `allowOnlyOneInstallerInstance.nsh`: the file exists, its path is 267 characters, over the 260 limit
  NSIS 3.0.4 works under. The cause is the checkout's path, not the size of the package (555 MB unpacked,
  the pack is not in it). CI paths are short; the Desktop workflow builds the installer.

## Consequences

- Reading a picture of a page is wired (`vision/read-page.ts`, AI-SYSTEM D4); the server starts with
  `--image-max-tokens 2560` so a second pass at 2 million pixels is not downscaled. The Summary pane lists the one
  model, its two files and the runtime, the minimum memory, and the pack folder.
- `window.loppaModel` and the Summary pane keep working unchanged on the new engine; the download is off
  ("the AI pack has not been published yet") until the pack exists.
- `pnpm licence:check` still reads npm packages only; the model and the program are recorded in
  `THIRD-PARTY-NOTICES.md`. The program also ships LLVM OpenMP (Apache-2.0 with LLVM exceptions).
- The installer shrinks by the 53 MB `node-llama-cpp` runtime; the desktop has no native Node module again.
- A second `llama-server` must never run beside the first: the coordinator's single-resident lock is what
  keeps one process alive, and a process is killed before another model is loaded.

## Rejected alternatives

- **Two models (the plan's section 5).** Two files to place and verify, a model swap whenever the task changes
  from text to pictures, and two sets of behaviour to tune; the owner chose one.
- **Keep `node-llama-cpp` for text and add `llama-server` for pictures.** Two runtimes, two ways to release
  memory, the app's only native module kept for no gain.
- **Put the model in the installer.** Impossible at 6 GB (section 4).
- **A GPU build by default.** Unproven on other people's computers, and 169 to 351 MB more per backend.
  Amended 2026-10-20: the graphics card is an **optional setting**, off by default (the processor stays the
  default), see "The graphics card" below.

## The graphics card (amendment, 2026-10-20)

The pinned Vulkan build of the same release is offered as an optional setting, "Use the graphics card (faster,
optional)", in the model list. The processor build stays the default and the fall-back.

- **Off until chosen, and only where a build is pinned** (today Windows x64; macOS says "not available yet",
  Metal comes later). Turning it on without the program asks first, naming github.com, the file and its size
  (ADR 0026); the download goes through the same checked code as a model file and every one of its 52 files is
  hashed again. Offline: put the program in `runtime-vulkan` where the model files are looked for (the AI pack,
  `local-models/`, `LOPPA_AI_DIR`, Loppa's own folder). Only a folder of that name counts, so the processor
  program in a root or pack folder is never mistaken for it.
- **One card, the program fits the model.** Loppa takes the first device `llama-server --list-devices` names
  (it lists a separate card before the chip inside the processor) and passes `--device` and `-ngl auto`; the
  pinned build's own `--fit` (on by default) puts as many layers on the card as its free memory holds, keeping
  1 GB. A card with under 2 GB free (a game is using it) is left alone this time, without a failure.
- **Never a hard failure.** No device, a start that fails, running out of memory, a card that ends or fails on
  its first request: the processor program is started and the task is answered from it. The reason is
  remembered in `graphics.json` so a task does not try again, shown plainly in the list ("The graphics card
  could not be used; using the processor.") and cleared by one button. A first request that fails on the card is
  only blamed on it if the processor then answers it.
- **Same guarantees.** Loopback, a key made for the run, the allow-listed environment, `--offline`, no web page;
  the Vulkan program is hashed before it is started. One model resident at a time: ending the process gives the
  card's memory back; changing the setting ends a loaded model so it restarts the new way. The status says
  whether the model runs on the processor or the graphics card, and the card's name.

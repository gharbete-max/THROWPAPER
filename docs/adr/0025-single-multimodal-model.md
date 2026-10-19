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
(`docs/plan/AI-SYSTEM.md` D7, plus `ai-pack/` and `<kind>/` folders).

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

## Consequences

- Reading a picture of a page is possible with the model but **not wired**: `read-page` is still
  `not-available` in `ServerEngine.run` until the page pipeline (D4) lands. The Summary pane lists the one
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

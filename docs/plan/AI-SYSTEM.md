# One AI system for every Loppa — the plan

> **2026-10-19:** the owner decided on **one** model for everything, Qwen2.5-VL-7B-Instruct (Apache-2.0), run by
> a pinned `llama-server`; sections 1, 2 (D2) and 5 below describe the two-model plan it replaces. See ADR 0025
> for the decision, the measurements and the size consequences (an AI pack beside the app).

**Status:** accepted 2026-10-14. The owner left the model choice to the project's judgement and asked that neither model be ruled out: both stay, routed by task; the text model is the default for every text task, the vision model is used only to read pages; unification (D2) happens only if measured to be better. Phases 1 and 2 start together. Planning only: nothing in this file has been built.
Written after reading the owner's brief (a visual document reader, the text model, an email reply
helper, one coordinator) and checking the repository, the files the owner placed in it, the
installed runtime and the model cards. What was measured is marked; what was not is marked
**UNVERIFIED**.

## 1. What was checked

| Fact | Result |
| --- | --- |
| Files on this computer | `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf` (1,929,901,056 B) and `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf` (844,757,728 B), both in the repository root beside the text model. Both are valid GGUF and match the sizes on `ggml-org/Qwen2.5-VL-3B-Instruct-GGUF` to the byte. SHA-256: model `d02fe9b6…486c12`, projector `980c9b2f…9fb904` (full values in section 6). Git ignores `*.gguf`, so nothing is tracked. |
| Licence of that model | **Qwen RESEARCH LICENSE**, read from the `LICENSE` file of `Qwen/Qwen2.5-VL-3B-Instruct` (7,387 bytes). The `ggml-org` GGUF repository is tagged `apache-2.0`, which disagrees with the base model it was made from; the tag is not the authority, the base model's file is. A research licence fails ADR 0015 (permissive only) and cannot ship in a product. It is fine for the owner's own evaluation. `DOCUMENTS.md` already excluded Qwen2.5-3B for the same reason. |
| Licence-clean vision models | **`Qwen/Qwen3-VL-4B-Instruct`** and **`Qwen/Qwen3-VL-2B-Instruct`**, both Apache-2.0 on the model card, both with **official GGUF** files from Qwen: 4B is 2,497,281,664 B (Q4_K_M) + 453,974,304 B (projector, Q8_0); 2B is 1,107,409,952 B + 445,053,216 B. Newer than Qwen2.5-VL (Oct 2025). `ggml-org` has no Qwen3-VL GGUF repository. llama.cpp support for the `qwen3vl` architecture is implied by Qwen publishing GGUF but **UNVERIFIED** until run. |
| Runtime | The installed `node-llama-cpp` 3.22.1 has **no projector or image API**: its typings and addon sources contain no mmproj, mtmd, clip or image-input symbol. It can run the text model, and **cannot run any vision model**. |
| Existing pieces | `apps/desktop/src/model/` (service, worker, engines, weights download and verification, pipeline, fake engine), `packages/shared/src/summary/` (manifest, bridge, chunking, passages, languages, quoting), the Summary pane, the on-device OCR (Tesseract, twelve languages), the import's reading, the digital copy, the page renderer (pdfjs), Scan, Send, `window.loppaModel`. All reusable. |

## 2. Decisions

**D1. The vision runtime is a supervised `llama-server` child process, not `node-llama-cpp`.**
`llama-server` from llama.cpp (MIT) supports multimodal models with `--mmproj`, serves an
OpenAI-style chat API, and can constrain output to a JSON schema. The desktop shell starts it on
demand on `127.0.0.1` with an ephemeral port and a per-session bearer token, no web UI, and kills
it when the task and an idle timeout end. **Killing the process is how memory is released**: a
process exit frees RAM and VRAM deterministically, which unloading a model inside a long-lived
process does not promise. The binary is pinned by release tag and SHA-256 in a manifest, fetched
on request with the weights (about 20 to 60 MB per platform, UNVERIFIED), and never in the
installer. The text model stays on `node-llama-cpp`, which works and is verified; moving it to the
same server later would remove the app's only native module and is decided by the benchmark.

**D2. The vision model is chosen by a benchmark, with one licence rule.**
The shipped candidate is a Qwen3-VL (2B or 4B, Apache-2.0); Qwen2.5-VL-3B stays on the machine as
an **evaluation-only baseline**, marked "research licence, not distributable", and is excluded
from any release manifest. If Qwen3-VL-4B-Instruct's text quality matches Qwen3-4B-Instruct-2507
on the twelve languages, **one weights file can serve both vision and text** (the projector loads
only for pages), which saves 2.5 GB and every model swap. The coordinator below supports one model
or two; the benchmark decides, not preference.

**D3. One coordinator, neutral to the product.**
`packages/shared/src/ai/` holds the types every Loppa shares: model ids and capabilities
(`text`, `vision`, room for more), the task union, the `StructuredDocument` schema and the cache
key. `apps/desktop/src/ai/` holds the coordinator:
- a **registry** of models and runtimes (from manifests: id, kind, licence, size, hash, files, RAM
  estimate);
- a **single-resident lock**: at most one model process alive; a task for the other capability
  waits, the resident one is released first (vision, finish, kill, text, finish, kill);
- a **priority queue**, **cancellation** that reaches the engine, **progress** events, a free-memory
  check before starting, and idle unload;
- **engines** behind one interface: `NodeLlamaEngine` (text today), `ServerEngine` (vision, and
  text if D2 unifies), `FakeEngine` (CI and demos);
- a **download manager** generalised from `weights.ts` to N files plus the runtime binary: explicit
  consent, resumable, streaming SHA-256, split release parts;
- a **local result cache** in the user-data directory.
The renderer sees one generic bridge, `window.loppaAi` (`status`, `install`, `run(task)`, `cancel`,
`onEvent`). Docs, and later Spreadsheets, Presentations, image edit and video edit, **register task
kinds** (each names its capability) instead of shipping a runtime or a channel of their own. The
existing `window.loppaModel` becomes a thin adapter and is removed when its callers move.

**D4. Reading a document is a page pipeline that stores a structured result.**
1. Keep the original; fingerprint it (SHA-256) and read its metadata and page sizes.
2. Render pages in the renderer with pdfjs, one at a time, at a bounded pixel budget (start near
   1 million pixels; the model accepts a range, UNVERIFIED for speed).
3. Send each page to the vision model with a JSON schema; the reply is validated (Zod) into
   `StructuredDocument`: pages of blocks (heading, paragraph, table with cells, field with label
   and value, checkbox, figure with caption), each with a page number, a box, a language and a
   confidence.
4. Cross-check against the PDF's text layer and Tesseract where they exist. A large mismatch marks
   the page *uncertain* and offers a higher-resolution second pass for that page only. **Neither
   source silently overrides the other**, and a failed page is listed, never dropped.
5. Cache per page by `sha256(file) + page + pipelineVersion + modelId + render settings`. A repeat
   read, a summary and a question reuse it without touching an image again.
6. Stream each page as it finishes, so the first result does not wait for the document.
Vision never runs inside `packages/shared/src/{builder,interpret,import}`; the deterministic import
and the digital copy stay as they are and remain the offline default. The vision reader is an
optional second opinion for what they cannot read.

**D5. Text tasks consume the structured document.**
Summarise, ask a question, explain simply and translate flatten `StructuredDocument` in reading
order and use the existing chunking, prompts, loop guard, digit check and the quote-only rule. The
protected categories (contracts, consents, declarations, clinical forms) are recognised by the
existing rule-based word lists on the structured text and are quoted, never reworded or translated
(rule 8, ADR 0012). Questions answer with page references and say "not in the document" rather
than guess. Output is labelled generated, kept beside the document, never written into it.

**D6. The email reply helper is one more text task, inside Send.**
A compact panel in the existing compose step, not a chat: paste or select the incoming message,
choose language and tone (professional, friendly, concise, formal, firm), generate, then *shorter*,
*translate* or *revise*, then edit, insert or discard. The incoming text is untrusted: it is
passed as quoted data under a fixed system instruction, the model has **no tools**, so an
instruction inside a mail has nothing to act on, and the draft can name no attachment. Dates,
prices and commitments not present in the message or the user's own notes are replaced by marked
placeholders, and the digit check flags any number the draft invented. Sending stays an explicit
press with the existing confirmation. It needs only the text model; the vision model is not
required.

*Built (Phase 5).* Four text task kinds (`draft-reply`, `shorten-reply`, `translate-reply`,
`revise-reply`) in the shared task union, pure checks in `packages/shared/src/summary/reply.ts`,
prompts in `apps/desktop/src/ai/text/prompts.ts`, the panel in `apps/forms/src/screens/send/`. The
received message is stripped of hidden characters and angle brackets and placed between our own
tags; the shorten, translate and revise prompts never contain it. A message that trips the quote-only
word lists is not shown to the model at all: the draft is a neutral acknowledgement from a fixed
instruction. The digit check runs against the received message, the notes and the writer's own
instructions, never against the draft, so an invented number stays flagged through every later
version. Flags (invented numbers, an attachment named, the wrong language) are recomputed on the
draft as the person edits it. A small model still invents when it is allowed to answer a question
from nothing; the prompt for an empty-notes reply forbids answers and asks for `[answer?]`, and the
flags are the net under it.

**D7. Where files live.**
Resolution order for any model or runtime file: `LOPPA_AI_DIR` if set; `<repo>/local-models/<kind>/`
(Git-ignored, development only, not in a packaged app); the repository root as it stands now
(development only, so the owner's current layout works without moving anything); finally the
user-data directory, which is the only place a packaged app reads. Every file found is hashed once
against the manifest, or, for an evaluation entry with no pinned hash, recorded and labelled
unverified. Manually supplied files are treated exactly like downloaded ones. The vision files the
owner placed are accepted where they are. Nothing in these directories is ever copied into the
installer.

## 3. Phases (one branch each; plan mode first; every gate run singly)

| # | Phase | What | Exit |
| --- | --- | --- | --- |
| 0 | This plan | Owner reads it; ADR 0024 drafted from it | Merged, no code |
| 1 | **Spike V1: vision, measured** | Run a pinned `llama-server` on this machine with the owner's Qwen2.5-VL pair (baseline), then Qwen3-VL-2B and 4B Q4_K_M (new downloads, about 3.6 GB in all, plus the server binary) on a corpus of invented pages: native-text PDF, scan, table, form with checkboxes, multilingual (twelve), a degraded photo, a 50-page PDF. Measure load time, peak RAM/VRAM, time to first page, pages per minute at 4 and 8 CPU threads and on the GPU, memory after the process exits, offline behaviour, JSON validity, and text accuracy against ground truth. Also: does Qwen3-VL-4B match Qwen3-4B-2507 on text (D2)? | A measured table and a model choice, committed first |
| 2 | **Coordinator foundation** | `packages/shared/src/ai/`, `apps/desktop/src/ai/`, generic bridge, manifests for N models, single-resident lock, queue, cancellation, cache, generalised download manager; the text path moves onto it unchanged in behaviour; fake engine; a model-status panel (installed, missing, damaged, busy) | The Summary pane works as before on the new service; lock and release tests; no feature regresses |
| 3 | **Vision engine and page pipeline** | `ServerEngine`, runtime manifest and download, the pipeline of D4, `StructuredDocument`, cache, a clear "install the vision model" state when files are absent, a "Read with AI" action on a PDF or scan in Scan, a side-by-side result with uncertain pages marked | Fake-engine CI tests; real-model opt-in suite; failed pages listed |
| 4 | **Questions, explanations, translation over the structure** | D5 | Page-referenced answers; protected categories quoted |
| 5 | **Email reply helper** | D6 | Prompt-injection tests; never sends; placeholders |
| 6 | **Hardening and documents** | `pnpm bench:ai` (opt-in, outside `pnpm verify`) writing `docs/plan/AI-BENCH.md`; ADR 0024 (the coordinator and the vision runtime) amending 0012, 0015, 0016 and 0023; the licence check for weights and for the server binary; a packaged-app smoke test on Windows and, if reachable, macOS | Measured numbers, no fabricated ones |

Phase 1 comes first because three things below it depend on its answers: the runtime works at all,
which model, and how long a page takes on a laptop CPU.

## 4. What it costs and what can go wrong

- **Disk:** vision about 1.5 to 3 GB plus a 0.45 GB projector, text 2.5 GB, a server binary of tens
  of MB; all downloaded on request, none in the installer (the installer stays about 211 MB).
- **RAM:** one model at a time, so the peak is the larger one plus context and image tokens: the
  text model measured 3.2 GB; the vision peak is **UNVERIFIED** and is the main thing Phase 1 settles
  for an 8 GB laptop.
- **Speed:** a vision model on a laptop CPU may take tens of seconds per page (**UNVERIFIED**); the
  pipeline therefore streams pages, caches them and keeps the deterministic readers as the fast
  default.
- **Security:** the server binds to loopback only, with a bearer token, no web UI, no network
  egress, killed after use; its release hash is pinned; generated text is untrusted; no telemetry,
  no cloud fallback.
- **Licences:** weights are checked separately from the runtime. The only blocker found is
  Qwen2.5-VL-3B's research licence, which D2 routes around.
- **Bundle:** the UI is a lazy chunk; the budget is 1,250 KB and the total stands near 1,135 KB.

## 5. What the owner needs to decide

Defaults are taken so work can continue; each can be overturned.

1. **Vision model:** default is to benchmark Qwen3-VL-2B and 4B and drop Qwen2.5-VL-3B from the
   product on licence grounds, keeping it only as the evaluation baseline. This needs about 3.6 GB
   of new downloads in Phase 1.
2. **Runtime:** default is `llama-server` for vision (D1), `node-llama-cpp` kept for text.
3. **One file or two:** default is two (the text model for text, a vision model for pages); whether Qwen3-VL-4B could replace the text model too is measured, and adopted only if it is at least as good.
4. **Where files live:** default is to accept the repository root as it is (D7).

## 6. Hashes of the files placed in the repository

- `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`: `d02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12`
- `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`: `980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904`
- `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`: `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`

# ADR 0024 — One AI coordinator for every Loppa: models as manifests, one resident at a time

**Status:** proposed. Phase 2 of `docs/plan/AI-SYSTEM.md` (the coordinator foundation) is built under it; the vision
runtime (D1, D2, D4) is not, and is decided by the Phase 1 spike. This ADR is edited, not superseded, when that
lands.
**Date:** 2026-10-14
**Amended 2026-10-19 by ADR 0025:** the registry holds one model (`qwen2.5-vl-7b-instruct-q4_k_m`, text and
vision); `ServerEngine` is built (a supervised `llama-server`) and `NodeLlamaEngine` is removed; a status carries
the runtime beside the models; a file source `ai-pack` is added. The vision page pipeline is still to come.
**Amends:** ADR 0023 (the one model becomes a registry of models; `window.loppaModel` becomes an adapter),
ADR 0016 (the shell hosts a coordinator, not a single model service; a second native-process kind is planned),
ADR 0015 (permissive licences also for any model that ships; a research licence is allowed on the owner's disk and
nowhere else), ADR 0012 (generated text from any model, text or vision, is generated wording)
**Evidence:** `docs/plan/AI-SYSTEM.md` (D1, D3, D7), `docs/plan/SUMMARY-SPIKE.md`

## Context

ADR 0023 built one model service for one model for one pane. Docs will read pages with a vision model;
Spreadsheets, Presentations, image editing and video editing will each want a model too. Each of them shipping a
runtime, a download button, a memory check, an idle timer and an IPC channel of its own would give a laptop with
8 GB of RAM several models in memory at once and several places that decide whether a file is the right one.

The owner's files show the same pressure from the other side: a vision model and its projector placed beside the
text model in the repository root, under a research licence that fails ADR 0015 but is fine to evaluate.

## Decision

### 1. One coordinator, neutral to the product (plan D3)

`packages/shared/src/ai/` holds what every Loppa shares and no more: `Capability` (`text`, `vision`, room for
more), the **model manifest** and its registry, the `AiTask` union (each kind names one capability), the
`StructuredDocument` schema, the cache key, and the types of `window.loppaAi`. `apps/desktop/src/ai/` holds the
**coordinator**:

- a **registry** of models (manifests) and, separately, of **engines** (a factory per model id). A model with no
  engine is known and is reported "not available yet"; nothing pretends. The vision model has none until Phase 3.
- a **single-resident lock**: at most one engine is alive. Tasks run one at a time, highest priority first and
  oldest first among equals. A task for a model other than the loaded one waits its turn, the loaded engine is
  **disposed first**, and only then is the next created. The slot's history is observable as transitions
  (`loading`, `loaded`, `start`, `end`, `released` with a reason) so the rule is tested, not asserted.
- **cancellation that reaches the engine** (an `AbortSignal` into `run`; the text engine posts a cancel to its
  process, which stops at the next token), **progress** events, a **free-memory check** against the manifest's
  `requiredMemoryBytes` before loading (re-checked after a swap releases the old model), and **idle unload**
  (ten minutes after the last task).
- an **`Engine`** interface (`load`, `run(task, onEvent, signal)`, `dispose`) with `NodeLlamaEngine` (the text path
  of ADR 0023, moved, same behaviour: a utility process around `node-llama-cpp`, ended to give memory back),
  `FakeEngine` (CI and demos; runs the real pipeline over a fake language model) and an empty, documented
  `ServerEngine` seam for the supervised `llama-server` of plan D1.
- a **local result cache** in the user-data directory: JSON, keyed by `cacheKey()` =
  `sha256(file) + page + pipelineVersion + modelId + settings`, capped in bytes with least-recently-used eviction,
  clearable by the person.

The renderer sees one generic bridge, `window.loppaAi` (`status`, `install`, `openFromDisk`, `remove`, `run`,
`cancel`, `onEvent`, `clearCache`). A product registers task kinds instead of shipping a runtime or a channel.
`window.loppaModel` is kept as a **thin adapter** over the same coordinator so the Summary pane and its tests are
untouched; it is removed when its callers have moved.

### 2. Manifests describe models, not files (generalising ADR 0023 §3)

A manifest has an id, one or more capabilities, a `kind` (the folder name), a licence with its URL,
`distributable`, `evaluationOnly`, `requiredMemoryBytes`, and **files**: each with a role (`weights`, `projector`,
`runtime`), its size, its SHA-256, optional aliases (the upstream file name) and **parts** (the release assets it is
published in; joined and hashed on this computer). Rules, enforced by the schema: a released model hashes every
file; an evaluation-only model is never distributable, has no download addresses and may leave a file unhashed; part
sizes add up.

**Evaluation-only** exists for models whose licence does not allow shipping them (Qwen2.5-VL-3B, Qwen Research
Licence). Such an entry is accepted where the owner put it, labelled `unverified-licence`, **never offered for
download**, and excluded from any release. `licence:check` still guards every distributable manifest.

### 3. Where files are found (plan D7)

First match wins, per file, under every name the file goes by:

1. `LOPPA_AI_DIR` (any build);
2. `<repo>/local-models/<kind>/` (Git-ignored; unpackaged builds only);
3. the repository root as the owner's files lie today (unpackaged builds only);
4. a location the person gave with "open from disk", then Loppa's folder in the user-data directory (the only
   places a packaged app reads).

Every file found is hashed against its manifest once per session (cached by path, size and modification time), and
manually supplied files are treated exactly like downloaded ones. Nothing in these directories is ever copied into
the installer.

### 4. Downloads (generalising ADR 0023 §3)

N files per model, each with its parts; resumable (a cut-off part is kept and continued with a `Range` request,
the server answering 200 is taken to have started over); streaming SHA-256; **explicit consent**: `install`
without `consent: true` does nothing, and the pane confirms the size and that no document is sent first
(CLAUDE.md rule 7). Evaluation-only and unpublished models answer `download-unavailable`.

### 5. The model list in the pane

A list in the Summary pane's settings step, from the shell's status alone: installed, not installed, damaged, in
use, or for evaluation only; size and licence; where each file was found and whether it was checked; the actions to
get a model or open a file from disk; the exact folder to add files by hand; and the cache with a button to clear
it. A model with no engine reads "not available yet" and offers nothing.

## Consequences

- Adding a model is a manifest and, if it needs a new runtime, an engine; adding a product is a task kind. Neither
  touches the lock, the queue, the memory check or the download manager.
- `apps/desktop/src/model/` is gone: `ai/` (coordinator, download, resolve, cache, IPC, preload, shell, engines)
  and `ai/text/` (the pipeline, prompts, worker, `node-llama-cpp` wrapper, the fake language model). The packaged
  files keep their names (`model-preload.cjs`, `model/worker.mjs`), so `electron-builder.yml` is unchanged.
- The bridge refuses a `read-page` task with `not-available`: the type exists so Phase 3 has a place to land.
- `window.loppaModel` still refuses a second job with `busy` where the coordinator would queue it, which keeps the
  pane's behaviour exactly as it was.
- The locations the person gave are now kept per file in `locations.json` in the models folder (they were a single
  path in `location.json`); a path remembered by an earlier build is asked for once more.

## Not decided here

The vision runtime and model (plan D1, D2), the page pipeline and its `StructuredDocument` producers (D4), questions
and translation over the structure (D5), the reply helper (D6), and a runtime binary's manifest entry. The
`runtime` file role and the `ServerEngine` seam are in place so they need no change to the coordinator.

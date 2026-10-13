# ADR 0023 — A local summary and translation model: one model, on the desktop, downloaded once

**Status:** accepted — the owner chose the model on 2026-10-13; this ADR records what spike S1 measured
and what follows from it. Built in Documents phase 8 ("As built" below)
**Date:** 2026-10-13
**Supersedes:** ADR 0013 (AI assistance: provider-agnostic, EU by default, opt-in, drafts only)
**Amends:** ADR 0016 (an "On this computer" mode, a native module, a model file), ADR 0015 (licences for
model weights), ADR 0012 (a machine translation of operative wording is generated wording)
**Evidence:** `docs/plan/SUMMARY-SPIKE.md` and `docs/plan/spike-s1/`

## Context

`DOCUMENTS.md` §4 puts a summary and a translation in the centre of the Documents room, in all twelve of
Loppa's languages. ADR 0013 proposed a hosted `AiProvider` with a region, a sub-processor and a privacy-page
change. The owner has since chosen a different shape: **one model only, on the desktop only, on the
person's own computer, offline, downloaded once on request and never inside the installer.** Nothing about
the document leaves the machine, so the "no transfers" answer on the privacy page stays true.

Spike S1 ran that model, Qwen3-4B-Instruct-2507 at Q4_K_M, on a desktop CPU:
- it fits in about 3.2 GB of RAM and loads in about 2 s;
- it reads and summarises ten of twelve languages acceptably, with Icelandic and Russian borderline;
- **it cannot write Icelandic**, and every translation had at least slight meaning errors;
- one page takes about 35 s to summarise on four fast cores, and ten pages 3.5–6 minutes;
- it never invented a number in a summary, but it does drift on names and reformat dates.

No native speaker rated anything. A real 8 GB laptop and a Mac were not measured.

## Decision (proposed)

### 1. One model, one runtime

- **Model:** Qwen3-4B-Instruct-2507, Q4_K_M, non-thinking, **Apache-2.0** (model card
  `Qwen/Qwen3-4B-Instruct-2507`, `license: apache-2.0`; the Unsloth GGUF repo and the GGUF header say the
  same). The smaller Qwen3 sizes, DeepSeek-R1-Distill and every other model are not carried. Qwen2.5-3B
  and 72B and models under the DeepSeek or Llama licences are excluded by licence.
- **Runtime:** `node-llama-cpp` (MIT) in an Electron `utilityProcess`, CPU only. Not `@wllama/wllama`
  (its 4 GiB wasm ceiling leaves no room for this model and context; not run, so reasoned). Not
  transformers.js or WebLLM (`DOCUMENTS.md` §4).
- **Load options:** `gpu: false`, `build: "never"`. The app never compiles anything on the user's machine.
- **Desktop only.** The hosted edition never registers the route, and the web build carries no model code.

### 2. Consequences for ADR 0016 and the packaging

- It is the app's **first native module.** The "No native modules" note in `electron-builder.yml` goes;
  `npmRebuild: false` stays (N-API prebuilts, to be proved in the packaged smoke test).
- `asarUnpack` gains `node-llama-cpp` and the platform package (`@node-llama-cpp/win-x64`,
  `mac-arm64-metal`, `mac-x64`). The CUDA, CUDA-extension and Vulkan packages (169, 351 and 71 MB) and the
  35 MB `llama/` source bundle stay out of the installer. Expected addition: about 30 MB on Windows.
- The shell hands the process to Forms the way it hands over Sign. `eslint.config.js`'s desktop entry list
  gains the entry, and ADR 0016's fuse note "nothing in the app forks a Node process" is re-proved for
  `utilityProcess` with `runAsNode: false`.
- ADR 0016's AI section (Off / Online / Cloud) gains **"On this computer"**, which is the only mode that
  does anything until a hosted mode is decided separately. Online and Cloud remain placeholders.

### 3. The model file is data with a manifest (ADR 0021, ADR 0015)

`licence:check` sees npm packages only. A JSON weights manifest, Zod-validated, with sorted keys and
provenance as fields, is held by a test:

```json
{
  "bytes": 2497281120,
  "id": "qwen3-4b-instruct-2507-q4_k_m",
  "licence": "Apache-2.0",
  "licenceUrl": "https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/LICENSE",
  "parts": [
    {
      "bytes": 1248640560,
      "name": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf.part1",
      "sha256": "03377c7b7cdc673232fc6fa7455a5d06e9f9abf7f88840e43ac1273a167ff67c",
      "url": "to be filled when the release is cut"
    },
    {
      "bytes": 1248640560,
      "name": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf.part2",
      "sha256": "4b589d9775c55bb47df28d73b480e06d7d80a4b0f27d3672f15ef078b14b7a38",
      "url": "to be filled when the release is cut"
    }
  ],
  "retrievedAt": "2026-10-13",
  "sha256": "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
  "source": "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  "sourceRevision": "to be pinned to a commit before release"
}
```

The part hashes above were computed on the retrieved file at its exact midpoint (the sketch of the schema;
the real file is the manifest the test holds).

- **Delivery.** 2,497,281,120 bytes is 2.33 GiB, above GitHub's 2 GiB release-asset limit. The model is
  published as **two parts of 1,248,640,560 bytes** on a Loppa GitHub release, each with its own hash,
  plus the joined file's hash.
- **Download.** Only on the person's request, with the size and a plain statement that the document never
  leaves the computer. Or the person opens a file from disk. Never in the installer.
- **Check.** Each part is verified as it arrives and the joined file against the manifest's `sha256`
  **before every first use**; a mismatch deletes nothing and refuses to load, with the reason.
- **Nothing to update silently.** A new model is a new manifest, a new ADR note and a new spike.

### 4. What it may and may not do

This restates `DOCUMENTS.md` §4, now binding:
- It may write a **draft** summary or translation of the person's own open document, **shown beside the
  original, labelled as generated** (a translation as machine translation), and **not stored**.
- It may not write into, or attach itself to, a document, form, envelope or message; feed a builder or an
  import decision; live in `packages/shared/src/{builder,interpret,import}`; make a network call; or write
  legal, clinical, tax or safety-critical wording (CLAUDE.md rule 8, ADR 0012).
- **Contracts, consents, declarations and clinical forms are quoted, never reworded or translated.** The
  model only selects passage numbers under a JSON-schema grammar; the app validates them and quotes the
  original bytes. Spike S1: 30 of 30 runs valid, byte-identical, injected passage never chosen. Which
  documents are such documents is decided by rule-based word lists with fixtures, never by the model.
- Every output gets a **digit check** against its source (the model reformats dates and once invented a
  year), and a **loop guard** (stop on a repeated run; cap output at 1.5 times the input).

### 5. Languages

A language passes when S1's mechanical checks hold and nothing wrong is found in what is read. A language
that fails offers no output in it, and says why.

| Language | Summarise a document in it | Write a summary in it | Translate into it |
| --- | --- | --- | --- |
| da, de, en, es, fi, fr, ja, nb, sv, zh | yes | yes | draft only |
| ru | yes | yes, with a warning that names can change | draft only |
| is | yes | **no** until a native speaker has read a sample | **no** |

Every translation is a draft. The pane is not switched on for a language before a native reader of it has
rated a sample.

### 6. Where the settings live

A new Forms screen in twelve catalogues (Forms has no settings screen today): download, remove, open from
disk, status, the size and "this stays on this computer". The desktop panel's AI section points at it.

## Consequences

- **ADR 0013 is superseded.** What carries over: drafts only, labelled as generated, never sent onward
  automatically, refusals before the model runs. What goes: the provider interface, the region and
  sub-processor machinery, the opt-in per organisation, the log rows and the privacy-page change. If a
  hosted model is ever wanted, it needs a new ADR.
- `CLAUDE.md`'s "no AI" non-negotiable, `docs/plan/BRIEF.md` and `PREDICTIVE-BUILDER.md` ("No AI is
  involved anywhere") gain their scope: the builder and the import stay deterministic; the Documents
  centre's summary and translation are the one exception, and only here.
- **CAVEATS #43 is test-first:** `bundle-split.test.ts` forbids `fetch` in anything that holds a reading.
  Sending a reading's text to the loopback runtime changes that row and its test first.
- **Memory.** About 3.2 GB while loaded (3.8 GB at 8,192 context). The app checks free memory before
  loading, releases the model after an idle period, and says plainly when the computer is too small.
- **Time.** About 35 s per page on four fast cores (best case; a laptop is slower). The plan's "20–45 s
  for two pages" is optimistic and is corrected. Progress, cancel and an expected time are required.
- **Quality.** The summary is a digest, not a record: long documents are summarised one bullet per part,
  and the pane says so.
- **Unmeasured:** a real 8 GB laptop, a Mac, a cold disk, the packaged app, native-speaker quality. Phase
  8's smoke test and a native-reader pass close these before anything ships.

## Rejected alternatives

- **A hosted model (ADR 0013).** Rejected by the owner's choice: it makes a provider the first third party
  to receive customer content and changes the privacy page's transfer answer.
- **A smaller or second model.** Rejected by the owner: one model, the slower and more accurate one.
- **`@wllama/wllama` in the window.** No native module, but the model plus context does not fit a 4 GiB
  wasm memory with room to spare. Reasoned, not measured.
- **Shipping the model in the installer.** It is 2.5 GB against a 211.5 MB installer, and most people
  will never open the centre.
- **Translating contracts and declarations "carefully".** ADR 0012 counts it as generated legal wording.
- **Letting the model quote.** A paraphrase of a consent is a different consent. The model selects; the
  app quotes.
## As built (phase 8, 2026-10-13)

- **Manifest** `packages/shared/src/summary/weights/*.json`, Zod in `packages/shared/src/summary/manifest.ts`,
  held by a test; the two part URLs and the source revision are marked `unpublished:` / `unpinned:` until
  the release is cut, and the download is off with that reason until then. "Open from disk" works now.
- **Pipeline** `apps/desktop/src/model/pipeline.ts` (settings and prompts from the spike), engine seam
  `engine.ts`, real engine `llama-engine.ts`, in-memory `fake-engine.ts` for CI and e2e, worker `worker.ts`,
  main-side `service.ts` (verify before first use each session, free-memory check, idle release, cancel).
  Streaming SHA-256 and the two-part download are in `weights.ts`.
- **Quoting.** `packages/shared/src/import/quoted/` recognises contracts, consents, declarations and clinical
  forms by word lists in twelve languages (two different terms needed; errs towards quoting). The pipeline
  refuses to reword or translate such text even if the window asks. `summary/passages.ts` selects and quotes by
  offset. `summary-boundary.test.ts` keeps the model out of `builder`, `interpret` and `import`.
- **Pane** `apps/forms/src/screens/Summary.tsx` at `/summary`, a lazy chunk, linked from the room's centre only
  where `window.loppaModel` exists. Sources: pasted text, a PDF (existing pdf.js and OCR paths) or text file, a
  form's questions, a filled form's answers. Words in twelve catalogues.
- **Changed from the proposal:** the bridge is an IPC in a preload and not an HTTP route (no `fetch`);
  the runtime ships as an extra resource and not through `asarUnpack`.
- **Measured on the real file** (this computer, CPU, 8 threads): verify 1.7 s, load 2.2 s, 3.3 GB resident,
  one page 20–25 s, ten pages 142 s, one-page translation 39 s. The spike's numbers hold in the app's pipeline.
  Still unmeasured: a real 8 GB laptop, a Mac, a packaged build, native-speaker quality.
- **Found:** the reduce step's token cap cut the ten-page summary mid-sentence; it now scales with the parts.

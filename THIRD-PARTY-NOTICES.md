# Third-party notices

Loppa is proprietary (`LICENSE`, `docs/adr/0015-reusing-open-source.md`). This file lists code
**copied into** this repository from other projects, with the licence it came under. Dependencies
installed from npm are not listed here; their licences travel with the packages.

Only permissive licences (MIT, BSD, ISC, Apache-2.0) are accepted. Nothing is ever copied from a
GPL or AGPL project, not even a snippet.

For each entry: the project and its URL, the licence, the exact commit or version copied from, the
files in this repository that contain the code, and whether it was modified. Keep the original
copyright line in each copied file's header, and carry an Apache-2.0 project's `NOTICE` text here
in full.

| Project | Licence | Copied from | Into | Modified |
| ------- | ------- | ----------- | ---- | -------- |

| Noto Sans JP, Noto Sans SC (Google; <https://github.com/notofonts>) | SIL OFL 1.1 | `@fontsource/noto-sans-jp` and `-sc` 5.3.1, the "japanese" and "chinese-simplified" subsets, weight 400, woff | `apps/api-forms/assets/fonts/` (licence text beside them in `OFL.txt`) | No. Embedded into a PDF as a subset of the glyphs used, never whole (`apps/api-forms/src/pdf/text-fonts.ts`). |

## Model weights (not in this repository)

The summary and translation model is **never copied into this repository or the installer**
(`*.gguf` is ignored). It is downloaded on the person's request, or opened from disk, and checked
against `packages/shared/src/ai/models/qwen3-4b-instruct-2507-q4_k_m.json`
(ADR 0023, ADR 0015). Recorded here so the licence has a home that `licence:check` does not read.

| Model                                                                                    | Licence                                                                             | Source                                                                             | SHA-256                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `qwen3-4b-instruct-2507-q4_k_m` (Qwen3-4B-Instruct-2507, Q4_K_M quantisation by Unsloth) | Apache-2.0 (<https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/LICENSE>) | <https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF>, retrieved 2026-10-13 | `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597` |

The runtime, `node-llama-cpp` (MIT) and llama.cpp inside it (MIT), is an npm dependency and is
checked by `licence:check` like the rest.

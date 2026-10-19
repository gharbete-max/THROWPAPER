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

## Model weights and runtime (not in this repository)

The one model Loppa runs, and the program that runs it, are **never copied into this repository or
the installer** (`*.gguf` is ignored; `local-models/` is ignored). They come as a separate AI pack
placed beside the app, or are opened from disk, and are checked against
`packages/shared/src/ai/models/qwen2.5-vl-7b-instruct-q4_k_m.json` and
`packages/shared/src/ai/runtimes/llama-server.json` (ADR 0025, ADR 0015). Recorded here so the
licences have a home that `licence:check` does not read.

| File                                                                   | Licence                                                                            | Source                                                                              | SHA-256                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` (Qwen2.5-VL-7B-Instruct, Q4_K_M)  | Apache-2.0 (base model card, <https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct>) | <https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF>, retrieved 2026-10-19 | `9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392` |
| `mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf` (its vision projector)        | Apache-2.0 (same)                                                                  | same                                                                                | `c24a7f5fcfc68286f0a217023b6738e73bea4f11787a43e8238d4bb1b8604cde` |
| `mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf` (optional lighter projector) | Apache-2.0 (same)                                                                  | same                                                                                | `2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506` |
| `llama-b11741-bin-win-cpu-x64.zip` (llama.cpp `llama-server`)          | MIT (<https://github.com/ggml-org/llama.cpp/blob/master/LICENSE>)                  | <https://github.com/ggml-org/llama.cpp/releases/tag/b11741>, retrieved 2026-10-19   | `2f86ad2fb6e118aedf3b319c554a6ba14bc6888b2d0ff9135e81fb0201da807e` |

The program is a separate process, not a library linked into Loppa; it also carries LLVM OpenMP
(`libomp.dll`, Apache-2.0 with LLVM exceptions; its licence file ships beside it). The other
platforms' archives are pinned in the runtime manifest and marked UNVERIFIED there.

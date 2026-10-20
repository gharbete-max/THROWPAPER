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

| Four photographs (Wikimedia Commons; sources in `docs/brand/MEDIA.md`): A_Different_Perspective (Pixabay), Andrey Larin (Unsplash), Clara.Hoke, Cbaile19 | CC0 1.0 (no attribution required) | Wikimedia Commons, retrieved 2026-10-20 | `apps/forms/public/media/` | Yes: cropped, greyscale, resized, WebP. |
| Noto Sans JP, Noto Sans SC (Google; <https://github.com/notofonts>) | SIL OFL 1.1 | `@fontsource/noto-sans-jp` and `-sc` 5.3.1, the "japanese" and "chinese-simplified" subsets, weight 400, woff | `apps/api-forms/assets/fonts/` (licence text beside them in `OFL.txt`) | No. Embedded into a PDF as a subset of the glyphs used, never whole (`apps/api-forms/src/pdf/text-fonts.ts`). |

## Model weights and runtime (not in this repository)

The models Loppa can run (a catalogue of six, ADR 0025; AI is optional and a person downloads one on a press, from Hugging Face), and the program that runs them, are **never copied into this repository or
the installer** (`*.gguf` is ignored; `local-models/` is ignored). They come as a separate AI pack
placed beside the app, or are downloaded on a confirmed press, or opened from disk, and are checked against
`packages/shared/src/ai/models/*.json` and
`packages/shared/src/ai/runtimes/llama-server.json` (ADR 0025, ADR 0015). Recorded here so the
licences have a home that `licence:check` does not read.

Model ids: `qwen2.5-vl-7b-instruct-q4_k_m`, `qwen3-vl-2b-instruct-q4_k_m`, `qwen3-vl-4b-instruct-q4_k_m`, `smolvlm2-2.2b-instruct-q4_k_m`, `smolvlm2-256m-video-instruct-q4_k_m`, `smolvlm2-500m-video-instruct-q8_0`.

| File                                                                                                      | Licence                                                                            | Source                                                                                                        | SHA-256                                                            |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` (Qwen2.5-VL-7B-Instruct, Q4_K_M)                                     | Apache-2.0 (base model card, <https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct>) | <https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF>, retrieved 2026-10-19                           | `9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392` |
| `mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf` (its vision projector)                                           | Apache-2.0 (same)                                                                  | same                                                                                                          | `c24a7f5fcfc68286f0a217023b6738e73bea4f11787a43e8238d4bb1b8604cde` |
| `mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf` (optional lighter projector)                                    | Apache-2.0 (same)                                                                  | same                                                                                                          | `2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506` |
| `Qwen3VL-2B-Instruct-Q4_K_M.gguf` (Qwen3-VL-2B-Instruct (Q4_K_M))                                         | Apache-2.0 (<https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct>)                    | <https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF>, revision `52d6c8f`, retrieved 2026-10-20             | `089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae` |
| `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf` (Qwen3-VL-2B-Instruct (Q4_K_M), vision projector)                  | Apache-2.0 (<https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct>)                    | <https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF>, revision `52d6c8f`, retrieved 2026-10-20             | `f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82` |
| `Qwen3VL-4B-Instruct-Q4_K_M.gguf` (Qwen3-VL-4B-Instruct (Q4_K_M))                                         | Apache-2.0 (<https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct>)                    | <https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF>, revision `1cd86af`, retrieved 2026-10-20             | `66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a` |
| `mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf` (Qwen3-VL-4B-Instruct (Q4_K_M), vision projector)                  | Apache-2.0 (<https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct>)                    | <https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF>, revision `1cd86af`, retrieved 2026-10-20             | `30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d` |
| `SmolVLM2-2.2B-Instruct-Q4_K_M.gguf` (SmolVLM2-2.2B-Instruct (Q4_K_M))                                    | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct>)         | <https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF>, revision `1bc3c9f`, retrieved 2026-10-20       | `0cf76814555b8665149075b74ab6b5c1d428ea1d3d01c1918c12012e8d7c9f58` |
| `mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf` (SmolVLM2-2.2B-Instruct (Q4_K_M), vision projector)             | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct>)         | <https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF>, revision `1bc3c9f`, retrieved 2026-10-20       | `ae07ea1facd07dd3230c4483b63e8cda96c6944ad2481f33d531f79e892dd024` |
| `SmolVLM2-256M-Video-Instruct-Q4_K_M.gguf` (SmolVLM2-256M-Video-Instruct (Q4_K_M))                        | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct>)   | <https://huggingface.co/ggml-org/SmolVLM2-256M-Video-Instruct-GGUF>, revision `a838311`, retrieved 2026-10-20 | `1d86050bd8ef9b4404ba682dcbf0f37a3144070c32e8825402c0b99a8e89f48e` |
| `mmproj-SmolVLM2-256M-Video-Instruct-Q8_0.gguf` (SmolVLM2-256M-Video-Instruct (Q4_K_M), vision projector) | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct>)   | <https://huggingface.co/ggml-org/SmolVLM2-256M-Video-Instruct-GGUF>, revision `a838311`, retrieved 2026-10-20 | `05d5751132244a6ebd64cba9b34898c0d874b2cb78159d758e1d4da3aad91581` |
| `SmolVLM2-500M-Video-Instruct-Q8_0.gguf` (SmolVLM2-500M-Video-Instruct (Q8_0))                            | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct>)   | <https://huggingface.co/ggml-org/SmolVLM2-500M-Video-Instruct-GGUF>, revision `ccd7aae`, retrieved 2026-10-20 | `6f67b8036b2469fcd71728702720c6b51aebd759b78137a8120733b4d66438bc` |
| `mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf` (SmolVLM2-500M-Video-Instruct (Q8_0), vision projector)   | Apache-2.0 (<https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct>)   | <https://huggingface.co/ggml-org/SmolVLM2-500M-Video-Instruct-GGUF>, revision `ccd7aae`, retrieved 2026-10-20 | `921dc7e259f308e5b027111fa185efcbf33db13f6e35749ddf7f5cdb60ef520b` |
| `llama-b11741-bin-win-cpu-x64.zip` (llama.cpp `llama-server`)                                             | MIT (<https://github.com/ggml-org/llama.cpp/blob/master/LICENSE>)                  | <https://github.com/ggml-org/llama.cpp/releases/tag/b11741>, retrieved 2026-10-19                             | `2f86ad2fb6e118aedf3b319c554a6ba14bc6888b2d0ff9135e81fb0201da807e` |

The program is a separate process, not a library linked into Loppa; it also carries LLVM OpenMP
(`libomp.dll`, Apache-2.0 with LLVM exceptions; its licence file ships beside it). The other
platforms' archives are pinned in the runtime manifest and marked UNVERIFIED there.

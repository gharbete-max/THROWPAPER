# Vision tuning — reading a page faster without reading it worse

**Date:** 2026-10-20 · **Runtime:** llama.cpp `b11741` (the pinned one) · **Script:** `scripts/vision-tune.ts`
(opt-in, never in `pnpm verify`) and `scripts/model-bench.ts` · **Feeds:** ADR 0025, `docs/plan/AI-SYSTEM.md` D4.

Reading one page with the 7B took 45 to 110 s. This is what was tried, what each try cost and bought,
and what was adopted. Only numbers that were measured are here; where a run was noisy it says so.

## 0. The short answer

- **Most of a page's time is the model writing the answer, not reading the picture.** On the 7B an
  invoice is 1,100 tokens in (19 s) and 830 tokens out (86 s). A table written as
  `{"row":1,"column":2,"text":"352 400"}` per cell spends most of a cell's tokens on the shape. **Adopted: a table is `rows`, a list of lists of the cells' texts.** The 7B reads the five
  pages in **281 s instead of 408 s (−31 %; −49 % on the invoice and the table)**, finding **44 of 48**
  known strings instead of 43. No server flag came close to that.
- **No server flag gained anything outside the noise** (batch, ubatch, flash attention, polling,
  priority, context size, image tokens, speculative decoding). The 8-bit KV cache is **slower** (decode
  9.9 against 15.4 tokens/s).
- **The 8-bit (Q8_0) projector is as accurate as f16 (44/48 both), 0.5 GB lighter, and not slower.**
  Adopted: `auto` now prefers it when both files are there.
- **More threads help on a machine with many cores** (28 threads: prefill +43 %, decode +19 % in
  `llama-bench`) but the cap of 8 stays: it is one computer, and the cap protects every other.
- **A graphics card is the one large gain: 6.6 times faster** (the 7B, five pages, 281 s → 43 s, same
  44/48; the 2B 100 s → 14 s). It is an optional setting, off by default (section 5): the Vulkan build is pinned in
  the runtime manifest, and a card another program is using can make it slower than the processor.
- **The 2B (Qwen3-VL) is clearly faster than the 7B at nearly equal accuracy** (section 4): 21 s a page
  against 56 s, 3.7 GB against 9.7 GB, invoice, table and form complete on both; it misses three small
  words on the text and the photograph that the 7B finds (41/48 against 44/48). At 2 megapixels the
  2B reads 43/48 in 36 s a page, still 1.6 times faster than the 7B at 1. The 4B is slower than the 2B
  and no more accurate; the two SmolVLM2 models do not work. **The default model is not changed here.**

## 1. How it was measured

- **Machine:** Intel Core i7-14700K (8 performance cores with two threads each, 12 efficiency cores,
  28 logical), 32 GB, Windows 11, RTX 4070 (12 GB). **Three other jobs were running on it** (interface
  work, a security audit, documentation), so every CPU run pinned its eight threads to one thread on
  each performance core (`-C 0x5555 --cpu-strict 1`). That does not keep another process off those
  cores. The table gives the load on the other logical processors where it matters; run-to-run noise
  on the same setting was **±10 %** (decode 9.4 to 11.7 tokens/s on the same settings in three runs).
  A difference under 10 % is not a result.
- **Pages:** the five invented pages of the real-model suite (`apps/desktop/src/ai/reader.real.test.ts`):
  invoice (707×1000), table, form, Swedish text and a degraded photograph of it (840×1188), about 1
  megapixel, with the strings that must be found (48 in all). The 0.5 and 2 megapixel sets are the same
  pages drawn again at 0.707 and 1.414 times the size, not scaled pictures.
- **What was run:** the production prompt and schema through `/v1/chat/completions` with the
  production sampling, one page at a time, the Q8_0 projector unless it says otherwise. Time is the
  whole request. Peak memory is the process's peak working set (graphics-card memory is not in it).
- **Reading the tables:** `in` is prompt tokens the server had to process (about 210 more were reused
  from the page before, see 2.4); `out` is answer tokens; `tok/s` is decode speed.

## 2. The 7B, one change at a time

### 2.1 Invoice and table only, the earlier schema (cells with row and column)

| Setting | invoice s | table s | out tokens | tok/s | found | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| baseline (three runs) | 104 / 101 / 113 | 104 / 101 / 108 | 832 / 900 | 9.4–11.7 | 24/25, 24/25, 24/25 | `Norr` read as `Nor` every time |
| no schema (speed only, answers not scored) | 63 | 60 | 490 / 365 | 11.2 / 10.9 | n/a | the grammar costs nothing per token |
| **table as `rows`** | **60** | **54** | **451 / 277** | 11.1 / 9.4 | **25/25** | **adopted** |
| `rows`, "write it on one line" | 75 | 57 | 342 / 186 | 7.2 / 8.9 | 24/25 | the model ignores it; no gain |
| shorter system prompt | 71 | 122 | 561 / 1019 | 10.6 / 10.5 | 24/25 | the table came back as many tables; no |
| ngram-mod speculation | 193 | 110 | 854 / 900 | 5.2 / 10.6 | 24/25 | worse |
| ngram-map-k speculation | 96 | 122 | 832 / 901 | 10.9 / 9.3 | 25/25 | no gain; on `rows` 61 / 51, the same as `rows` |
| 16 threads (both threads of the 8 performance cores) | 99 | 77 | 832 / 901 | 10.0 / 15.8 | 25/25 | see 2.3 |
| 6 threads | 87 | 100 | 827 / 900 | 12.9 / 12.7 | 24/25 | no gain |
| f16 projector | 76 | 87 | 832 / 901 | 14.3 / 14.0 | 25/25 | ran while the machine was quiet (3 % load); see 2.2 |

Most of the speed-ups in the middle are what the answer was: fewer tokens out, not faster tokens out.

### 2.2 Five pages, `rows` schema, 1 megapixel (all with 8 pinned threads unless stated)

| Setting | seconds, five pages | found | peak GB | Verdict |
| --- | --- | --- | --- | --- |
| earlier schema (cells) | 408 | 43/48 | 9.7 | |
| **`rows`, Q8_0 projector** (two runs) | **281 / 280** | **44/48** | 9.7 | **adopted** |
| `rows`, f16 projector | 317 | 44/48 | 10.2 | the same accuracy, 0.5 GB more; Q8_0 preferred |
| `rows`, 16 threads | 243 | 44/48 | 9.7 | −14 %, one machine; not adopted (2.3) |
| 0.5 megapixel | 198 | 41/48 | 9.3 | the photograph fell to 2 of 7; no |
| 2 megapixels | 432 | 45/48 | 10.6 | +54 % time for one string; this is what "high" quality is for |

The strings the 7B misses at 1 megapixel are the same two on the text and the photograph:
`åttiotal` (read as `åttiofem`) and `försommarväder`. They are 16 px print.

### 2.3 Server arguments, `llama-bench` (pp1024 / tg128, three repetitions, the 7B)

| Setting | prefill tok/s | decode tok/s | Verdict |
| --- | --- | --- | --- |
| 8 threads, performance cores (baseline) | 105 ± 2 | 15.4 ± 0.1 | |
| 4 / 6 threads | 57 / 82 | 12.3 / 13.8 | slower |
| 16 threads (hyper-threads of the 8 performance cores) | 127 | 18.1 | +21 % / +18 % |
| 28 threads (all) | 151 | 18.3 | +43 % / +19 % |
| `-ub` 128 / 256 / 1024 / 2048 | 110 / 115 / 113 / 115 | 16.4 / 16.5 / 16.1 / 16.3 | all inside the noise of the baseline run |
| flash attention off | 110 | 16.1 | no difference (`on` stays) |
| KV cache 8-bit (`-ctk q8_0 -ctv q8_0`) | 90 | **9.9** | slower, not adopted |
| `--poll 0` / `--poll 100` | 99 / 99 | 13.6 / 13.2 | no gain |
| `--prio 2` | 107 | 14.0 | no gain |

Threads are the one real lever, and a machine-dependent one. The cap of eight (physical cores less one,
between 2 and 8; `chooseThreads`) was set from a spike on eight performance cores and is not moved by a
measurement on one 20-core processor. A "threads" choice in the AI pane would let this computer use 16;
that is the owner's call.

### 2.4 Cached prompt, context, answer length, picture size

- **Prompt reuse across pages is already on.** `llama-server` keeps the previous request's tokens in
  the slot, and the system prompt is the common start of every page: the second and later pages of a
  document process about 210 fewer tokens (`cache_n` 211 in the runs; about 4 s on the CPU). The
  picture cannot be reused. Nothing to adopt (`--cache-ram 0` only turns off keeping *other* slots in memory).
- **Context size** changes memory, not speed: the 7B's key and value cache is about 57 KB a token,
  0.47 GB at 8,192. The text tasks need it, so it stays.
- **Answer length:** a page is now 280 to 470 tokens. The 2,400-token limit only ends a model that is
  looping (SmolVLM2-2.2B reached it on two pages, 100 s each); a dense page can need it, so it stays.
- **Picture size** (`--image-max-tokens`): the pages are under it. The pixel budget itself is the lever,
  in the table above.

## 3. What was adopted

| Change | Where | Measured |
| --- | --- | --- |
| A table is `rows` (lists of the cells' texts); `cells` is still read | `MODEL_PAGE_SCHEMA`, `pageFromModel`, `PAGE_SYSTEM`; `PAGE_PIPELINE_VERSION` 2, so pages read before are read again | −31 % on five pages, −49 % on invoice and table, 44/48 against 43/48 |
| `auto` prefers the Q8_0 projector when both are there | `pickProjector` (the free-memory rule is gone) | 44/48 both, −0.5 GB, not slower |
| `gpuLayers` setting, 0 unless chosen | `ServerSettings`, `serverArgs` | section 5 |
| The Vulkan build pinned | `runtimes/llama-server.json` (`variant: "vulkan"`), `fetch-runtime.ts --variant vulkan` | section 5 |

Not adopted, with the number that decided it: KV 8-bit (decode −36 %), shorter prompt (an inconsistent
table), "one line" (ignored), speculative decoding (worse or equal), 0.5 megapixel (photograph 2 of 7),
f16 projector (no gain), more threads (one machine).

## 4. The other models, the same five pages (`rows`, 1 megapixel, 8 pinned threads, CPU)

| Model | peak GB | load s | tok/s | s a page | found | invoice / table / form / text / photo | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen2.5-VL-7B Q4_K_M | 9.7 | 4 | 11 | 56 | **44/48** | 13 / 12 / 9 / 5 / 5 | working |
| Qwen3-VL-4B Q4_K_M | 6.5 | 2.4 | 16 | 37 | 40/48 | 13 / 12 / 6 / 6 / 3 | working, no reason to prefer it |
| **Qwen3-VL-2B Q4_K_M** | **3.7** | 1.6 | 30 | **21** | 41/48 | 13 / 12 / 9 / 3 / 4 | working |
| SmolVLM2-2.2B Q4_K_M | 4.2 | 1.6 | 31 | 73 | 17/48 | 3 / 7 / 6 / 0 / 1 | not working yet |
| SmolVLM2-256M Q4_K_M | 0.63 | 0.5 | 150 | 12 | 5/48 | 3 / 1 / 1 / 0 / 0 | not working yet |

The 2B and 4B ran twice; the 2B gave 41/48 both times (108 s and 100 s), the 4B 40/48 (193 s and 174 s).
At 2 megapixels: the 2B 43/48 in 179 s (4.0 GB), the 4B 42/48 in 275 s (6.9 GB), the 7B 45/48 in 432 s
(10.6 GB). With `model-bench.ts` (the invoice as Markdown, then the Swedish summary): 2B 12/12 in
14.6 s, summary 9.1 s; 4B 12/12 in 25.8 s, summary 17.2 s; SmolVLM2-2.2B 2/12 (a table of empty cells),
summary 12.9 s and readable; SmolVLM2-256M 7/12 (an amount repeated until the limit), summary 1.7 s, a
copy of the source.

- **8 GB computer:** Qwen3-VL-2B. It needs 4.2 GB free and 4.8 GB in all; the 4B needs 7.3 GB free and
  8.4 GB in all, which an 8 GB computer does not have.
- **16 GB computer:** Qwen3-VL-2B as well, unless small print matters: the 7B (10.6 GB at its peak) finds
  three more small words and is 2.7 times slower. On forms, invoices and tables the two are equal in these
  pages. The 4B has no place: slower than the 2B, not more accurate, 6.5 GB.
- **Plainly:** the 2B is clearly better on speed (2.7 times) at nearly equal accuracy (41 against 44
  strings of 48; the same on three of the five pages). The owner decides whether that is "equal enough"
  to move the default.

Caveat on all of it: the pages are invented and few, the sampling is not greedy (temperature 0.1), and
a difference of three strings is inside what another run could change. The 2B and 7B misses on the
Swedish text are real, small-print misses; whether the 2B is enough for a real scan is a test on real scans.

## 5. The graphics card (optional, not wired)

The pinned CPU build lists no devices. The Vulkan build of the same release
(`llama-b11741-bin-win-vulkan-x64.zip`, 32,359,614 bytes, SHA-256 `1981b989…413ab5`, checked against the
hash GitHub publishes for the release and again after download; 52 files, hashed into the manifest)
lists the RTX 4070 and the Intel UHD 770. Run with `-ngl 99`, the same pages, `rows`, 1 megapixel:

| Model | CPU, five pages | Vulkan (RTX 4070), five pages | found | decode tok/s | process memory |
| --- | --- | --- | --- | --- | --- |
| 7B | 281 s | **42.6 s** (first page 22 s while the card warmed up, then 4 to 6 s) | 44/48 | 70 | 5.4 GB (CPU 9.7) |
| 2B | 100–108 s | **14.1 s** (2 to 5 s a page) | 41/48 | 170 | 2.2 GB (CPU 3.7) |

Same answers, 6.6 and 7.5 times faster. It is **a setting, off by default** (2026-10-20, ADR 0025 amendment):
"Use the graphics card (faster, optional)" in the model list. It stays a choice because it needs a graphics
driver Loppa has not met on other machines (a wrong driver can crash or give garbage), the build is 32 MB more,
and a laptop's weak integrated chip might be picked. What exists now: the pinned, hash-listed build
(`variant: "vulkan"`), the setting and its confirmation (github.com, file, size), a `runtime-vulkan` folder
accepted from the AI pack, `local-models/`, `LOPPA_AI_DIR` or Loppa's own folder, `ServerSettings.device` /
`gpuLayers` reaching `--device` / `-ngl`, the fall-back to the processor, the remembered (clearable) failure and
the status line. Not done: macOS (Metal), and carrying the Vulkan folder inside the AI pack.

**Layers.** The pinned build fits the model to free graphics memory itself (`-fit on` is its default; with
`-ngl auto` it keeps 1 GB free and moves layers back to the processor until the rest fits; forced to leave
9000 MiB it settled on 12 of 29 layers). Loppa therefore does not estimate VRAM; it takes the first device from
`llama-server --list-devices` (the separate card is listed before the chip in the processor, which reports
the computer's RAM as "free" and would win a largest-free rule), leaves a card with under 2 GB free alone for
that run, and treats "0 layers fitted" as the processor, with nothing remembered.

**Measured through the engine** (`apps/desktop/src/ai/graphics.real.test.ts`, 7B Q4_K_M with the f16
projector, the five invented pages, 2026-10-20, RTX 4070 12 GB, no other program using the card):

| Setting | Five pages | Found | Card memory | Ran on |
| --- | --- | --- | --- | --- |
| off | 294.9 s (52 to 62 s a page) | 44/48 | n/a | processor |
| on | **32.0 s** (3.6 to 6.8 s a page, load 5 s) | 44/48 | 6.6 GB over the 2.1 GB already in use | the card, 29/29 layers |

9.2 times faster with the same strings found. **A card another program is using is the exception**: with a
game at 96 to 99% of the card (the same machine, 7.9 GB of it taken), the same first page took 288 s on the
card against 59 to 73 s on the processor, and the program reported 11.2 GB "free" and fitted all 29 layers
anyway. Loppa cannot see another program's load (Vulkan has no portable query for it), so the setting's text
says it is for a computer with a separate card, and turning it off is one click. The Qwen3-VL-2B was not on this
computer; its Vulkan figures above (14.1 s) are from the earlier measurement.

**Forced failures** (same test, the processor program answering): a Vulkan program that is not there (no
device) and a device that is listed but whose program ends at once both ended with the page read on the
processor, 13/13 strings, the failure remembered (`no-device`, `start-failed`) and no failed task. The other
reasons (out of memory while loading, a crash on the first request, a card with nothing fitting) are covered
with the stand-in server in `server-engine.graphics.test.ts`.

## 6. To repeat it

```
pnpm --filter @tp/desktop exec tsx scripts/fetch-runtime.ts --out <dir>           # the CPU build, hash-checked
pnpm exec tsx scripts/vision-tune.ts --weights <gguf> --proj <gguf> --runtime <dir> \
  --pages <dir of invoice.png table.png form.png text.png photo.jpg> --mask 0x5555 [--extra="-b 4096"] [--legacy]
BENCH_MASK=0x5555 pnpm exec tsx scripts/model-bench.ts <work-dir> <runtime-dir> <model-id>...
```

Each prints one JSON line per model with the seconds, tokens, tokens a second, strings found and missed
per page, and the peak memory. `--legacy` reads with the earlier cells schema. The flags that were tried
and dropped (`short`, `compact`, the `ngram` types) are plain `--extra` arguments or a prompt edit.

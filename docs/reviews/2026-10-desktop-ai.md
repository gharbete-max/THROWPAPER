# Desktop and AI stack review, 2026-10-21

Scope: `apps/desktop` (main process, panel, packaging) and the AI coordinator, engines and
pipelines under `apps/desktop/src/ai`. Method: read the code, write the failing test first, fix,
rerun; run the real model for what a stand-in cannot show; install the built installer and drive
it. Machine: i7-14700K (28 threads), 32 GB, Windows 11; llama.cpp b11741 CPU build; 7B Q4_K_M with
the Q8_0 projector, Qwen3-VL-2B Q4_K_M. Real runs were pinned to eight performance-core threads
(`start /affinity 5555`) **but the machine was shared**: other agents, a build and the repository's
test suite ran at times, so seconds below are 2 to 4 times slower than `VISION-TUNING.md`
(a 7B page read was 56 s alone, 75 to 265 s here). Memory and behaviour figures are not affected.
`packages/` was not touched. Nothing under `apps/forms` or the backends was edited.

Tests: `src/ai/reliability.test.ts` (31 scenarios, stand-in child process, runs in `pnpm test`),
`src/ai/reliability.real.test.ts` (opt-in: `LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=<7B + 2B files>
LOPPA_RUNTIME_DIR=... LOPPA_REAL_LOG=<file>`), `robustness.test.ts`, `main/lifecycle.test.ts`,
additions to `pack`, `runtime`, `pdf` and `coordinator` tests, and
`scripts/smoke-installed.ts` (installed program driven over the debugging port).

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | The AI pack built by `make-ai-pack.ts` from the real files could not be installed: the manifest lists each file whole (Hugging Face layout, #196) and `joinFile` looked for those names or the whole file, never `<name>.partN`. "Open AI pack from a folder" answered "not installed". The script still printed "matches the manifest". | Fixed: numbered pieces are found by the naming rule (never from `PACK.json`), the joined file is held to the manifest hash. Tests.   |
| 2   | High     | A server killed (or its socket reset) mid-request was reported `failed` and stayed resident: the 500 ms wait for the exit event is too short on Windows, where reaping a process holding 9 GB takes seconds. Reproduced on the 7B.                                                                                              | Fixed: a lost connection is `cannot-start` at once and the slot is cleared. Real run: `cannot-start; resident null`, next task 21 s. |
| 3   | Medium   | Idle release cleared `resident` before the process had ended. A task arriving in that window loaded a second model beside the dying one, or was refused `too-little-memory` because the memory was not back yet.                                                                                                                | Fixed: disposals in flight are awaited before a load and before the memory check.                                                    |
| 4   | Medium   | `close()` while a model was loading returned with the child still alive (killed 250 ms later by the load loop).                                                                                                                                                                                                                  | Fixed: `close` waits (10 s at most) for the running task to end its engine. Real: 0.5 s, child gone.                                 |
| 5   | Medium   | Two windows asking with one task id at once were both accepted (the id was checked before two awaits).                                                                                                                                                                                                                           | Fixed: ids are claimed before the first await.                                                                                       |
| 6   | Medium   | A stream that ended without `[DONE]` (server died, connection cut) returned the partial text as a finished answer.                                                                                                                                                                                                               | Fixed: it is an error and the server is let go.                                                                                      |
| 7   | Medium   | A listener that throws (`webContents.send` on a window that is closing) escaped `pump` as an unhandled rejection: a crash dialog while quitting during a task.                                                                                                                                                                   | Fixed in the coordinator (listeners isolated) and in `main.ts` (`sendToMain` checks the window).                                     |
| 8   | Medium   | Backup, restore of keys, saving settings, first-run set-up and restarts could overlap. A settings save during a backup restarted the databases in the middle of the copy: a backup that restores corrupt. A failed restart left a closed server object in `server`.                                                                | Fixed: one `exclusive` lock (`main/lifecycle.ts`); `restartNow` clears `server` first; the backup dialog no longer runs inside the lock. |
| 9   | Medium   | Quit could hang for ever on a close that never ends, leaving an invisible process holding the single-instance lock.                                                                                                                                                                                                              | Fixed: `closeAll` with timeouts (30 s servers, 45 s in all).                                                                         |
| 10  | Medium   | Hidden PDF windows: no limit and no timeout. A batch opened one browser per document; a page script that never ends held its window and request for ever.                                                                                                                                                                       | Fixed: two at a time, 60 s each, window destroyed and file removed. Tests with a fake window.                                        |
| 11  | Low      | Opening a pack did not check free disk space (a download does): a 7 GB join onto a full disk failed late as `failed`.                                                                                                                                                                                                            | Fixed: `no-disk-space` before the first byte.                                                                                        |
| 12  | Low      | A file marked damaged stayed `damaged` in the status after the person put the right file back. A runtime folder found damaged stayed so until restart.                                                                                                                                                                          | Fixed: damaged is remembered with the file's size and time; the runtime check is not cached when damaged.                            |
| 13  | Low      | The result cache wrote one temporary file from concurrent saves, and a failed write (a virus scanner holding the file) failed the task that had just read a page. `clear()` could be undone by a queued write.                                                                                                                  | Fixed: saves are serial and best effort; `clear` is ordered after them.                                                              |
| 14  | Low      | `rename` of a finished download or a joined pack failed on EPERM/EBUSY (a scanner opens the file the instant it is written); gigabytes lost to a lock of a second.                                                                                                                                                              | Fixed: `renameRetry`, 12 tries of 250 ms.                                                                                            |
| 15  | Low      | `will-redirect` was not guarded: a redirect sent by a server was not judged like a navigation.                                                                                                                                                                                                                                   | Fixed in `main.ts` (same rule as `will-navigate`). Not testable without Electron.                                                    |
| 16  | Medium   | **Backend, reported, not edited.** `api-forms/src/desktop/phone-relay.ts` `open()`: two calls at once both pass `if (origin)` and both listen; the first server is overwritten, never closed, and stays open on the LAN with no idle check. Suggest memoising the opening promise. **Fixed** in `claude/carryover-fixes` (B-1).                                              | Open. Owner of api-forms.                                                                                                            |
| 17  | Low      | Backend, reported. `mail/outlook.ts`: `execFile` times out at 120 s while classic Outlook may be waiting on its own security prompt; the message can be sent later although Loppa reported failure (a resend duplicates it).                                                                                                      | **Fixed** in `claude/carryover-fixes`: a timeout is an unknown outcome, failed without a retry (B-2).                                                                             |
| 18  | Low      | `applySettingsForm` asks for the real-sending confirmation only when the mode changes: switching SMTP host/user inside `smtp` mode does not.                                                                                                                                                                                     | Open.                                                                                                                                |
| 19  | Info     | The hard kill of the shell still leaves the model server alive (security review row 4). Not changed.                                                                                                                                                                                                                             | Open (pid file at next start).                                                                                                       |
| 20  | Info     | An NSIS build from a deep worktree path failed earlier; every build here was from `C:\tpb` and passed. Build the installer from a short path. Not re-run from the deep path.                                                                                                                                                      | Documented.                                                                                                                          |

Counts: high 2 (fixed), medium 9 (8 fixed, #16 reported), low 7 (5 fixed; #17 and #18 open), info 2 (open). Rows 16 to 20 are not fixed here.

## Scenarios

"Fake" is `reliability.test.ts` (runs in CI); "Real" is the opt-in suite on the real server.

| Scenario                                                  | Expected                                                                  | Observed                                                                                                                          | Fixed?          |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Cancel while queued (Fake, Real 2B)                       | cancelled, never starts, running task undisturbed                         | as expected                                                                                                                       | n/a             |
| Cancel while the model loads (Fake, Real 2B)              | cancelled, child ended, slot empty, next task starts afresh               | cancelled in 0.2 s, child dead, memory unchanged                                                                                  | n/a             |
| Cancel during prompt processing (Fake, Real 2B)           | request closed, server stops computing, same child serves the next task   | cancelled; CPU 0.00 s in the next 3 s; child alive                                                                                | n/a             |
| Cancel mid-answer (Fake, Real 2B)                         | as above                                                                  | cancelled; CPU 0.02 s in the next 3 s; next task done                                                                             | n/a             |
| Cancel after done                                         | nothing                                                                   | no event                                                                                                                          | n/a             |
| Two tasks of different capabilities queued (Fake)         | run in turn, never two processes alive, release before load               | max 1 alive, order released → loading                                                                                             | n/a             |
| Task during idle release (Fake, Real 2B)                  | waits for the old process, then runs on a fresh one                       | before: `too-little-memory`/two alive; after: done, old child dead                                                                | Yes (#3)        |
| Kill -9 mid-request (Fake, Real 7B)                       | clean `cannot-start`, slot cleared, next task restarts, no orphan         | before: `failed`, resident kept; after: `cannot-start`, `resident null`, next task done in 20.9 s, 0 listeners, 0 processes left | Yes (#2)        |
| Kill -9 while a page is read / while idle (Fake)          | `cannot-start`; after idle death one failure then works                   | as expected                                                                                                                       | n/a             |
| Stream cut or socket reset by a live process (Fake)       | never a finished answer; server let go                                    | before: partial text returned as done; after: `cannot-start`, next task fresh                                                     | Yes (#6)        |
| Crash on start / out of memory on load (Fake)             | `cannot-start` / `too-little-memory`, no process, works when fixed        | as expected                                                                                                                       | n/a             |
| Free memory under the requirement; 8 GB computer (Real)   | refused up front, no child                                                | `too-little-memory` both times                                                                                                    | n/a             |
| Weights truncated by 1 byte (Real 2B copy)                | `damaged`, no child, nothing deleted                                      | damaged                                                                                                                           | n/a             |
| One byte flipped in the projector (Real 2B copy)          | `damaged`                                                                 | damaged                                                                                                                           | n/a             |
| Projector missing / weights 0 bytes / wrong manifest hash | `not-installed` / `damaged` / `damaged`                                   | as expected; the intact copy then loaded and answered in 9 s; originals untouched                                                 | n/a             |
| Damage mended, same session (Fake)                        | status no longer `damaged`, task runs                                     | before: stayed `damaged`; after: `unchecked`, done                                                                                | Yes (#12)       |
| Pack part missing / flipped / stale extra (Fake)          | `missing` / `hash` / `hash`, nothing installed                            | as expected                                                                                                                       | n/a             |
| Pack made by `make-ai-pack.ts`, installed in the app      | installs                                                                  | before: "not installed"; after: installed in 6.3 s through the real file dialog                                                   | Yes (#1)        |
| Projector switch f16 / Q8_0 (Real 7B)                     | each setting loads its own file                                           | f16: 7989 MB resident; Q8_0: 8676 MB (whole process, a page read each)                                                            | n/a             |
| Model switch 7B → 2B → 7B (Real)                          | released before the next, memory returns                                  | free 16.51 → 7.20 loaded → 16.16 released; 2B 12.78 → 16.09; 7B again 7.15 → 16.15 GB                                             | n/a             |
| Ten pages of text (Real 2B)                               | progress, bounded memory                                                  | done, 205 s, 384 progress events, server working set max 3.3 GB                                                                   | n/a             |
| Ten pages cancelled after 3 s (Real 2B)                   | ends within about a second                                                | 0.06 s                                                                                                                            | n/a             |
| Thirty pages queued, cancelled after two (Real 2B)        | one verdict each, queue empty, memory flat                                | two pages in 117 s (contended); queue 0; server 3.8 GB                                                                            | n/a             |
| Two windows, same id (Fake, Real)                         | both answered on own ids, repeat refused                                  | before: both accepted; after: refused                                                                                             | Yes (#5)        |
| Quit while the 7B loads (Fake, Real)                      | `close()` returns with the child gone                                     | before: child alive after return; after: 0.5 s, gone, memory returned                                                             | Yes (#4)        |
| Quit during a download (Real, network)                    | `.partial` kept, no final file, resume gives the right hash               | 30 MB partial, no final file, resumed to 445053216 of 445053216 bytes                                                             | n/a             |
| Paths: spaces, accents, CJK, en dash, OneDrive-like       | works                                                                     | done in 9 s                                                                                                                       | n/a             |
| Path of 362 characters (Real)                             | works or a clean error                                                    | `cannot-start` in 1 s: `llama-server.exe` itself does not open it. Clean, but a long path to the models folder cannot be used     | Residual        |
| Drive letter made by `subst` (Real)                       | works                                                                     | done in 9 s                                                                                                                       | n/a             |
| Projector held open by another program (Real)             | error, no crash; works once released                                      | `failed`, no child; after release done                                                                                            | n/a             |
| A listener that throws (Fake)                             | queue unaffected                                                          | before: unhandled rejection; after: both tasks done                                                                               | Yes (#7)        |
| Concurrent saves of the cache; unwritable cache (Fake)    | no entry lost; task unaffected                                            | before: shared temp file, task failed; after: serial, best effort                                                                 | Yes (#13)       |
| Hidden print windows (Fake window)                        | bounded count, timeout, cleanup                                           | max 2 open of 9; a never-loading page fails in 80 ms test time, file removed                                                      | Yes (#10)       |
| Not exercised                                             | real out-of-memory in the program; 8 GB machine; antivirus; OneDrive sync | the stand-in and a forced low reading stood for the first two; a share-denying lock stood for the scanner                         | Residual        |

## Soak: 50 consecutive real tasks in the installed program

Installed Loppa 0.1.2 driven over the debugging port (`smoke-installed.ts --steps soak`): 40
summaries of a short text and 10 page reads (an invoice picture, a new file hash each time so the
cache never answered), 7B with the Q8_0 projector, one resident server, no restarts between tasks.
Other jobs ran on the machine (the repository's tests, builds), so times drift with them.

| Measure                              | First task / first half | Last task / second half |
| ------------------------------------ | ----------------------- | ----------------------- |
| Tasks done                           | 50 of 50                |                         |
| Summary, mean seconds                | 8.8                     | 8.0                     |
| Page read, mean seconds              | 75.6                    | 87.2 (machine busier)   |
| Loppa processes (5), working set     | 1024 MB (max)           | 981 MB                  |
| Loppa processes, handles             | 2911                    | 2918                    |
| `llama-server` working set           | 8.6 GB, 9.5 GB after the first page | max 9.48 GB, flat |
| `llama-server` handles               | 207                     | 237 (+30 over 50 tasks) |
| `llama-server` count                 | 1                       | 1 at most               |

No leak in the shell. The server's handle count crept by 30 over 50 tasks (about one per two
tasks); it is the pinned program's, not Loppa's, and is bounded by the idle release, which ends the
process. Page time rose with the load on the machine, not with the task number (summary time fell).

## Installer (Windows)

Built from a short path (`C:\tpb`, a copy of the tree, `pnpm install`, `NPM_CONFIG_USERCONFIG=<empty
file> pnpm --filter @tp/desktop run package:win`): 60 to 69 s.

| Measure                                    | Value                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Setup exe / portable exe                   | 172.8 MB / 172.6 MB                                                      |
| Silent install (`/S /D=C:\tp-ai\inst`)     | 14.6 to 15.8 s, exit 0; 1714 files, 551 MB; `HKCU\...\Uninstall` entry "Loppa 0.1.2" |
| Launch to debugging port                   | 0.65 to 2.7 s                                                            |
| First run: set-up window / room reachable  | 3.7 s / 4.2 s after launch; workspace folders made; `/healthz` 200       |
| Second launch: room open                   | 1.2 s                                                                    |
| AI status with no pack                     | model `missing`; runtime `verified`, source `ai-pack`, `resources\ai-pack\runtime` |
| Open the pack (6.9 GB, parts) from a folder| 6.3 s, state `installed`; after relaunch `installed`, cache kept          |
| One summary / one page read (contended)    | 18 to 26 s / 117 s                                                       |
| Outbound connections of Loppa and the server | none (sampled every 3 s during both tasks; no firewall rule needed, not run as administrator) |
| Quit (window close)                        | exit 0 in 2.4 to 2.8 s, no process left                                  |
| Silent uninstall                           | 10.3 s, exit 0; folder, registry entry and Start-menu entry gone; user data (`--user-data-dir`, models) kept by policy; the real `%APPDATA%\Loppa` untouched |

Not automated: backup and restore of the keys through the menu (native menu and save dialog); the
sealing and opening are covered by `backup.test.ts` (wrong passphrase, damaged file, limits).

## Residual risks

- A hard kill of the shell leaves the model server running (#19).
- A path of 362 characters to the models folder cannot be used by the pinned `llama-server.exe`;
  the error is clean. A pack opened from a deep folder is copied to the user-data folder, so only that
  folder's depth matters.
- The server's handle count creeps slowly; the idle release (10 minutes) ends the process.
- Real out-of-memory, 8 GB machines, other drivers, macOS and antivirus products were not run.
- Items 16 to 18 are the backend owner's.

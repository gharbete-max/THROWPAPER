# Security review, October 2026

Scope: what was added in the two weeks to 2026-10-20 — the desktop IPC and preloads, the
`llama-server` child, model downloads and the AI pack, how AI text is handled, the PDF and Word
routes, mail and unsubscribe, and the dependencies. Method: read the code, write a failing test for
each real finding, fix, rerun. Nothing under `packages/` and not `docs/CONTRACT.md` was changed.

Severity is for the product as it is used (a desktop on one person's computer; a hosted Forms API
for the public). A local attacker who already runs code as the same user is outside the model.

## Findings

| #   | Area                  | Finding                                                                                                                                                                                                                                                                                  | Severity | Status                                                                                                                                                                              |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | llama-server child    | The child received the shell's whole environment (only `LLAMA_`, `HF_` and proxy names were removed): tokens, `NODE_OPTIONS`, the signing secret if set. `ai/server/llama-server.ts` `defaultSpawn`.                                                                                       | Medium   | Fixed: an allow-list (`childEnv`): PATH, system root, temp, home, locale, library paths.                                                                                             |
| 2   | llama-server child    | The ephemeral port is probed and closed before the child binds it. On Windows another program can bind the same port; `/health` is unauthenticated, so the impostor passed the check and then received the bearer key and every document sent for summary. `llama-server.ts` `startServer`. | Medium   | Fixed: a bind failure in the child's log refuses the start; a health answer counts only if the child is still alive 300 ms later. The key is not sent before that.                    |
| 3   | llama-server child    | A child that ignored the first kill was waited for 10 s and then left running (up to 10 GB). `RunningServer.kill`.                                                                                                                                                                        | Medium   | Fixed: after 5 s a forced kill (`SIGKILL`), 5 s more. A process-exit hook also kills the child if the shell exits without closing the model.                                         |
| 4   | llama-server child    | If the shell is killed outright (Task Manager, a crash of Electron) the child survives, with the model in memory. Node has no job object on Windows.                                                                                                                                      | Medium   | Open. Suggested: a pid file in userData, and at the next start kill a process of that pid whose image name is the runtime's. Not built here: needs a Windows-only process lookup.      |
| 5   | AI IPC                | `window.loppaAi` and `window.loppaModel` answered every origin in `ourOrigins()`, which includes Sign's loopback origin, though the contract says Forms only. `main/main.ts` `registerIpc`.                                                                                               | Low      | Fixed: both are registered with Forms' origin alone.                                                                                                                                 |
| 6   | AI IPC                | The consent object went from the window to the consent record (`consents.jsonl`) as a spread: a window could add keys, overwrite `at` or write a large value. `ai/ai-ipc.ts`, `coordinator.ts` `install`.                                                                                | Low      | Fixed at the boundary: `plainConsent` keeps `host`, `files`, `totalBytes` with bounds; anything else is `consent-required`.                                                          |
| 7   | AI IPC                | A summarise, translate or select job had no size limit (a window could pass hundreds of megabytes into the model process). `ai/model-ipc.ts` `isModelJob`.                                                                                                                                | Low      | Fixed: 5,000,000 characters and 5,000 passages. Reply, proofread, compose and read-page tasks were already bounded in `@tp/shared`.                                                  |
| 8   | Downloads             | A server could send more than the published size of a part; the bytes were written until the stream ended and checked only afterwards (disk exhaustion from an allowed host). `ai/download.ts` `fetchPart`.                                                                                | Low      | Fixed: `measure` stops at the manifest size and removes the partial file.                                                                                                            |
| 9   | AI pack               | `PACK.json` names were `[A-Za-z0-9._-]+`: `..`, a trailing dot (Windows drops it) and device names (`NUL`, `CON`, `COM1.part1`) passed. The app never trusts these names (it joins by the names in its own code); `join-ai-pack.ts` does. `ai/pack.ts` `readPackManifest`.               | Low      | Fixed: `isPlainFileName`.                                                                                                                                                            |
| 10  | Keys backup           | `keys.enc` accepted scrypt `N` up to 2^20 (1 GiB of memory, tens of seconds on the main thread) from a file the person is handed. `main/backup.ts`.                                                                                                                                      | Low      | Fixed: at most 2^17; the default is 2^15.                                                                                                                                            |
| 11  | Runtime settings      | `LOPPA_AI_CTX` and `LOPPA_AI_THREADS` became program arguments with any non-zero number, including negatives. `ai/shell.ts`.                                                                                                                                                              | Low      | Fixed: whole numbers in a range, otherwise ignored.                                                                                                                                  |
| 12  | llama-server child    | The bearer key is a program argument (`--api-key`), readable by any process of the same user. A key file would be better if the pinned release supports `--api-key-file`.                                                                                                                | Low      | Accepted: same-user processes can already read the model's memory and the documents. Revisit at the next runtime pin.                                                                |
| 13  | Desktop PDF renderer  | The hidden print window runs JavaScript (Electron's default). The page is escaped and its session cancels every request but its own file and `data:`, so the exposure is one missed escape.                                                                                                | Low      | Open (defence in depth). `javascript: false` would also stop the font wait, which uses `executeJavaScript`; needs a different wait first. The Playwright renderer already disables JS. |
| 14  | Runtime folder        | The runtime is hashed once per session by the files the manifest lists; an extra DLL placed beside `llama-server` is not seen, and the program's folder is on the DLL search path. Needs write access to the pack or user-data folder.                                                    | Low      | Accepted: the same access replaces the application. Listing the folder's names in the check would close it cheaply.                                                                  |
| 15  | Dev mail provider     | `MAIL_PROVIDER=console` logs the whole message, including magic links. By design for development.                                                                                                                                                                                         | Info     | No change. The unconfigured default refuses to send.                                                                                                                                 |

Counts: critical 0, high 0, medium 4 (3 fixed, 1 open), low 10 (7 fixed, 1 open, 2 accepted), info 1.

## Checked, no finding

IPC and preloads

- **Origin guard.** `senderFrame.url` is the frame that sent, so an iframe inside Forms from another
  origin is refused; `url === origin || startsWith(origin + '/')` rejects `127.0.0.1:41000.evil`,
  another port, `file:`, `about:blank`, `blob:` and a null frame (tested). It is evaluated per call, so
  while the servers restart the list is empty and nothing is answered.
- **Preloads** expose named functions only, no `ipcRenderer`; listeners get the payload, not the
  event. The panel's bridge is checked by the panel's own file URL (`fromPanel`), and the panel
  cannot navigate (`classifyNavigation` denies from `file:`), so a dropped file cannot replace it.
- **Arguments.** Model ids match `^[a-z0-9._-]{1,80}$` and are looked up in the catalogue; task ids
  are short strings; tasks pass the shared type guards (reply, proofread, compose, read-page are
  bounded; a page picture is bounded to 12 MiB and checked again by the reader). No path or URL from
  a window reaches `fs` or `spawn`: the only file chosen by a person comes from a native dialog in
  the main process. Cache keys are hex digests.
- **Logs.** The desktop sources have no `console.*`; the tail of the child's output goes into an
  error that is mapped to a `problem` word before it reaches a window. Texts of tasks are not logged.

The child

- **Bind.** `--host 127.0.0.1`, an ephemeral port, `--api-key` of 24 random bytes per run
  (`randomBytes`), `--no-webui`, `--offline`. The key lives in the main process and in the child's
  arguments; it is not in any event or status.
- **Arguments.** Spawned with an argument array and no shell. File paths come from the resolver and
  were hashed against the manifest; a path starting with `-` would still be the value of `-m`.
- **Tools.** The server is used for `/health` and `/v1/chat/completions` only. No request carries
  `tools` or `functions`, and no code reads a model answer as a command.

Downloads

- **Hosts.** `huggingface.co`, `hf.co` and their subdomains, https only, checked on the first
  address and on every redirect (redirects are followed by hand, at most five). No `Authorization`
  or cookie is ever sent. GitHub is not on the list, so a redirect there is refused.
- **Hash before visible.** A part is hashed while it streams to `<name>.partial` and renamed only if
  size and hash match; the join writes `<name>.joining` and renames after the whole-file hash. A
  resume re-hashes what is on disk. The app installs from a pack by the names and hashes in its own
  code, never `PACK.json`'s.
- **Free space.** Checked before a download starts, with a margin.
- **Symlinks and junctions** in the user-data folder or pack folder: followed, but only a file whose
  hash equals the manifest's is accepted or loaded. Replacing a file between the hash and the
  child's open needs write access to the user-data folder.

AI text

- No `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` anywhere in `apps/` or
  `packages/` outside a comment that explains why not; AI output is shown as React text.
- Received mail and document text are quoted as data under a system prompt that says so, with angle
  brackets and hidden characters removed (`quoteAsData`); the model has no tools and no network, and
  a draft reply reaches the message box only when the person presses the insert button; Send has its
  own confirmation. Proofread spans are located in the text by `verifyIssues` before they are shown.
  Nothing writes an AI result into an original: the cache and the window are the only places.

PDF, Word, mail

- **Uploads.** Multipart with a 100-part parser limit, a per-file size cap, field-size caps, file
  counts cut by hand; every PDF route (arrange, copy via its photo, fields, fill, shrink, edit,
  redact) opens through `openChecked`, which refuses `/Encrypt`, runs the worker with a 5 s and 256
  MB budget, then loads. Operations are bounded (200 ops, 500 characters, picture size and pixel
  caps, 50 redacted pages). The form-paper upload route uses `checkPdf` too.
- **Word.** The `.docx` is read in the browser by an own zip reader that counts inflated bytes
  against one 20 MiB budget, refuses zip64, split and encrypted entries, and caps entries at 200;
  the server receives blocks, validated by Zod, escaped into HTML, rendered by a browser with
  JavaScript and the network off. Block, run and picture sizes are capped.
- **CSV.** `toCsv` prefixes a tab to cells starting `= + - @`, tab or CR; the payable export
  prefixes an apostrophe. Headers get the same.
- **Mail.** `buildMimeMessage` folds control characters out of From, To, Subject, extra header
  values and attachment names, restricts extra header names to letters and hyphens, and base64-encodes
  bodies; recipients pass the shared `Email` schema. A campaign's text is plain text.
- **Unsubscribe.** HMAC-SHA256 over organisation and address with a key derived from the signing
  secret under its own label, compared in constant time; organisation must be a UUID; length-capped.
  GET records nothing (scanners), POST records, and repeating it is harmless. It cannot be used to
  unsubscribe an address its mail was not sent to, because the address is inside the signed part.
  There is no expiry by design.
- **Downloads and headers.** Signed download links, `nosniff` on stored files, filenames through
  `asciiFilename` and `contentDisposition`.

Dependencies

- `pnpm audit --prod`: no known vulnerabilities. `pnpm licence:check` and the rest of the gates are
  in the pull request.

## Remaining

Row 4 (an orphaned child after a hard kill of the shell) is the one that matters. Rows 13 and 14 are
cheap hardening for when the runtime check is next touched.


## Addendum 2026-10-26: Add-ons and updates

What was added: the AI program fetched in the app (macOS and other systems), the AI pack from its
release, the user-pressed update check and the installer download, and the page that holds them
(`apps/desktop/src/addons/`, `window.loppaAddons`). Reviewed against the lists above. Nothing under
`docs/CONTRACT.md` changed; `packages/shared/src/ai/addons.ts` is new (types and one Zod schema).

| #   | Area              | Finding                                                                                                                                                                                                                                                                                                     | Severity | Status                                                                                                                                                                                                                                           |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | Runtime archive   | `fetchRuntime` unpacked the graphics-card archive with the system `tar` after the archive hash matched. A hash proves the file is the one released, not that its entry names are safe (`..`, absolute paths, links), and an unverified asset has no per-file list. `ai/runtime-fetch.ts`.                        | Low      | Fixed: `addons/extract.ts`, a reader of our own for `.zip` and `.tar.gz` (names, links, caps, ratio), used for every runtime archive and by `fetch-runtime.ts`. Tests: `extract.test.ts` (54 cases), and the real Windows and macOS archives. |
| 17  | Runtime fetch     | The check after unpacking demanded `ok`, which an unverified asset (no file list) can never be: the first Mac fetch would have failed on the verdict, not on anything wrong. `ai/runtime-fetch.ts`.                                                                                                        | Info     | Fixed: only `damaged` fails; the program must be present. Test: `addons.test.ts` "is fetched, checked against the pinned hash, unpacked".                                                                                                       |

Checked, no finding (each with its test):

- **IPC arguments.** The four channels that fetch take one consent, parsed by the Zod schema
  `ConsentRequest` at the main boundary (host at most 253 characters, at most 32 file names of at most
  255, a non-negative safe integer): extra keys are dropped, anything else is `consent-required`
  (`addons-ipc.test.ts`, 17 shapes). `plainConsent` of the AI channels now uses the same schema.
  Opening the installer and cancelling take no argument at all.
- **Origin guard.** All channels go through `originGuard` and are registered with Forms' origin
  alone (`addons-ipc.test.ts` tries five other frames on every channel).
- **The consent is compared, never used.** What a window sends is checked against what the shell would
  fetch (host, files, total size); the address, the file name and the folder come from code and from
  the release list, never from a window. A wrong consent fetches nothing and touches no disk
  (`addons.test.ts`: "wants the exact consent").
- **Consent record.** One line per confirmed action: the time, `addon:<task>` and the three consent fields.
- **No path from the renderer reaches the file system.** The installer's path is the shell's own and
  `openInstaller` hashes the file again immediately before `shell.openPath` (a changed file is not
  opened: test). The Downloads path is Electron's `app.getPath('downloads')`.
- **Hosts.** A third list, exact names: `github.com`, `api.github.com`, `release-assets.githubusercontent.com`,
  `objects.githubusercontent.com` (confirmed by a real request). Not a suffix rule, so
  `raw.githubusercontent.com`, user-content hosts and look-alikes are refused; https only; redirects
  followed by hand, five at most, each checked (`release.test.ts`, `addons.test.ts` with a redirect to
  another host, to plain http, to `raw.githubusercontent.com`). The model download's list is unchanged
  (`isAllowedHost('github.com')` stays false: test).
- **Nothing sent.** The requests carry `Accept` and `User-Agent: Loppa` only: no cookie, no
  `Authorization`, no body, no referrer, no app version (test reads the headers the fake server saw).
- **Caps.** Release list 2 MB, checksum file and `PACK.json` 64 KB, installer 600 MB and exactly the size
  the release lists (more bytes stop the stream), temp file then atomic rename, hash mismatch deletes the
  partial file. Release notes are shown as plain text with control characters removed, cut to 4 000
  characters, never as HTML.
- **Pack.** `PACK.json` must agree with the app's manifest (name, size, hash); part names must be the
  file's `.partN`, so a hostile list cannot name `locations.json` or `consents.jsonl` (test).
- **Concurrency.** One add-on at a time, and never beside a model download or a task, both ways (test
  of the shell's wiring).

Accepted: the checksum list comes from the same release as the installer, so it guards against a
damaged file or a tampered CDN copy but not against a release that was itself replaced; the builds
are not code-signed (LAUNCH-CHECKLIST §6) and the installer opens only by a press. Between the last
hash and the system opening the file there is a window in which another program running as the same
user could swap it; that program could replace the application too. Not verified: macOS (the program
fetched there has never been run by this project), and a packaged build's launch of the new channels
(the Desktop workflow on both systems).

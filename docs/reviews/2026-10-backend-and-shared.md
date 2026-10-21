# Backend and shared packages review, 2026-10-21

Scope: `apps/api-forms`, `apps/api-sign`, `packages/shared`, `packages/signing`, `packages/calc`,
`packages/tokens`, `packages/i18n`. Taken at `056e140` (main after #219), branch
`claude/review-backend-shared`. `apps/forms` and `apps/desktop` were read only where a pure library
of theirs is fuzzed from `scripts/`; findings there are reported, not fixed. `packages/shared` and
`packages/signing` are touched (small fixes below); `docs/CONTRACT.md` is not.

Method note (see CLAUDE.md "Never mistake a proxy"): every finding below was reproduced by a
failing test or a measurement before it was fixed, except where it says "read only".

## 1. Coverage map

Measured with `@vitest/coverage-v8@5.0.5` installed temporarily and removed again (no committed
dependency): `vitest run --coverage` over `apps/api-forms`, `apps/api-sign` and `packages/*`
(4706 tests, 39 s).

| Area | Statements covered |
| --- | --- |
| `packages/calc` | 100 % (82) |
| `packages/shared` | 95 % (9033) |
| `packages/signing` | 93 % (100) |
| `apps/api-sign` | 89 % (953) |
| `packages/i18n` | 88 % (73) |
| `apps/api-forms` | 81 % (5955) |

The 25 least-covered files by risk (not size). "Unc." is uncovered statements. Many `api-forms`
routes are exercised through the memory repositories only, so `db/repositories/drizzle.ts` (33 %)
is the real gap: the SQL itself is covered by `database.test.ts` / `send.db.test.ts` only where a
migrated Postgres exists, and by the new PGlite test for the ledger and token paths.

| # | File | Unc. | Cov. | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | `api-forms/src/db/repositories/drizzle.ts` | 230 | 33 % | every query, transaction, lock; ledger, jobs, tokens |
| 2 | `api-forms/src/routes/signing.ts` | 81 | 58 % | signing requests, remind, cancel, sealed download, hook intake |
| 3 | `api-forms/src/routes/forms.ts` | 73 | 77 % | form access, versions, share |
| 4 | `api-forms/src/server.ts` | 59 | 78 % | error handler, headers, rate limits, wiring |
| 5 | `api-forms/src/routes/sending-domains.ts` | 32 | 22 % | DNS verification, sender identity (mail from) |
| 6 | `api-forms/src/uploads/private-store.ts` | 24 | 33 % | respondents' personal files (now covered by `store-write.test.ts`) |
| 7 | `api-forms/src/uploads/store.ts` | 20 | 51 % | public images (same) |
| 8 | `api-forms/src/documents/finished.ts`, `finished-service.ts` | 45 | 63 % | the finished (filled, signed) document |
| 9 | `api-forms/src/mail/ses.ts` | 15 | 69 % | live mail provider |
| 10 | `api-forms/src/signing/client.ts` | 13 | 72 % | the only caller of Sign |
| 11 | `api-forms/src/pdf/word.ts` | 12 | 57 % | Word to PDF |
| 12 | `api-forms/src/mail/send-job.ts` | 8 | 87 % | the mail job |
| 13 | `api-sign/src/routes/signer.ts` | 20 | 73 % | the signer's page: sign, decline |
| 14 | `api-sign/src/envelopes/fetch-document.ts` | 7 | 71 % | server-side fetch of a caller URL (SSRF surface) |
| 15 | `api-sign/src/envelopes/store.ts` | 8 | 91 % | the trail, the lock, the seal |
| 16 | `api-forms/src/routes/events.ts` | 18 | 78 % | event CRUD |
| 17 | `api-forms/src/routes/documents.ts` | 16 | 87 % | bulk admission documents (job restart) |
| 18 | `api-forms/src/routes/ledger.ts` | 14 | 86 % | money: entries, reversal (now 1 line short of full) |
| 19 | `api-forms/src/routes/uploads.ts` | 14 | 86 % | upload, download, paper |
| 20 | `api-forms/src/uploads/image-size.ts` | 18 | 63 % | header parser for untrusted images |
| 21 | `shared/src/forms/signature-vector.ts` | 31 | 77 % | the signing mark grammar |
| 22 | `shared/src/payable/read.ts` | 21 | 93 % | supplier invoice reader (one crash found here) |
| 23 | `shared/src/forms/validate.ts` | 25 | 87 % | every public submission is validated here |
| 24 | `api-forms/src/auth/service.ts` | 7 | 87 % | sessions (race found, fixed) |
| 25 | `api-forms/src/signing/invitations.ts` | 11 | 88 % | invitation mail with signing links |

Not worth chasing: `main.ts`, `desktop/main.ts`, `demo/main.ts`, `db/migrate.ts`, `db/seed.ts` (entry
points, 0 %), `db/schema.ts` (declarations).

## 2. Findings

Severity: critical (data loss or breach on a normal path), high (wrong result on a normal path, or
a crash a normal file can cause), medium (wrong result on a race or an edge a user can reach), low
(cosmetic, hardening, or needs an unlikely sequence).

| ID | Sev. | Where | Finding | State |
| --- | --- | --- | --- | --- |
| F-01 | high | `shared/src/payable/read.ts:582` (`readReference`) | `readInvoice` threw `TypeError: ... reading 'start'` for any invoice whose RF reference is printed as one item (`RF18539007547034`, as a PDF text layer gives it). The "which words" length came to 0 and `asRow(0)` indexed `spans[-1]`. Found by the page fuzz. | fixed + test |
| F-02 | high | `api-forms/src/pdf/arrange.ts` (`arrangePdf`) | Each plan step copied its page with its own `copyPages` call, so whatever pages share (a font, a logo) was copied once per page: reversing a 20-page, 0.5 MB PDF returned 10 MB (measured). Rearranging, extracting and merging bloat in proportion to page count. | fixed + test |
| F-03 | high (auth required) | same | A plan may name the same page 500 times: 100 copies of a 4 MB page returned 400 MB (measured); 500 copies of a 25 MB page would exhaust memory for every user of the process. | fixed (cost cap `MAX_REPEAT_BYTES` 64 MB) + test |
| F-04 | high | `shared/src/summary/check.ts:13`, `proofread.ts:146` | The "invented number" safeguard around the local model compared numbers through `Number.parseInt`, so past 2^53 two different account or reference numbers were equal (`48473254092475374476836` against `...374676836` raised no warning) and 21 digits became `1e+21`. | fixed (digit strings, no float) + test |
| F-05 | medium | `shared/src/api/send.ts:130` (`parseMinor`) | Only a leading minus was refused: `kr -55916,21`, `SEK -500`, `500-` were read as positive amounts in a batch of invoices. | fixed + test |
| F-06 | medium | `api-forms/src/db/repositories/drizzle.ts` (`ledger.post`, `revokeRefreshToken`), `routes/ledger.ts` | Two requests could both reverse the same ledger entry (check in the route, unconditional stamp in the write): the book corrected twice. Fixed with a row lock and `AlreadyReversed` (409). | fixed + tests (memory, PGlite) |
| F-07 | medium | `api-forms/src/auth/service.ts:139` | Refresh rotation was check-then-revoke: two simultaneous refreshes of one token both succeeded and forked the family, defeating reuse detection. `revokeRefreshToken` now says whether it won; the loser is treated as reuse. | fixed + test |
| F-08 | medium | `api-forms/src/db/repositories/drizzle.ts` (`nextReference` then `post`) | Two postings at once read the same "next" journal reference; the unique index refused the second and the caller got a 500. `post` now takes the next number and writes again. The comment claiming the statement prevented it was wrong. | fixed + PGlite test |
| F-09 | medium | `api-forms/src/log-redaction.ts` | The unsubscribe link `?t=<org>.<base64url address>.<mac>` and `?email=` logged the recipient's address (base64url of it) in clear: the URL is logged on every request. | fixed + test |
| F-10 | medium | `api-forms/src/send/service.ts` (`queueSends`), `send/campaign.ts` | A confirmation key used again with other recipients or words was answered with the first press's job ids (the idempotent enqueue), so the new recipients were told "queued" and no mail went. Now 409 `key-reused`. | fixed + tests |
| F-11 | medium | `api-forms/src/uploads/private-store.ts`, `uploads/store.ts` | Content-addressed write straight to the final name: a crash or full disk left a short file that every later upload of the same bytes "deduplicated" onto for ever. Now compared, written beside the name and renamed (`uploads/atomic.ts`). | fixed + tests |
| F-12 | low | `api-forms/src/pdf/shrink.ts:29` | `todo.push(...array)` overflowed the stack on a PDF holding an array of 125 000+ entries (500 from `/v1/pdf/shrink`). | fixed + test |
| F-13 | high | `apps/forms/src/lib/sniff.ts:8` | `String.fromCharCode(...tail)` with a 262 144-byte tail throws `RangeError` (limit about 120 000 on node 24): any Word file over about 120 KB is not recognised in Scan, and the two call sites have no catch. | **open, owner apps/forms** (chip raised) |
| F-14 | low | `apps/forms/src/lib/suggest-name.ts:19` | `safeName('".?...Åsa2')` leaves a leading dot (hidden file on macOS/Linux), and is not idempotent. | **open, owner apps/forms** (chip raised) |
| F-15 | low | `api-forms/src/jobs/worker.ts` (`runOnce`) | `succeed()` is inside the `try` that retries on a handler error, so a database hiccup after a mail was handed to the provider re-queues the job and the mail is sent twice (the stale-lease takeover at 15 min has the same shape and is documented). The provider `idempotencyKey` covers SES only. | open, documented |
| F-16 | low | `api-forms/src/routes/ledger.ts` (reversal date), `db/repositories/drizzle.ts` (reference year) | `new Date().toISOString().slice(0, 10)` and `getUTCFullYear()` are UTC: an entry reversed at 00:30 Stockholm time is dated the day before, and the reference year turns over at 01:00 on 1 January. The organisation has no time zone setting. | open (needs an organisation time zone) |
| F-17 | low | `api-sign/src/routes/signer.ts` (`GET /v1/sign/:token`) | Opening the link appends a `viewed` event, so a mail scanner that prefetches the link counts as the signer viewing. The audit trail says "viewed" for a robot. | open (product call: make it a POST from the page) |
| F-18 | low | `api-forms/src/routes/checkin.ts` (undo) | `DELETE /v1/events/:id/check-ins/:submissionId` checks the event but not that the submission belongs to it (same organisation only). | open, harmless |
| F-19 | low | `api-forms/src/uploads/lifecycle.ts` | The sweep checks "nothing names this key", then deletes; a new upload of the same bytes between the two is "deduplicated" onto bytes that are then deleted. | open, narrow window |
| F-20 | info | `LAUNCH-CHECKLIST.md` row 94 (audit #10) | `GET /v1/events/:id/attendance` checks the organisation, not form access. Still so, still by design (operators run the door for any event); every query carries `organisation_id` (verified in `drizzle.ts`) and `form-access.test.ts` has the cross-organisation proof. Nothing to fix; the product call stands. | verified, documented |

## 3. Non-findings (checked, nothing wrong)

- **Organisation scoping**: every route that takes an id from the URL resolves it through an
  organisation-scoped repository call before use (`events`, `forms.resolve`, `uploads.findForDownload`
  plus `resolveFormAccess`, `sendingDomains.findById`, admin user routes compare `organisationId`,
  `jobs.findById(organisation, id)`, signing requests). The unscoped calls that remain
  (`listVersions(formId)`, `countRegistrations(id)`, `saveStatus(record.id)`) follow a scoped lookup.
- **Error shapes**: the handler returns `{error:{code,message}}` for every status, hides detail on
  5xx; the new 409s use it.
- **Money**: no `parseFloat`/`toFixed`/`Number()` on an amount in `api-forms`, `api-sign` or the
  shared packages (`toFixed` in `documents/paper.ts` is a CSS percentage). `parseAmount` (payable)
  and the CSV writer round-trip 6000 random amounts exactly; IBAN/RF/OCR/Luhn: valid always
  passes, any one-digit change fails (1500 cases each).
- **Clock**: the whole `api-forms`/`shared`/`signing`/`calc` suite (4651 tests, DB-backed files
  excluded) passes with `Date` shifted a year ahead (scratch run; `faketime` is not available on Windows).
- **Path handling**: stores build keys from hashes, check the shape first, and compare resolved
  paths with a separator suffix; both Windows and POSIX work.
- **Secrets in logs**: bodies and headers are never logged; URLs are redacted by shape (F-09 was the gap).
- **pdf-guard**: 40 damaged PDFs (truncated, flipped, zeroed, junk prefix, bad `startxref`, noise)
  through arrange, fields, fill, shrink, edit and redact ended in a PDF or a refusal, never a throw.
- **Layout IR validator**: 1500 randomly damaged documents, never a throw; 2000-deep input fails by shape quickly.
- **Builder machine**: 60 random walks of 40 steps (answers, Back, breadcrumb jumps, hostile text): only
  `MachineError`s, refusals leave the conversation unchanged, replay and resume always agree,
  a publishable draft stays publishable.
- **Quoted-text rule**: for every category and language in the lexicon, any two distinct terms quote;
  a 3.4 MB text is judged in well under a second.
- **Campaign**: suppression is read at queue time and again at send time; the unsubscribe token
  verifies in constant time and is bound to organisation and address; a GET asks, only a POST records.
- **api-sign links**: HMAC, domain-separated, constant-time comparison; sealing happens in the
  completing transaction.

## 4. Tests added

| File | What |
| --- | --- |
| `packages/shared/src/payable/fuzz.test.ts` | Luhn/bankgiro/plusgiro/IBAN (all 24 countries)/RF/OCR valid-passes and single-digit-fails; amount and date print/parse round trips in 8 styles; garbage never throws; whole-page reader on random words; CSV record defanging |
| `packages/shared/src/api/fuzz.test.ts` | `parseMinor`, `parseTable` (RFC 4180, BOM, CRLF, huge rows, formula cells, unterminated quotes), `guessColumns`, `mergeText`, `oneLine`, `checkCampaign`, `renderCampaign`, `uniqueRecipients` |
| `packages/shared/src/summary/fuzz.test.ts` | number check on long numbers, proofread span verification and fixes, passage splitter and selection parser, quoted-text rule over the whole lexicon |
| `packages/shared/src/builder/fuzz.test.ts` | seeded random walks over the guided builder graph |
| `packages/shared/src/import/ir/fuzz.test.ts` | layout validator under random damage |
| `apps/api-forms/src/pdf/fuzz.test.ts`, `fuzz-ops.test.ts` | arrange plans (valid and invalid), damaged files through every PDF operation, edit/redact operation oracle, shared resources, huge arrays |
| `apps/api-forms/src/db/ledger-pglite.test.ts` | reference collision retry, second reversal refused, token revocation answer, on the embedded Postgres |
| `apps/api-forms/src/uploads/store-write.test.ts` | truncated file healed, concurrent identical writes |
| regressions | `read.test.ts` (RF as one item), `auth.test.ts` (simultaneous refresh), `ledger.test.ts` (simultaneous reversal), `send.test.ts`, `campaign.test.ts` (key reuse), `log-redaction.test.ts` (PII in URLs) |
| `scripts/fuzz-forms-libs.test.ts` | `safeName`, `suggestName`, `findDate`, address hygiene, `sniffBytes` (small tails) from `apps/forms/src/lib` |

All fuzz files use a 12-line seeded generator written in the file, are deterministic, and print
`seed=<n> <case>` on failure; `FUZZ_SEED=<n> pnpm vitest run <file>` replays. Each runs in under
5 s (the PDF file about 4 s because every parse is a guard worker thread).

## 5. Residual risks

- `drizzle.ts` is still mostly covered through the memory twin. The two repositories can drift; the
  PGlite file now pins the contended paths, but queries elsewhere are only as tested as a migrated Postgres run.
- F-13 and F-14 are open until the `apps/forms` owner lands the chips.
- F-15 to F-19 are documented, not fixed; F-16 wants an organisation time zone (a product decision).
- The job worker's stale takeover (15 min) can run a long job twice on two instances.
- Not examined in depth for lack of time: `routes/public-forms.ts` (894 lines), `routes/signing.ts`
  hook intake, `documents/finished*.ts`, `mail/ses.ts`, `sending-domains.ts` verification, `api-sign`
  `fetch-document.ts` (SSRF rules) and `sealing/`. They are the next pass.
- e2e was not run: no route contract changed beyond two new 409 answers; `pnpm test:e2e` was not
  run for them, and a green unit run is not a green e2e.

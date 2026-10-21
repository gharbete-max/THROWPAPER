# Sign and seal review, and carry-over fixes, 2026-10-21

Part A is the review of signing (`apps/api-sign`, `packages/signing`, `apps/sign`, Forms' signing
screens and routes, the PDF marks). Part B is the carry-over from the three earlier reviews. Measured
at the commits named in each part. `packages/` and `docs/CONTRACT.md` are **not** touched by Part A.

## Part A: Sign and seal (branch `claude/review-sign`, from `origin/main` at #222)

### How a seal was checked, independently

A sealed PDF is a PAdES-B-B file (`/ETSI.CAdES.detached`, RSA-SHA256, ESS signing-certificate-v2, no
claimed signing-time attribute). It is now checked by **two validators that share no code with the
signer** (the signer is pkijs and `@signpdf`):

1. **OpenSSL** (`openssl cms -verify`, 3.5.7 here, on every CI runner), over the exact `/ByteRange`
   bytes, with the seal certificate as the only trust anchor (existing, `sealing/openssl-validator.ts`).
2. **`sealing/node-verifier.ts`** (new, tests only, no dependency): `node:crypto` and a 90-line DER
   walk. It demands exactly one `/ByteRange` that starts at 0 and ends at the last byte of the file
   (OpenSSL does not care about the tail), a `<hex>` hole, the message-digest attribute equal to
   SHA-256 of the covered bytes, the ESS attribute naming the embedded certificate, an RSA signature
   over the attributes (re-tagged `[0]` to `SET`) that verifies under it, and, when given, that the
   embedded certificate is the trusted one.

`sealing/tamper.test.ts` (9 tests) passes the untouched file through both and then fails each of:
a flipped byte in the first range and in the last; a flipped bit in the signature value; an
**incremental update appended after the seal** (OpenSSL alone still says "Verification successful",
which is why coverage is checked: asserted in the test); a truncated file and one with a byte removed;
a **replaced page** and an **altered audit page** re-saved with pdf-lib (the signature object
survives, the verdict does not); another file's CMS grafted into this one; a forged second
`/ByteRange`; and a check against a certificate that did not make the seal.

### Findings

| # | Severity | Where | Finding | Status |
| --- | --- | --- | --- | --- |
| A-1 | medium | `api-sign/src/routes/signer.ts` (`GET /v1/sign/:token/document`) | The document was served to any valid link whatever the envelope's state: a link kept in a mailbox opened the file after the sender **cancelled**, after it **expired** and after a party **declined**. Cancelling did not withdraw the document. | fixed: served only while `sent` or `completed` (a signer may still read what they signed); test `signer-states.test.ts` |
| A-2 | medium | `api-sign/src/server.ts` (Fastify `maxParamLength`, default 100) and `routes/signer.ts:23` (`TokenParam` max 300) | A signing link is 81 characters plus the party id in base64url. The contract allows ids of 64 characters; any id of **15 or more** made the link answer **414**, and 64 three-byte characters made one of 337 characters, over the schema's own 300. Forms uses `p1`..`p50`, so Forms never met it; any other caller of CONTRACT §5.1 would. | fixed: `routerOptions.maxParamLength` 512, `TokenParam` 400; test with a 64-character CJK id |
| A-3 | low | `api-sign/src/envelopes/store.ts:264` | The seal's time (`/M`, the audit page's "sealed") was the time the request **began**; the last signature carries the time it was **made**. A slow request put the seal seconds before the signature it seals (measured: 2 s with a 1.5 s step clock). | fixed: never earlier than the last event; test with a stepping clock |
| A-4 | medium | `api-sign/src/identity/providers.ts` | `EID_PROVIDER=console` (confirms nobody, `environment: test`) was refused only when `NODE_ENV === 'production'`. `main.ts` defaults `NODE_ENV` to `development`, so a staging server, or a production one that forgot the variable, offered it. | fixed: allowed only when `NODE_ENV` is unset, `development` or `test` **and** `SIGN_PUBLIC_URL` / `API_SIGN_PUBLIC_URL` (when set) are loopback; test |
| A-5 | low | `api-sign/src/envelopes/fetch-document.ts:38` | The body of the caller's document was buffered whole (`arrayBuffer()`) before the 25 MB cap was applied; an allowed origin that streams without a `Content-Length` could hold memory (a known `ponytail:` note). | fixed: counted as it arrives, cut off at the cap; test counts the chunks pulled (501 before, under 33 after) |
| A-6 | low | `api-sign/src/local/start.ts` (`loadOrCreateSecrets`) | The desktop's self-issued seal certificate lives two years and nothing renewed it: after that every new seal is "made with an expired certificate" to a validator. Only an unreadable certificate was replaced. | fixed: replaced when expired or within 30 days of its end (`usableCertificate`); old seals carry their own copy; test |
| A-7 | low | `api-sign/src/envelopes/store.ts` (`append`) | Event times are the server clock's and are not checked to be non-decreasing; a clock that steps back (NTP) writes a trail whose times go backwards. The chain order (seq, hashes) is unaffected. There is no drift job: time is the server's `Date`, never the client's (`SignRequest` is `.strict()`), and a trustworthy time needs an RFC 3161 timestamp, a later purchase (ADR 0009). | open, documented; a clamp would make `signedAt` in the evidence disagree with `at` |
| A-8 | low | `api-sign/src/rate-limit.ts` | Rate limits are keyed on the credential, which is right behind a proxy, but a flood of **forged** links gets a fresh bucket each. A forged link costs one HMAC and a 404 (it fails before any database read), so there is no amplification; the limiter's store is an LRU. | accepted |
| A-9 | low | `api-forms/src/routes/signing.ts` (`send-signed`) | The signed-copy job key includes the press's timestamp, so two presses (a double click) queue two mails per signer. Deliberate for a re-send; an unintended double click is not distinguished. The press needs a confirmation in the UI. | open (product call: ask again when `signedCopyQueuedAt` is set) |
| A-10 | info | `api-forms/src/pdf/arrange.ts` (`SIGNATURE_MARKER`) | A PDF is called signed when it contains the bytes `/ByteRange`. A name written with a hex escape (`/Byte#52ange`) would not match, and placing marks would silently drop that signature. Every real signer writes the plain name; this is a user-protection check, not a security boundary. | accepted |
| A-11 | info | `api-sign/src/routes/identity.ts` | Identity sessions are in memory and unbounded (a test double's behaviour); a real provider brings its own store (noted in the file). | accepted |

### Verified, no change

- **Hash chain and append-only**: each event is `sha256(prev + "\n" + event)` from the definition's hash; `withEnvelope` re-verifies the whole chain, the definition, the seq numbers and a replay of every event on **each** read, and refuses with `TrailBroken`. UPDATE, DELETE and TRUNCATE are refused by trigger (tests exist: a trigger switched off, a rewritten signature are both caught).
- **Ordering under concurrency**: `SELECT … FOR UPDATE` on the envelope row. Existing: two simultaneous signatures give one 200 and one 409, seq `[1, 2]`. New: twelve simultaneous opens of one link record `viewed` exactly once.
- **Replay and states**: new test over declined, completed, cancelled and expired envelopes: the link still shows the state (200, `maySign: false`), refuses sign and decline with 409, and a replayed link leaves no event.
- **Links**: `<envelope>.<party base64url>.<HMAC-SHA256 of both, 256 bits>`, derived, so nothing about a link is stored (there is no hash at rest to leak; the secret is `SIGN_LINK_SECRET`, at least 32 characters, required, never defaulted; on the desktop 32 random bytes in `secrets.json`). Comparison is `timingSafeEqual` after a length check, for signing and sealed links (domain-separated, expiry inside the MAC). Hooks to Forms are signed with HMAC and compared in constant time. Service tokens are looked up by SHA-256.
- **Rate limits**: 20 a minute on sign and decline per link, 600 a minute overall per credential; `/health` unlimited.
- **Keys**: the seal key is imported non-extractable; `SIGN_SEAL_EPHEMERAL` is refused in production; the key/certificate pair is proven to match before use; request logs carry the URL with links redacted (`log-redaction.ts`) and 500s answer a fixed body. Desktop `secrets.json` is written aside and renamed, mode 0600 (no effect on Windows; the data folder is the user's), and the backup skips it and carries it only passphrase-sealed (`apps/desktop/src/main/backup.ts`).
- **Uploads to Sign**: 25 MB cap, `%PDF-` check, the SSRF rules (exact listed origin, no redirects, no credentials in the URL), then a trial parse in a worker with a 5 s and 256 MB budget before the main thread opens it (the 2.9 MB bomb test exists), then it must be sealable. A caller must hold a token to reach any of it.
- **Placement and marks (#184)**: `sign-placement.ts` has the seen/PDF-space arithmetic for all four turns and agrees with pdf.js in its test; a PDF that carries a `/ByteRange` is refused by `/v1/pdf/edit`, redact and arrange unless the person accepts losing the signature (tests exist).
- **Signed-copy mail**: fetched through §5.3, hash-checked against the link's answer, attached as `…-signed.pdf` with a sanitised name, one job per signer with an address, `test` envelopes say so in the mail.

### Tests added (Part A)

`api-sign`: 113 to 131 tests. `sealing/tamper.test.ts` (9), `routes/signer-states.test.ts` (5, on Postgres),
`envelopes/fetch-document.test.ts` (2), and one each in `identity/identity.test.ts` and
`local/start.test.ts`.

## Part B: carry-over fixes (branch `claude/carryover-fixes`)

**Touches `packages/`** (not `docs/CONTRACT.md`): `packages/shared/src/forms/api.ts` (`CreateForm` takes an optional `id`) and `packages/tokens` (`media.ts`, `media-stats.json`, `media-contrast.test.ts`, one export line in `index.ts`). `pnpm contract:check` passes.

| # | From | What | Where | Test |
| --- | --- | --- | --- | --- |
| B-1 | desktop-ai #16 (medium) | `open()` called twice at once opened **two** LAN listeners; the first was never closed and had no idle check. Now one start at a time (`opening`), and `close()` waits for an open in flight. | `api-forms/src/desktop/phone-relay.ts` | `phone-relay.test.ts`: three concurrent opens give one origin and one listener (`TCPServerWrap` count), closing during an open leaves none, reopen after close |
| B-2 | desktop-ai #17 (low) | The mail program's script timing out (120 s) is no longer "did not send": Outlook may still send it, and the worker would retry and duplicate it. `runScript` reports `timedOut`; the provider throws `UnknownOutcome`; the worker fails that job **at once, with no retry**, message `unknown outcome — check classic Outlook: it did not answer in time, and may still have sent the message`. Same for Outlook for Mac and Apple Mail. | `mail/outlook.ts`, `jobs/worker.ts` | `outlook.test.ts` (fake runner on both platforms; the real runner against a 300 ms timeout), `worker.test.ts` (one run, status `failed`, attempts left, nothing due) |
| B-3 | forms-ui M3 | "Start from questions" no longer makes a form. It opens `/forms/<new uuid>/guided` (router state `fresh`), the conversation starts blank, and the **first answer** makes the form under that id (`POST /v1/forms` takes an optional `id`; taken gives 409 `id-taken`). Leaving first leaves nothing. "Open the editor" before an answer makes it then. The paper door still makes its form at once (the editor needs one). Older leftovers: a line above My forms offers to move **my** empty drafts (draft, never published, no answers, not shared, no event, `form-…` address, definition equal to the empty one) **older than 24 h** to the bin, after a confirmation; the bin is reversible. Twelve catalogues. | `Forms.tsx`, `GuidedBuilder.tsx`, `saver.ts`, `lib/abandoned-drafts.ts`, `routes/forms.ts`, repositories | `saver.test.ts` (made once, before the first save; a failed creation is retried), `abandoned-drafts.test.ts`, `create-with-id.test.ts`, e2e `abandoned-starts.spec.ts` (nothing in the database after leaving; the first answer makes the form; the offer, cancel, confirm) |
| B-4 | forms-ui M6 | `mark-loop-256.webp` (1,119,628 B) was fetched by every web `Loading`. `Loading` now draws `docs/brand/css/loppa-spinner.svg` (1,467 B, `apps/forms/public/loppa-spinner.svg`, stops itself under reduced motion). The loop stays for the intro, which mounts it only when it plays (first visit, motion allowed); the phone-scan relay also passes the new file. The brand `animation/` webp files were not used: they are LFS pointers in this checkout (loppa-128 is 450 KB, loppa-256 1.09 MB), still far too heavy for a 40 px spinner. | `Loading.tsx`, `phone-relay.ts` | `loading.test.ts` |
| B-5 | forms-ui, outside scope | Scrim and chip contrast over the shipped photographs, in both themes (below). | `packages/tokens` | `media-contrast.test.ts` (53) |
| B-6 | forms-ui L6 | The two links that stand alone (Set up AI to Summary, Summary to Set up AI) are `.link--target`: 24 px minimum, 20 px before at 360 px. One rule at the end of the lazy `styles/app.css`. | `AiSetup.tsx`, `Summary.tsx`, `styles/app.css` | e2e `link-targets.spec.ts` (measured at 360 px) |

### B-4 measured

Signed in, `/forms` opened on a throttled connection (1.5 Mbit, 300 ms), intro already seen, every byte the page received (Chromium, `Network.emulateNetworkConditions`; a scratch spec, not committed):

| | images fetched | total |
| --- | --- | --- |
| before | `mark-angled-256.png` 23,936 + `mark-loop-256.webp` 1,119,628 | **1,996,650 B** |
| after | `mark-angled-256.png` 23,936 + `loppa-spinner.svg` 1,467 (twice: two spinners) | **880,045 B** |

Saved 1,116,605 B (56 %) on the first signed-in screen, and the same on every cold screen that waits. The signed-out web entry (the site hero) still plays `mark-loop-256.webp` through its `<picture>` (`hero-motion.test.ts` governs it): that is the next 1.1 MB, and a product call.

### B-5: what was chosen

No photograph has text written over it today (MEDIA.md: "nothing is written over a picture"), so there was no scrim or chip to measure. The guard is therefore forward-looking and fixes the numbers the first one must use:

- `packages/tokens/src/media.ts`: the scrim is black, 0.6 at its strongest end (full from two thirds of the picture's height down), text `#ffffff`; the chip is the theme's background at 0.88 with the theme's text; the dark theme dims a picture by 0.82 (the test also reads `styles.css` for that number).
- **No decoder, no dependency.** Decoding WebP in a test needs one, so `python scripts/media-process.py --stats` (Pillow and numpy, already the tool for these files; neither is a repository dependency) reads the *shipped* WebP files and commits `packages/tokens/src/media-stats.json`: for each of the twelve, its SHA-256 and the brightest and darkest pixel, whole and in the bottom third. The test fails if a picture's hash differs from its statistics, so they cannot go stale.
- The test composites the scrim, or the chip, over those pixels in sRGB as a browser does, in the light theme and in `toDark(defaultTokens)`, and asks for 4.5:1 with `contrast.ts`. It also proves the guard bites (a 0.3 scrim and a 0.3 chip fail) and that 0.6 holds for pure white, so for any picture. All twelve pass in both themes. Every picture has a pure white and a pure black pixel somewhere, so the worst case is the same for all; the least scrim that works for white text is about 0.54.

### Bundle (B-6 and the rest)

Total 1249.2 to 1251.2 KB of 1250 with the new words (two messages in twelve catalogues), the rule and the spinner: over. Cut first, as asked: seven catalogue keys that nothing references (`ai.models.unavailable`, `…unavailableWhy`, `…unverifiedLicence`, `…needs`, `read.proofread`, `docs.reading`, `docs.noText`), removed from all twelve files. Final: **entry 6.7 of 12, stylesheet 11.8 of 14.5, total 1248.9 of 1250 KB** (the rule went in the lazy file, so the entry stylesheet did not move).

Gates on the merged branch: format, typecheck, lint (2 existing warnings), test 7778, build, bundle:budget, contract:check, licence:check, builder:validate; full `pnpm test:e2e` 178 of 178 (13.0 min, under the lock).

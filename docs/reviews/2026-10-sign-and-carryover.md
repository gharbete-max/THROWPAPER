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

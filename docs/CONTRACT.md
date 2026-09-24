# Integration contract — Forms ⇄ Mailer ⇄ Sign

**Freeze this before either track writes code.** Both tracks build against it with a mock of the
other side, so neither blocks the other. Changes to this file are a joint decision and require
a version bump.

Schemas live in `packages/shared/src/contract/`. `pnpm contract:check` validates all three
backends against them. Version header on every request: `X-Contract-Version: 2`.

**Version 2 (2026-09-23)** added §5, the Sign product (`docs/adr/0009-where-signing-lives.md`),
by the owner's decision. It is additive: every v1 request is still valid.

Auth between the products is a service token issued per organisation, scoped to the endpoints
below. A customer running only one product never sees any of this.

---

## 1. Forms → Mailer

### `POST /v1/messages` — send one transactional email
Used for form confirmations, admin notifications and document delivery.

```
{
  organisationId, templateKey, locale,
  to: { email, name?, contactRef? },
  mergeData: { ...arbitrary JSON, validated against the template's declared fields },
  attachments?: [{ filename, mimeType, url | base64 }],
  idempotencyKey,          // required — retries must not double-send
  category: "transactional"
}
→ 202 { messageId, status: "queued" }
```

Transactional messages bypass marketing suppression but respect hard bounces and the global
block list. Mailer rejects a message whose `category` is transactional but whose template is
marked marketing.

### `POST /v1/contacts/upsert` — sync people
Idempotent on `contactRef`. Sends email, name, preferred locale, tags and custom fields. Never
sends consent status — consent is Mailer's record, not Forms'.

### `POST /v1/audiences/{key}/members` — push a computed audience
Forms computes an audience from its own data (registered but not attended, inspection due,
result outside range) and pushes the member list with per-member merge data. Mailer stores it
as a static audience snapshot with a timestamp.

### `GET /v1/templates` — list template keys and their declared merge fields
So Forms' admin UI can offer real templates rather than a free-text key.

---

## 2. Mailer → Forms

### `GET /v1/audiences/{key}/members` — pull a live audience
The alternative to pushing. Mailer calls this at send time so a recurring campaign always uses
current data. Paginated, returns `{ contactRef, email, locale, mergeData }`.

### Webhook `POST {forms}/hooks/delivery` — delivery events
`{ messageId, contactRef, event: delivered|bounced|complained|opened|clicked, at }`.
Forms uses this to show "confirmation delivered" on a registration and to flag bad addresses.

---

## 3. Shared, but not through the API

- `packages/tokens` — both products import the same brand tokens so a customer running both sees
  one brand. Forms compiles them to CSS; Mailer compiles them to inline email styles.
- `packages/i18n` — one translation catalogue, one locale fallback chain.
- Identity — optional single sign-on. If both are deployed for one customer, one login covers
  both; if only one is deployed, it authenticates alone.

## 4. Standalone fallbacks

- Forms with no mailer configured sends via direct SMTP using a minimal built-in template
  renderer. Feature-poor on purpose — it is a fallback, not a second mailer.
- Mailer with no Forms imports audiences from CSV/XLSX and uses its own hosted signup and
  preference pages.

Neither fallback may be allowed to rot. CI runs the standalone configuration of each product.

---

## 5. Forms ⇄ Sign

Sign is the third product: envelopes, eID, multi-party signing and sealed PDFs. Identity data and
evidence live only in its own database. Shapes come from `@tp/signing`. §5.1 and §5.2 are implemented (P1c-1), §5.3 in P1c-2, §5.4 in P1c-3, §5.5 with the declaration editor.

### `POST /v1/envelopes` — ask for a document to be signed (§5.1)
```
{ organisationId, documentName, documentUrl, documentSha256, parties: [{ id, name, email?, locale, order }],
  routing: "sequential" | "parallel", expiresAt, declarationKey, environment: "test" | "production",
  hookUrl?, idempotencyKey }
→ 201 { envelopeId, status, signUrls: { [partyId]: url } }
```
`environment` defaults to `test`. Sign fetches the document once from `documentUrl`, hashes it,
and refuses a mismatch with `documentSha256`. `declarationKey` names a human-authored declaration
(ADR 0012) — never the text.

### `GET /v1/envelopes/{id}` — where it stands (§5.2)
### `GET /v1/envelopes/{id}/sealed` — the sealed PDF as a short-lived link, once complete (§5.3)
```
→ 200 { envelopeId, url, sealedSha256, expiresAt }      409 until the envelope is completed
```
`url` opens the sealed file for ten minutes and needs no token; the expiry is inside its MAC.
`sealedSha256` is the hash of the sealed file, not of the document: the audit page and the seal are
part of it. The file carries a PAdES (`ETSI.CAdES.detached`) seal over every byte but its own, and
the document's original SHA-256 on the audit page.

### Webhook `POST {caller}/hooks/signing` — envelope events (§5.4)
`{ envelopeId, partyId?, event: sent|viewed|signed|declined|expired|cancelled|completed, at }`.

One POST per event, in order, after it is committed, to the `hookUrl` the envelope was created
with (its origin must be on the token's allow-list). Signed:
`x-loppa-signature: sha256=<hex HMAC-SHA256(key = hex SHA-256 of the service token, raw body)>`
— Sign keeps only the token's hash, so the hash is the key; the caller computes it from the token
it holds and refuses a mismatch. `completed` is sent when the last signature completes the
envelope. **A hook is a hint, not the record:** delivery is retried a few times and may be lost,
so on a hook the caller reads §5.2 rather than trusting the body. No redirects are followed.
Invitations and reminders are the caller's to send, never Sign's: when a party's status becomes
`invited` the caller emails that party its `signUrls` link. Forms does this through its own mail
provider (direct SMTP, or the desktop's outbox in test mode — rule 2) until Mailer is connected,
when they go through `POST /v1/messages` like any other sender.

### `GET /v1/declarations` · `POST /v1/declarations` — the words a signer approves (§5.5)
```
GET  → 200 { declarations: [{ key, version, texts: { [locale]: text }, authored, shared }] }
POST { organisationId, key, texts: { [locale]: text } } → 201 { key, version, texts, authored, shared }
```
The latest version of each declaration the caller's organisation may use: its own, and the shared
test-only placeholders (`shared: true, authored: false`); an own key hides a shared one. `POST`
stores a new version of the caller's own declaration **exactly as a person typed it** — Loppa never
writes, suggests or completes these words (CLAUDE.md rule 8). `key` is `[a-z0-9][a-z0-9._-]{0,63}`;
each text is 1–5000 characters; at least one locale. 403 when `organisationId` is not the token's.
Versions are append-only: an envelope pins the version it was created with and keeps those words.
§5.1 resolves `declarationKey` to the caller's own declaration first, then a shared one; a
production envelope needs an authored one, and every party's `locale` must have text.

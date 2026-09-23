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
evidence live only in its own database. Shapes come from `@tp/signing`. **All deferred to P1c.**

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

### Webhook `POST {caller}/hooks/signing` — envelope events (§5.4)
`{ envelopeId, partyId?, event: sent|viewed|signed|declined|expired|cancelled|completed, at }`.
Invitations and reminders go through `POST /v1/messages` like any other sender.

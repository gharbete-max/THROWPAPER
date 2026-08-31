# Integration contract — Formwork ⇄ Sendwork

**Freeze this before either track writes code.** Both tracks build against it with a mock of the
other side, so neither blocks the other. Changes to this file are a joint decision and require
a version bump.

Schemas live in `packages/shared/contract/`. `pnpm contract:check` validates both
implementations against them. Version header on every request: `X-Contract-Version: 1`.

Auth between the products is a service token issued per organisation, scoped to the endpoints
below. A customer running only one product never sees any of this.

---

## 1. Formwork → Sendwork

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
block list. Sendwork rejects a message whose `category` is transactional but whose template is
marked marketing.

### `POST /v1/contacts/upsert` — sync people
Idempotent on `contactRef`. Sends email, name, preferred locale, tags and custom fields. Never
sends consent status — consent is Sendwork's record, not Formwork's.

### `POST /v1/audiences/{key}/members` — push a computed audience
Formwork computes an audience from its own data (registered but not attended, inspection due,
result outside range) and pushes the member list with per-member merge data. Sendwork stores it
as a static audience snapshot with a timestamp.

### `GET /v1/templates` — list template keys and their declared merge fields
So Formwork's admin UI can offer real templates rather than a free-text key.

---

## 2. Sendwork → Formwork

### `GET /v1/audiences/{key}/members` — pull a live audience
The alternative to pushing. Sendwork calls this at send time so a recurring campaign always uses
current data. Paginated, returns `{ contactRef, email, locale, mergeData }`.

### Webhook `POST {formwork}/hooks/delivery` — delivery events
`{ messageId, contactRef, event: delivered|bounced|complained|opened|clicked, at }`.
Formwork uses this to show "confirmation delivered" on a registration and to flag bad addresses.

---

## 3. Shared, but not through the API

- `packages/tokens` — both products import the same brand tokens so a customer running both sees
  one brand. Formwork compiles them to CSS; Sendwork compiles them to inline email styles.
- `packages/i18n` — one translation catalogue, one locale fallback chain.
- Identity — optional single sign-on. If both are deployed for one customer, one login covers
  both; if only one is deployed, it authenticates alone.

## 4. Standalone fallbacks

- Formwork with no mailer configured sends via direct SMTP using a minimal built-in template
  renderer. Feature-poor on purpose — it is a fallback, not a second mailer.
- Sendwork with no Formwork imports audiences from CSV/XLSX and uses its own hosted signup and
  preference pages.

Neither fallback may be allowed to rot. CI runs the standalone configuration of each product.

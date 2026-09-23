# Expansion — Phase 0: gap analysis, contract proposal, open questions

**Status:** proposed, awaiting the owner's approval. No feature code has been written.
**Measured at:** `63963ea` (`main`, 2026-09-23). Any `git switch` invalidates the file references
below (`CLAUDE.md` § Never mistake a proxy for the thing).
**Touches `packages/` or `docs/CONTRACT.md`?** Not yet. This phase *proposes* a new
`packages/signing` (ADR 0009) and a contract v2 (§3 below). Both are cross-track changes and
neither is made until approved.

The brief being reconciled is the owner's "Loppa — expansion megaprompt" of 2026-09-23. The
decisions it asks for are ADRs 0009–0015. The phases are in `docs/ROADMAP.md` § Expansion. The
decisions only the owner can make are in `LAUNCH-CHECKLIST.md` §6.

---

## 1. Where the brief and the repo disagree

The brief says the repo's documents win and conflicts are to be flagged, not settled silently.
These are the ones that matter, most consequential first.

1. **Sequencing against `START-HERE.md`.** START-HERE says it wins over every other plan and puts
   *"e-signing of any kind"* explicitly out of v0.1. v0.1's only criterion that matters — *"your
   first real user runs one real event on it"* — has not happened, and launch is blocked on owner
   facts (`LAUNCH-CHECKLIST.md` §1). The expansion either waits for that, runs beside it, or
   replaces it as the plan. **That is the first open question (§5, Q1).**
2. **The README says "not legal".** Signing with national eIDs is the most legal thing this product
   would do. ADR 0009 proposes containing it; the README's positioning line has to change with it,
   and that is the owner's wording.
3. **`SPEC-forms.md` §8 forbids calling approvals signatures** until a provider is contracted —
   but a `signature` field already ships (`packages/shared/src/forms/definition.ts`,
   `apps/forms/src/components/SignaturePad.tsx`). This conflict predates the brief.
4. **A ledger already exists and is marketed** (`packages/calc/src/ledger.ts`,
   `apps/api-forms/src/routes/ledger.ts`, site copy *"A ledger you cannot edit"*), while the brief,
   the README and `SPEC-forms.md` §8 all say Loppa keeps no ledger. ADR 0011 gives three options.
5. **AI field detection re-opens accepted ADR 0004**, which rules that OCR *never creates a field*.
   ADR 0013 keeps that as the default and makes AI mapping an explicit, opt-in draft that a human
   still accepts field by field.
6. **Adapters in `@tp/shared`** (brief §3.2) would ship credential-handling code to the browser,
   because `@tp/shared` is imported by `apps/forms`. ADR 0010 puts the interface in a shared
   package and the adapters server-side.
7. **"Mailer extensions"** assume a Mailer. `MODULE-STATUS.md` §4 measured it: 125 lines, 0 tests,
   0 tables, one `/health` route. P3 is mostly *building Mailer* (B2–B11), not extending it.
8. **Six locales "from day one"** — already exceeded: the product ships twelve including all six
   (`packages/i18n/src/locales.ts`, `apps/forms/src/lib/messages/`). No work.
9. **"Take freely from open source"** meets a repo with **no `LICENSE`** and signing projects that
   are AGPL. ADR 0015; §5, Q3.

---

## 2. Gap analysis — what exists against the vision

"Exists" means code in `main` with tests, not a spec paragraph.

| Vision item | Exists | Gap |
| --- | --- | --- |
| **§1.1 Custom choice controls** | A15a/b done: `single_select`/`multi_select`/`yes_no` render as dropdown, radios, buttons or cards, each a `fieldset` + `legend` with real inputs; optional image per choice; colour from the brand kit. Locked accessibility floor proven against six hostile kits (`packages/tokens/src/locked.test.ts`, ADR 0001) | Author-chosen **shapes, icons, sizes, per-field colour**; a column layout hint (A15 "remaining"). ADR 0001's layer 3 (form theme) is still *proposed*. Every new knob must go through the derived tokens so the floor holds |
| **§1.1 Hand signature** | Drawn or typed `signature` field; stored as a **PNG** in the private store; `DrawingPad.tsx` already captures SVG paths for decorations; submissions reference `form_version_id` | Store the **vector path** beside the PNG (no timing/pressure — ADR 0009); bind to a **document hash**, not only a form version |
| **§1.1 eID signing** | `SigningProvider` seam with mandatory `kind` on provider and evidence; console + unconfigured providers only (`apps/api-forms/src/signing/provider.ts`) | Everything real: `IdentityProvider`, broker adapter, levels, sessions, app-switch (ADRs 0009, 0010) |
| **§1.1 Sealed PDF + audit trail** | Chromium PDF rendering for admission cards, invoices and paper overlays (`apps/api-forms/src/documents/`); `pdf-lib`; an audit log (`apps/api-forms/src/audit.ts`) | PAdES seal, SHA-256 document hash, audit-trail page, immutability of signed versions, a sealing certificate and a timestamp authority |
| **§1.1 Multi-party** | — | Envelope model, order, parallel/sequential, reminders via Mailer, expiry, decline |
| **§1.2 Rent notices / invoices** | Built **in Forms**: invoices with bigint amounts and per-line VAT at the author's rate, Swedish OCR references with length + Luhn check digit, charge catalogue and standing charges, public invoice page and PDF (`packages/shared/src/invoicing/`, `routes/invoices.ts`, `routes/public-invoices.ts`) | No code that emails an invoice was found (`apps/api-forms/src/mail/` has none). No Mailer to send through. Boundary: ADR 0011 |
| **§1.2 Admission cards + QR + check-in** | **Done for v0.1**: signed QR token (`documents/qr-token.ts`), revocation (`checkin/service.ts`, `revokedAt`), idempotent door with an offline banner (`screens/CheckIn.tsx`), e2e `check-in.spec.ts` | Sending the card through **Mailer**; **offline-tolerant** scanning with later sync; an app screen (ADR 0014); the door's recent-arrivals-vanish-on-reload row (`LAUNCH-CHECKLIST.md` §2.3) |
| **§1.2 Recurring sends** | Standing charges recur on the Forms side | Mailer B10 (recurring schedules, draft + approval) not built |
| **§1.2 Mass mailing** | Transactional sending in Forms (`apps/api-forms/src/mail/`, SES, domain verification with SPF/DKIM/DMARC) | Mailer B2–B14. Contract 0/6 implemented (`pnpm contract:check`) |
| **§1.3 Scanner** | **Capture exists** (`MODULE-STATUS.md` §6): photo import, manual corner handles + projective warp (`screens/builder/paper/warp.ts`), in-browser tesseract.js OCR offering labels, AcroForm importer, answers written back onto the original PDF (`documents/paper.ts`) | **Automatic** edge detection and clean-up; native scanner; handwriting (ADR 0007, unwritten); AI field detection (ADR 0013); e2e coverage (none today) |
| **§1.4 AI** | — | Everything (ADR 0013) |
| **§1.4 Enterprise** | Bearer + refresh auth, magic link only; `/openapi.json` from `@fastify/swagger`; per-route rate limits (`@fastify/rate-limit`) | SSO (SAML/OIDC), SCIM, webhooks with signing + retries, API keys per org, a *documented* public API, connectors, MCP server |
| **§1.5 Web + app** | PWA (`vite-plugin-pwa`), native token compiler (`packages/tokens/src/compile-native.ts`) | **No native app exists** — no Expo, no Capacitor, no `ios/`/`android/` (ADR 0014) |
| **§3.7 White-label, dark/light, brand** | Client mode is server-first (`documents/client-identity.ts`), dark derived, gold/platinum palette pinned by `loppa.test.ts` | Apply to each new surface as it is built — signing page, sealed PDF, scanner UI |
| **§3.7 i18n** | 12 locales, ICU collation | None for the six named |
| **§3.7 GDPR** | No cookies, no external origins; retention periods are an **open owner item** (`LAUNCH-CHECKLIST.md` §1.1) and nothing is deleted on a schedule | Retention jobs, per-org export and deletion (A14/B14), encrypted identity data (ADR 0009) |

**Inventory notes.** `e2e/` has six specs, all driving Forms. `.claude/` holds only
`launch.json` — no agents, no rules, no worktrees in this checkout.

---

## 3. Proposed `docs/CONTRACT.md` changes (v2)

The contract is frozen and changes are a joint decision with a version bump. **None of this is
applied.** It is additive — every v1 request stays valid — so v2 can be served beside v1.

```diff
-Version header on every request: `X-Contract-Version: 1`.
+Version header on every request: `X-Contract-Version: 1` or `2`. v2 is a superset; a v1 request
+is valid v2. A server that does not speak v2 answers 400 `contract-version-unsupported`.

 ### `POST /v1/messages` — send one transactional email
 {
   organisationId, templateKey, locale,
   to: { email, name?, contactRef? },
   mergeData: { ... },
   attachments?: [{ filename, mimeType, url | base64 }],
+  documents?: [{                       // v2 — a per-recipient document, linked rather than attached
+    kind: "invoice" | "rent-notice" | "admission-card" | "signing-invitation" | "signed-copy" | "other",
+    url,                                // Forms-served, signed, expiring
+    expiresAt, sha256, filename
+  }],
+  mode: "live" | "test",               // v2 — default "live". "test" delivers only to the
+                                        // organisation's verified test addresses and stamps the subject
   idempotencyKey,
-  category: "transactional"
+  category: "transactional",
+  segment?: "rent" | "events" | "signing"   // v2 — which suppression scope applies (SPEC-mailer §3)
 }

 ### `POST /v1/audiences/{key}/members` — push a computed audience
+Each member may carry `documents[]` (same shape as above). Used for an invoice or rent run: Forms
+confirms the run, then pushes one member per recipient with a link to their own PDF. Mailer's
+campaign still needs its own confirmation before it sends.

+### `POST /v1/batches` — v2, send one template to many recipients, each with their own documents
+{ organisationId, templateKey, segment, mode, idempotencyKey,
+  recipients: [{ to, locale, mergeData, documents? }] }   // ≤ 1,000 per call
+→ 202 { batchId, accepted, rejected: [{ index, code }] }
+Mailer returns a draft batch; nothing sends until an operator confirms it in Mailer, or the call
+carries a `confirmationRef` from a confirmation step Forms recorded. Test mode as above.

 ## 2. Mailer → Forms
+### `GET /v1/documents/{ref}` — v2, fetch one document at send time
+Signed, short-lived URL semantics; returns the PDF bytes or 410 if revoked (e.g. a cancelled
+admission card, a voided invoice). Mailer calls this rather than caching bytes, so a revocation
+between confirmation and send is honoured.

 ### Webhook `POST {forms}/hooks/delivery`
-`{ messageId, contactRef, event: delivered|bounced|complained|opened|clicked, at }`
+`{ messageId, contactRef, event: delivered|bounced|complained|opened|clicked, at, batchId? }`

+## 5. Signing — reserved, deferred
+Signing runs inside api-forms in its own schema (ADR 0009). If it is extracted to `api-sign`, its
+endpoints (create envelope, party status, fetch sealed document, evidence) are specified here and
+versioned with this file. Reminders and invitations already go through `POST /v1/messages` with
+`segment: "signing"`.
```

Implementation order when approved: schemas in `packages/shared/src/contract/`, entries in
`manifest.ts` marked `deferred`, `pnpm contract:check` green, then each side implements.

---

## 4. What the brief asked for, and where it now is

| Asked | Where |
| --- | --- |
| Gap analysis | §2 above |
| ADR: where signing lives + levels + sealing | `docs/adr/0009-where-signing-lives.md` |
| ADR: eID broker | `docs/adr/0010-eid-through-a-broker.md` |
| ADR: invoicing/rent boundary | `docs/adr/0011-documents-not-accounting.md` |
| ADR: no generated legal wording | `docs/adr/0012-human-authored-wording.md` |
| ADR: AI data processing | `docs/adr/0013-ai-data-processing.md` |
| ADR: mobile stack | `docs/adr/0014-mobile-stack.md` |
| (added) ADR: open-source reuse and licence | `docs/adr/0015-reusing-open-source.md` |
| Contract diff | §3 above |
| Roadmap | `docs/ROADMAP.md` § Expansion |
| Owner decisions | `LAUNCH-CHECKLIST.md` §6 |

ADR numbers 0007 and 0008 are left free: `HANDOVER.md` already reserves them for handwriting OCR
and Reports.

---

## 5. Open questions — only the ones that block P1

1. **Sequence.** Does the expansion start now, beside the v0.1 launch blockers, or after the first
   real event? START-HERE says after; the brief implies now. *Blocks: whether P1 starts.*
2. **Where signing lives.** Approve ADR 0009's recommendation (package + own schema inside
   api-forms, extract later), or go straight to a third product? *Blocks: P1's file layout.*
3. **The repository's licence.** Permissive, AGPL, or source-available/proprietary? *Blocks: whether
   any AGPL signing code (Documenso, DocuSeal, OpenSign) can be reused, and which licence header
   copied files carry.*
4. **The shipped word "signature".** Keep calling the drawn field a signature (and let counsel
   word the level labels), or follow `SPEC-forms.md` §8 and rename it in the UI until a provider is
   contracted? *Blocks: P1's UI copy.*
5. **New dependencies for P1:** `@signpdf/signpdf`, `pkijs`/`asn1js`, `perfect-freehand` (all
   permissive). Approve? *Blocks: P1's sealing half.*

Not blocking P1, but needed before their phases: the broker (P2), the ledger option in ADR 0011
(P3), the AI provider (P5), app-store accounts (P4), and everything else in `LAUNCH-CHECKLIST.md` §6.

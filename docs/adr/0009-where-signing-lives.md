# ADR 0009 — Where signing lives, and what a signature is allowed to call itself

**Status:** proposed
**Date:** 2026-09-23
**Touches:** `packages/` (a new `packages/signing`), `docs/CONTRACT.md` (a reserved, deferred
section). Both are cross-track events.

## Context

The expansion brief (2026-09-23) makes signing the reason Loppa exists: any form, signed by hand
or with a national eID, sealed into a tamper-evident PDF with an audit trail.

Three things already in the repo decide more of this than the brief assumes:

- **The seam exists.** `apps/api-forms/src/signing/provider.ts` defines `SigningProvider` with a
  mandatory `kind` (`agreement` | `identity` | `drawn`) on the provider and on the evidence. Its
  header already makes the argument this ADR needs: agreement services and identity services are
  different shapes, and a record that cannot say which one produced it is worthless to an auditor.
  Only a console and an unconfigured provider exist.
- **A signature field ships.** `packages/shared/src/forms/definition.ts` (`type: 'signature'`),
  drawn or typed, captured by `apps/forms/src/components/SignaturePad.tsx` — **as a PNG** in the
  private upload store. The brief asks for vector. `DrawingPad.tsx` already captures SVG paths for
  decorations; the signature pad rasterises them on purpose so a signature behaves like a file.
- **The spec forbids the word.** `SPEC-forms.md` §8: until a real provider is contracted,
  approvals are *"recorded consent with an audit trail, and the UI must never call them
  signatures."* The shipped field is called a signature. That is a conflict already in `main`, not
  one this brief creates, and it is the owner's and counsel's to resolve (`LAUNCH-CHECKLIST.md` §6).

The README's line — *"deliberately unregulated — not accounting, not clinical, not legal"* — is
the other constraint. Legally meaningful signing brings in eIDAS (Regulation (EU) No 910/2014 as
amended by 2024/1183), identity-number handling (a personnummer, a CPR number) and, if qualified
signatures are ever offered, trust-service rules. None of that is code; all of it changes where
the code should sit.

## Options

**(a) Inside Forms.** Signing is a feature of `api-forms`: envelopes, parties and evidence become
tables beside submissions.

- For: fastest. One deployment, one database, the seam is already there, and the thing being signed
  (a submission, an invoice, a paper overlay) is already a Forms object.
- Against: identity data — national ID numbers, eID assertions — lands in the same schema as
  everything else, under the same access paths and the same backups. The 74 existing routes were
  traced for cross-organisation IDOR once (`HANDOVER.md`); every new route touching identity data
  would have to be traced again, forever, beside them. And Mailer cannot use signing without
  importing Forms, which rule 1 forbids.

**(b) A shared package only.** `packages/signing` holds the model and the pure logic; each backend
wires it up.

- For: Mailer could reuse it; the rules (levels, hashing, audit-trail shape) are written once and
  tested without a database.
- Against: a package cannot own data. Two backends each storing evidence is two evidence stores,
  two retention jobs, two places a personnummer can leak from. A package on its own solves the
  wrong half.

**(c) A third product,** `apps/sign` + `apps/api-sign`, with its own database and a versioned
contract section, the way Mailer is.

- For: identity data is isolated behind one service with its own keys, its own backups and its own
  retention; the legal boundary becomes a deployment boundary; a customer could buy signing alone
  (the Scrive / DocuSign shape); both products consume it through `docs/CONTRACT.md`.
- Against: it is the most expensive answer by far for a one-person build. `MODULE-STATUS.md` §4
  shows what a second product costs in practice: Mailer, planned alongside Forms from week 0, is
  still 125 lines and a `/health` route. A third one started now would be the same, and
  `START-HERE.md` names that exact failure: *building the platform instead of the product.*

## Recommendation: (b) now, with (c)'s boundary drawn in the schema, and (c) as the exit

1. **`packages/signing`** — pure, no I/O, importable by the browser and both backends:
   the envelope/party/step model as Zod schemas, `SignatureLevel` (below), document hashing
   (SHA-256 over the exact bytes presented), the audit-trail event shape, the multi-party state
   machine (sequential/parallel, expiry, decline) as a reducer that tests can drive without a
   clock. `SigningProvider`'s *types* move here; `IdentityProvider` (ADR 0010) is defined here.
2. **Runtime inside `api-forms`, in its own Postgres schema** (`signing.*`, not `public.*`), with
   its own repository, its own routes under `/v1/signing/*`, and **no import from Forms internals
   into it** — enforced the same way rule 1 is, with an eslint `no-restricted-imports` boundary.
   Forms asks it to sign *bytes plus parties* and gets back an envelope id, exactly as it would
   over HTTP. Adapters that hold secrets (broker clients, the sealing key) live here, never in the
   package, because `@tp/shared` and `packages/signing` ship to the browser.
3. **Identity data encrypted at column level** with a key that is not `JWT_SECRET` or
   `DOCUMENT_SIGNING_SECRET` (a third secret, `SIGNING_DATA_KEY`), and minimised: store the
   assertion the scheme returned, not a copy of it spread across columns — the existing
   `SigningEvidence.details` comment already argues this.
4. **Extract to `apps/api-sign` when the first of these is true:** Mailer needs to request a
   signature; a customer wants to buy signing alone; counsel says identity data must be operated
   separately; or a trust-service or broker contract requires an isolated environment. Because of
   (2), extraction moves a schema and a route prefix — it does not untangle a feature.
   `docs/CONTRACT.md` gets a **reserved, deferred §5 "Signing"** now, so the shape is argued once.

The honest cost of this recommendation: until extraction, a breach of `api-forms` is a breach of
signing data. Column encryption narrows that; it does not remove it. If counsel says that is not
acceptable from day one, the answer is (c) immediately, and P2 of the roadmap roughly doubles.

## Signature levels — modelled, never inferred

```ts
type SignatureLevel =
  | 'simple'      // drawn, typed, or a click with an audit trail
  | 'advanced'    // bound to an identity the signer controls, e.g. through an eID scheme
  | 'qualified';  // only via a qualified trust service provider and a QSCD — not planned
```

- **The level is an attribute of the evidence, set by the adapter from what the provider asserts,
  never by the form author and never by default.** `SigningKind` already refuses to default; the
  level follows the same rule. The console provider is `simple` and says `NOT A REAL SIGNATURE`,
  as it already does.
- **What the UI calls each level is counsel's wording, not ours** (rule 8). Until approved, the UI
  names the *method* — "Signed with BankID on 23 Sep 2026 14:02" — and never the eIDAS level. An
  eID signature is not automatically "advanced" in the legal sense; whether a given broker's output
  meets Art. 26 is a question for the broker contract and counsel (`LAUNCH-CHECKLIST.md` §6).
- **Drawn signatures stay geometry, not biometrics.** Store the SVG path (vector, as the brief
  asks) plus the rendered PNG the export and PDF already use — but **not** timing, velocity or
  pressure. Those make a handwritten signature biometric data under GDPR Art. 4(14)/9, which is a
  special category this product should not start collecting as a side effect of a nicer pen.

## Sealing

- A signed document is **immutable**. A change creates a new document version and a new envelope;
  the old one stays, the way `form_versions` already works.
- **PAdES** (ETSI EN 319 142) via a CMS signature embedded in the PDF: `pdf-lib` is already a
  dependency; `@signpdf/signpdf` (MIT) handles the byte-range placeholder. See ADR 0015 for reuse.
- **What the seal proves depends on the certificate, and that is a purchase, not code:** a
  self-issued certificate proves *tampering after sealing* and nothing about who sealed it; an
  eIDAS **qualified electronic seal** certificate plus a **qualified timestamp** (RFC 3161 from a
  QTSP) is what makes Acrobat and an auditor show it as trusted. `LAUNCH-CHECKLIST.md` §6.
- The audit trail (who, when, method, level, document SHA-256, IP, user agent, each state change)
  is rendered as the last page of the sealed PDF **and** stored as rows, so it survives the PDF
  being lost and the database being lost, independently.

## What this does not decide

The broker (ADR 0010). Whether signing can be bought without Forms (a pricing question). AGM
voting and power-of-attorney, which `SPEC-forms.md` §8 keeps separate and this ADR leaves there.

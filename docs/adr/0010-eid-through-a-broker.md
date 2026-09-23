# ADR 0010 — National eIDs through a broker, behind one interface

**Status:** proposed — the broker itself is the owner's choice (`LAUNCH-CHECKLIST.md` §6)
**Date:** 2026-09-23
**Depends on:** ADR 0009 (where signing lives)

## Context

There is no worldwide "BankID". Each Nordic scheme is a separate contract with separate
certificates: Swedish BankID via a bank as reseller, MitID via an MitID broker by law, Norwegian
BankID via a BankID Norge partner, the Finnish Trust Network (FTN) via the Traficom-registered
brokers. Direct integration means N contracts, N certificate rotations, N sandbox quirks — for one
builder, a year of plumbing before a single customer signs anything.

Brokers (aggregators) sell exactly this: one API, usually OpenID Connect for login and a signing
API on top, with every Nordic scheme and a varying slice of the rest of Europe behind it.

`apps/api-forms/src/signing/provider.ts` already separates *agreement* services (they sign a
document) from *identity* services (they assert who someone is). A broker usually offers both.

## Decision

### One interface, two operations

`IdentityProvider` is defined in `packages/signing` (ADR 0009) — types and Zod only, because that
package ships to the browser. **Adapters live server-side** in `apps/api-sign` (ADR 0009, decided), because they
hold client secrets and certificates. (The brief puts adapters in `@tp/shared`; that would ship
credentials-adjacent code to every browser, so this ADR deliberately departs from it.)

```ts
interface IdentityProvider {
  readonly name: string;                 // 'idura', 'signicat', 'console'
  readonly environment: 'test' | 'production';
  readonly methods: readonly EidMethod[]; // 'bankid-se', 'mitid', 'bankid-no', 'ftn', …
  identify(req: IdentifyRequest): Promise<IdentitySession>;   // login / "who are you"
  sign(req: SignHashRequest): Promise<IdentitySession>;       // sign a document hash + visible text
  result(sessionRef: string): Promise<IdentityResult>;        // evidence, level, assertion
}
```

- **`environment` is on the provider and on every result.** A test-mode result is stamped
  `environment: 'test'` in the evidence row and watermarked `TEST — NOT SIGNED` on the sealed PDF.
  This is the repo's test-mode rule applied to signing; test identities (every scheme publishes
  test personnummer / CPR numbers) can never produce a production-looking document.
- **The visible text the signer approves is human-authored and versioned** (rule 8, ADR 0012). It
  is stored with the evidence, byte for byte, because "what did they see on their phone" is the
  first question in a dispute.
- **A `console` adapter** mirrors the console mail and signing providers, so P2 can be built and
  tested end to end before any contract exists.

### Broker candidates — to be verified, not assumed

Written from public material as known on 2026-09-23. Every cell marked † needs confirming with the
vendor before a contract; pricing in particular changes and is usually negotiated.

| | **Idura** (formerly Criipto) | **Signicat** | **Scrive eID Hub** | **Nets / Nexi eID Broker** | **Direct** |
| --- | --- | --- | --- | --- | --- |
| Based | Denmark | Norway | Sweden | Denmark | — |
| SE BankID, NO BankID, MitID, FTN | yes | yes | yes | yes† | one contract each |
| Freja eID (SE) | yes† | yes† | yes† | ?† | own contract |
| Wider EU (itsme BE, iDIN NL, …) | some† | broadest of the four† | limited† | limited† | — |
| Document + selfie ID verification (US/rest of world) | no† | yes† | no† | no† | separate vendor |
| Signing API producing PAdES | yes† | yes† | via Scrive e-sign† | ?† | build ourselves |
| Protocol | OIDC | OIDC + REST | OIDC† | OIDC/SAML† | per scheme |
| Self-serve test tenant | yes† | yes† | ?† | enterprise onboarding† | per scheme |
| EU data residency | yes† | yes† | yes† | yes† | ours |
| Pricing shape | per transaction, published tiers† | enterprise, negotiated† | bundled with Scrive† | enterprise† | per scheme + ops |

### Recommendation

**Shortlist Idura and Signicat and run P2's console-to-sandbox step against both** — the interface
makes that a day each, not a rewrite. Lean **Idura** for a Nordic-first, one-builder start (plain
OIDC, self-serve test tenants, published per-transaction pricing†). Choose **Signicat** instead if
EU breadth or US-style identity verification is inside the next twelve months, because it covers
both with one contract†. Do **not** integrate schemes directly: MitID in particular cannot be
integrated without a certified broker anyway.

### Coverage beyond the Nordics — scoped, not promised

- **Rest of the EU:** eIDAS-notified eIDs arrive through the chosen broker as it adds them. The
  **EUDI Wallet** (Regulation (EU) 2024/1183; member-state wallets due from late 2026†) speaks
  OpenID4VP; the Commission's reference implementation is open source
  (`github.com/eu-digital-identity-wallet`, Apache-2.0/EUPL†). An `eudi-wallet` adapter is P6.
- **United States:** no national eID. Realistic offer: a simple electronic signature (ESIGN Act /
  UETA) plus optional document-and-selfie verification from an IDV vendor. The UI must not imply
  more. Adapter decision in P6.
- **Asia:** one adapter decision per country — Singpass (SG), JPKI / My Number (JP), Aadhaar eSign
  via a licensed ESP (IN), and so on. None is planned; each needs a local-law read first.

## Consequences

- P2 is buildable before any contract is signed (console adapter), and verifiable against a real
  sandbox the day a test tenant exists.
- Swapping brokers later is an adapter, not a migration, **provided** evidence rows keep the
  broker's raw assertion (ADR 0009) rather than a normalised subset.
- The broker is a sub-processor. It joins the list at `legal.ts:202` the day it is contracted.

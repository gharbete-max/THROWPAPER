# ADR 0015 — Reusing open source: take freely from permissive code, decide the licence first

**Status:** accepted 2026-09-23 — Loppa is **proprietary**; see "Decided" at the end
**Date:** 2026-09-23

## Context

The owner's instruction (2026-09-23): *"Don't be afraid to directly take resources from open source
repos … a lot of these functions probably already got built in a functional way"*, and *"the loppa
repo is totally fine to be public."*

Both are good instructions and they interact:

- **The repository has no `LICENSE` file.** Public with no licence means *all rights reserved*:
  people may read it, but not reuse it. Making it public is one decision; choosing its licence is
  another, and it decides what can be copied *in*.
- **The best-known open-source signing products are AGPL-3.0** — Documenso, DocuSeal, OpenSign
  (licences as last known†). Copying their code into Loppa makes Loppa's hosted service subject to
  the AGPL's network clause: every user of the hosted product may demand the complete source. If
  the owner is happy for Loppa to be AGPL, that door opens; if not, it stays shut, and those
  projects are *references for flows and UX*, never sources of code.
- **House rule:** no new dependency without asking (`HANDOVER.md`), and majors are governed by
  ADR 0005. Taking open source is adding dependencies, so each phase's plan lists what it adds.

## Decision

1. **The repo's licence is decided before the first copied line lands** — it now is: proprietary
   ("Decided" below). Only permissive code (MIT, BSD, Apache-2.0, ISC) is ever taken in.
2. **Prefer a dependency to a copy.** A pinned package keeps its upstream fixes; a copied file
   forks them. Copy only when the upstream is abandoned or the piece is small, and then keep the
   original licence header and add the project to `THIRD-PARTY-NOTICES.md` (created with the first
   copy).
3. **Copyleft is quarantined, not banned:** LGPL or AGPL software may run as a **separate service**
   we talk to over HTTP (e.g. the EU DSS validator below) without affecting Loppa's licence. It is
   never linked or pasted in.
4. **Every phase plan names its candidates, licence and maintenance state**, and the owner approves
   them with the plan.

## Candidates by phase — licence and status to verify at the time (†)

| Phase | Need | Candidate | Licence† | Use |
| --- | --- | --- | --- | --- |
| P1 | PAdES signature on a PDF | `@signpdf/signpdf` (+ placeholder plugin) | MIT | dependency |
| P1 | CMS / RFC 3161 timestamps | `pkijs` + `asn1js` | BSD-3 | dependency |
| P1 | PDF assembly | `pdf-lib` | MIT | **already a dependency** |
| P1 | Nicer drawn strokes (vector) | `perfect-freehand` | MIT | dependency; `DrawingPad.tsx` already captures paths |
| P1 | Validating what we sealed | EU **DSS** (Digital Signature Service) | LGPL-2.1 | separate container, tests only |
| P1–P2 | Signing UX and multi-party flows | Documenso, DocuSeal, OpenSign | AGPL-3.0 | **reference only — no code** |
| P2 | OIDC to the eID broker | `openid-client` | MIT | dependency (`jose` is already here) |
| P3 | QR generation / scanning | `qrcode`, `@zxing/browser` | MIT / Apache-2.0 | **already dependencies** |
| P3 | Email layout | React Email | MIT | **already a dev dependency** |
| P3 | Campaign-tool reference | listmonk | AGPL-3.0 | **reference only — no code** |
| P4 | Native document scanner | Capacitor ML Kit / VisionKit scanner plugins (e.g. Capawesome's) | MIT† | dependency |
| P4 | Web edge detection fallback | OpenCV.js (optionally via `jscanify`) | Apache-2.0 / MIT† | dependency, lazy-loaded; measure bundle (`scripts/bundle-budget.ts`) |
| P4 | OCR | `tesseract.js` | Apache-2.0 | **already a dependency** |
| P5 | Provider-agnostic AI client | Vercel AI SDK (`ai`) | Apache-2.0 | dependency, or a thin in-house seam |
| P6 | Public API reference | `@fastify/swagger` + Zod → OpenAPI | MIT | **`@fastify/swagger` already here** |
| P6 | SAML / OIDC SSO | `@node-saml/node-saml`, `openid-client`; or Ory Polis / SAML Jackson as a service | MIT / Apache-2.0† | dependency or service |
| P6 | SCIM 2.0 | `scimmy` | MIT† | dependency |
| P6 | Webhook signing | Standard Webhooks libraries | MIT† | dependency |
| P6 | MCP server | `@modelcontextprotocol/sdk` | MIT | dependency |
| P6 | EUDI Wallet | EU reference implementations (`eu-digital-identity-wallet`) | Apache-2.0 / EUPL† | dependency or reference |

## Decided (2026-09-23)

The owner's answer: the finished product is **closed source**, so code is learned from and taken
in parts, never whole projects copied. What that means in practice, because "parts" is where the
risk is:

- **`LICENSE` is an all-rights-reserved notice** from today, and the root `package.json` says
  `"license": "UNLICENSED"` (npm's marker for proprietary). The repository being public while it is
  built does not grant anybody a right to reuse it; it does mean everything pushed so far can have
  been read and copied by others, and cannot be taken back by making the repository private later.
  The copyright holder's name and any fuller proprietary terms are counsel's and the owner's
  (`LAUNCH-CHECKLIST.md` §6) — this is rule 8, and the notice carries a visible placeholder until
  then.
- **AGPL and GPL projects: no code at all, not even parts.** Documenso, DocuSeal, OpenSign and
  listmonk may be read to understand a flow, a data model or a UX decision, and that understanding
  may be reimplemented in our own code. A copied function, a pasted schema file or a translated
  snippet is still a derivative work, and one snippet is enough to put the closed product under the
  AGPL. When in doubt, close the other tab before writing the code.
- **MIT, BSD, ISC, Apache-2.0: parts may be copied**, keeping the original copyright line and
  licence text, with an entry in `THIRD-PARTY-NOTICES.md`. Apache-2.0 also requires any `NOTICE`
  file to be carried and changes to be marked. A dependency is still preferred to a copy.
- **LGPL and EUPL**: only as a separate, unmodified service or library, never pasted in.
- **Dependencies are checked, not trusted**: each phase plan lists every new package with its
  licence, and a licence allowlist check in CI (permissive only) is part of P1b.

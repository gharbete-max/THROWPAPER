# ADR 0015 — Reusing open source: take freely from permissive code, decide the licence first

**Status:** proposed — blocked on one owner decision (the repository's own licence)
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

## Decision (proposed)

1. **The owner picks the repo's licence before the first copied line lands** (question in
   `docs/EXPANSION.md` §5). Until then only permissive code (MIT, BSD, Apache-2.0, ISC) is taken.
2. **Prefer a dependency to a copy.** A pinned package keeps its upstream fixes; a copied file
   forks them. Copy only when the upstream is abandoned or the piece is small, and then keep the
   original licence header and add the project to `THIRD-PARTY-NOTICES.md` (created with the first
   copy).
3. **Copyleft is quarantined, not banned:** LGPL or AGPL software may run as a **separate service**
   we talk to over HTTP (e.g. the EU DSS validator below) without affecting Loppa's licence. It is
   never linked or pasted in, unless the owner chooses a compatible licence for Loppa.
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
| P1–P2 | Signing UX and multi-party flows | Documenso, DocuSeal, OpenSign | AGPL-3.0 | **reference only** unless Loppa goes AGPL |
| P2 | OIDC to the eID broker | `openid-client` | MIT | dependency (`jose` is already here) |
| P3 | QR generation / scanning | `qrcode`, `@zxing/browser` | MIT / Apache-2.0 | **already dependencies** |
| P3 | Email layout | React Email | MIT | **already a dev dependency** |
| P3 | Campaign-tool reference | listmonk | AGPL-3.0 | reference only |
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

# ADR 0028 — Every seal carries an ID and a date on each page, and an independent timestamp when online

**Status:** accepted 2026-11-13 by the owner ("free timestamp when online"). Amends ADR 0026 §2
(the network rule) with one more permitted use. **Builds on:** ADR 0009 (where signing lives), 0016,
0026.

## Context

The owner wants a signed document to prove when it was made and signed. The seal already makes any
changed byte detectable, and its audit page lists every event with its time. But those times come
from the computer's clock, and anyone can set a clock: offline, a date proves nothing to somebody
else. Only a third party that signs the time can, which is what an RFC 3161 timestamp authority does.

## Decision

1. **A stamp on every page.** Each page of a sealed PDF, the document's and the audit page's,
   carries one small line: `Loppa Sign · <envelope ID> · sealed <UTC time> · page n of N`.
2. **An RFC 3161 timestamp when online (PAdES B-T).** At sealing, Sign asks a timestamp authority
   for a token over the hash of its own signature value, and embeds it as the CMS
   signature-time-stamp attribute. Any validator (Adobe, OpenSSL, EU DSS) shows that time as
   independently verified. Only the 32-byte hash is sent, never the document.
3. **DigiCert's free service** (`http://timestamp.digicert.com`) on the desktop: no account, no cost,
   a CA every validator already knows. The hosted Sign uses one only if `SIGN_TSA_URL` names it.
4. **Offline, the seal falls back, and says so.** If no token comes within 5 seconds, the PDF is sealed
   without one and its audit page reads "This computer's clock, not independently verified". The
   page never claims a timestamp the seal does not carry: on failure the PDF is drawn again.
5. **A reply is checked before it is kept.** It must be granted and state our hash and our nonce.
   Anything else is refused, never embedded.

## The network rule (amends ADR 0026 §2)

Added to the permitted uses: **one RFC 3161 request per sealed document**, to the timestamp service
named on the Sign screen, carrying a 32-byte hash. The confirmed press is sending the document for
signing, and the send step names the host and what is sent (`signing.timestampNote`).

## Not decided here

- A qualified timestamp (eIDAS QTSP), which is legally stronger and costs money (ADR 0009).
- Renewing timestamps before the TSA certificate expires (PAdES B-LTA), for proof over decades.
- A setting to turn the request off.

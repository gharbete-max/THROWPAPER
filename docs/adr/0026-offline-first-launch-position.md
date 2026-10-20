# ADR 0026 — The launch position: offline first, the network only on a confirmed action

**Status:** accepted 2026-10-20 (the owner asked that the open product decisions be made from the
vision: Loppa must run completely offline; a local network may be used occasionally, sparingly,
and only with the person's confirmation).

## Decisions

1. **The desktop app is the product.** It runs with no network, no account and no key. The hosted
   web edition and the marketing site are optional extras; their open items (`LAUNCH-CHECKLIST.md`
   §1 to §3: company details, policy text, terms, pricing, hosting, SES, domain) **block a hosted
   launch only, not the desktop release.** The desktop release needs a plain licence notice and
   the third-party notices already in the repository.
2. **The network rule.** Nothing touches the network unless the person triggers it, and the screen
   that triggers it names the host, what is sent or fetched, and its size, and waits for a press.
   The complete list of permitted uses:
   - fetching the AI pack or the `llama-server` runtime (a GitHub release, hash-verified, never
     automatic; the pack can instead be placed by hand from files, which is the offline path);
   - sending mail through a provider the person configured (SMTP or Outlook/Apple Mail drafts), after
     the Send confirmation, with test mode on until switched off;
   - the phone-scan relay and Sign links on the local network, only while that screen is open
     (ADR 0016), shown with the address that is being offered;
   - nothing else: no telemetry, no update ping, no cloud AI, no fonts or scripts from elsewhere.
3. **If a hosted edition is ever run**, the technical defaults are: an EU region; uploads and scans
   held only for the request (already true of the PDF routes); logs 30 days; backups 30 days;
   deleted organisations purged after 30 days; the summary and reader are never offered on it (a
   model on Loppa's server is not the person's own computer). Hosted Send stays available through
   the configured mail provider, in test mode until the operator switches it off. These are
   engineering defaults for the operator to adopt or change with counsel; they are not legal text.
4. **Campaign footer.** The sender still writes the footer (rule 8), but the field opens with a
   neutral skeleton of placeholders (who sent it, their address, why the person is receiving it,
   the unsubscribe link) and sending stays blocked while any placeholder is unfilled. The skeleton
   states no legal claim.
5. **Earlier features** (events, check-in, the ledger, invoicing arithmetic) stay where they are,
   out of the room, as `CLAUDE.md` already says. The "one switch" phase of `DOCUMENTS.md` is not
   built: it would add a settings screen to hide code that nothing links to. It is dropped.
6. **Mailer** stays parked. Campaigns inside Send are the mail feature; segments, schedules,
   approvals and bounce handling are not needed for a local-first helper and are not planned.
7. **Backups.** The desktop's "Back up" must not copy `secrets.json` in plain files. Default:
   exclude it; offer an encrypted backup protected by a passphrase the person types.
8. **The AI pack.** The model and projector are about 6 GB and live in their own folder beside the
   app, separate from code. Delivery is a set of parts under 2 GiB with SHA-256 hashes; the app
   opens a pack from disk (offline) or fetches it with the confirmation of decision 2.

The company name and number, addresses, terms, price and the data protection officer are out of scope for development. They are not an open decision; they are needed to sell or host Loppa, not to run it.

## Follow-up work this creates

The footer skeleton (4) and the encrypted backup (7) are small code changes; the AI pack
distribution (8) is the packaging work already planned, and is now also met by the model catalogue (ADR 0025, section 6): a person may download a model from Hugging Face on a confirmed press. They are tracked in `docs/HANDOVER.md`.

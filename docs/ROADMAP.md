# Roadmap — two parallel tracks

## What this is, before the phases

Stated by the owner on 2026-09-01: this launches as a **form and email site**. The general form
builder is the product. Events and registrations — everything built in phases 0–5, the AGM slice —
are **one segment among several**, and are only first because a demo has to be about something.

Read A10–A13 as segments, not as the destination, and read A5–A6 as the thing being sold.

The product is deliberately **unregulated**: no advanced accounting, no scientific instrumentation.
That is the owner's line and it agrees with `CLAUDE.md` rule 8. It has consequences worth naming
rather than discovering later — see *Open, from the direction note* at the end of Track A.


## Week 0, both tracks together

1. Agree and freeze `docs/CONTRACT.md`. Nothing else starts first.
2. Scaffold the monorepo: `apps/*`, `packages/tokens|i18n|ui|calc|shared`, TypeScript config,
   lint, tests, `pnpm verify`, `pnpm contract:check`, CI, Docker compose for Postgres.
3. Build `packages/tokens` and `packages/i18n` to a usable state. Both tracks depend on them, so
   they cannot be stubbed for long.
4. Generate mock implementations of both sides of the contract, so each track can develop
   against the other before it exists.

After week 0 the tracks run independently. They re-sync only on contract changes.

## Track A — Forms

**A1.** Auth, tenancy, roles, audit log, locale config, app shell.
**A2.** Contacts and reference tables. Import with column mapping and merge. Seed data.
**A3.** Brand Kit editor on tokens, with the web and PDF compilers proven end to end.

*A3a — done.* Per-organisation token sets, stored, edited and applied to the app, the public form,
the admission PDF and both confirmation and operator email. Contrast is checked as you type and is
**advisory**: it never blocks a save. Colours are hex-only and font stacks are punctuation-free,
because these values are interpolated into inline email styles and print CSS where "whatever the
browser makes of it" is not a specification.

*A3b — done.* Image upload and the brand logo. Uploads are content-addressed (the key is the
SHA-256 of the bytes), the format is decided by reading the magic numbers rather than trusting the
filename or the declared type, and SVG is refused with a message that says what to send instead.
Logos on a brand kit must be a path into this application's own asset store — never an arbitrary
URL, which would leak every visitor's IP to a third-party host and let whoever runs it change what
the form appears to say.

*A15b — done.* Images inside a form. A presentational `image` field for header art and
illustrations, and an optional picture on each choice, shown by the `cards` and `buttons`
appearances. Sources must be paths into this application's asset store, the same rule as a logo.
Alt text is localised and optional, because an empty alt is a real choice for decoration.

*Remaining.* Favicon and per-form brand overrides.
**A4.** The shared data grid: server-side sort/filter/pagination, ICU collation, multi-column
sort, column management, grouping with subtotals, saved views, CSV/XLSX export parity. Test
against 100k seeded rows. Reused everywhere — build it once, properly.
**A5.** Form builder core: fields, properties, drag-and-drop, versioning, public renderer with
the language dropdown, translation tab and completeness.
**A6.** Logic, validation, multi-page, save-and-resume, photo capture, submissions and the
submission grid.
**A7.** `packages/calc`: formula AST with units and precision, statistics library, formula editor
with dependency view. Shared, but Track A drives it.
**A8.** Charts: builder, web renderer, PDF renderer. Email renderer coordinated with Track B.
**A9.** Report builder: individual and aggregate reports, PDF pipeline, bulk generation as a
background job, amendment versioning.
**A10.** Segment — Events & registrations: events, sessions, capacity, admission PDF with signed
QR, idempotent check-in screen, event reports.
**A11.** Segment — Inspections & work orders: assets, threshold-driven checklists with photos,
work orders, tokenised customer approval with audit trail, inspection and fleet reports, service
reminders pushed as an audience.
**A12.** Segment — Measurements & quality: parameters and ranges, sample registration, instrument
import, flagging, QC control charts, certificates and statistics reports.
**A13.** Segment — Surveys & feedback.
**A13b.** Collaboration on a draft (`SPEC-forms.md` §3b): per-form view/comment/edit access,
comment threads anchored to field ids, presence, tokenised review links, and soft locking so two
editors cannot silently overwrite each other. Needs two things nothing else in Track A needs — a
per-resource permission table and a live transport to the browser — so it is worth sequencing
deliberately rather than squeezing in beside a segment.
**A14.** Hardening: rate limits, bot protection, permissions matrix, GDPR export and erasure,
backup and restore rehearsal, load test of the grid and bulk PDF generation.

**A15.** Field styling and media.

*A15a — choice appearance. Done.* `single_select` renders as a dropdown, radio buttons, buttons or
cards; `multi_select` as checkboxes, buttons or cards; `yes_no` as a dropdown, radios or buttons.
Every variant is a `fieldset` with a `legend` and real inputs, so the keyboard and screen readers
work in all of them, and colour comes from the Brand Kit rather than free-typed hex. Presentation
only: a form can be restyled after it has been filled in without touching a submission.

*Remaining.* Per-field colour, spacing and emphasis beyond the shared Brand Kit. A layout hint for
buttons and cards (columns) — deliberately left out of A15a rather than guessed at. Author-uploaded
images: header art, per-question illustrations, image-choice options. Those need the object store
`SPEC-forms.md` §7 defers, so they are the larger half and are distinct from A6's *respondent*
photo capture.

**A16.** Template gallery.

*Done, with six templates.* Chosen when a form is created and copied into the draft, never
referenced — improving a template must not rewrite forms people are already filling in. The
catalogue is code rather than database rows, and a test parses every template against the schema
so a field type gaining a required property fails the build instead of a customer's afternoon.

*Deliberately limited.* `CLAUDE.md` rule 8 rules out the categories a template gallery would
otherwise reach for first — incident and accident reports, medical intake, consent and waiver
forms, tax declarations, employment contracts. A plausible-looking one written here would be worse
than none, because somebody would send it out. What ships is the operational middle: event
registration, contact enquiry, customer feedback, course sign-up, booking request, member details.
The gallery says so on the screen.

*Remaining.* More sectors, and templates carrying images now that A15b exists. Both are content
work, and the right people to write them are the ones who use the forms.

### Open, from the direction note

Two things the "unregulated, no advanced accounting or science" line collides with, neither
resolved here:

- **A7 (`packages/calc`)** was specced as a formula AST with units and precision plus a statistics
  library. Basic arithmetic on form answers — totals, fees, quantities — is clearly wanted. The
  statistics half was there for A12 and may not be.
- **A12 (Measurements & quality)** is instrumentation-shaped. It may be out of scope entirely, or
  may survive as ordinary numeric fields with ranges.

Ask before building either. Cutting them is cheaper than cutting them later.

## Track B — Mailer

**B1.** Auth, tenancy, roles, audit log, app shell. Shares the pattern with A1 — agree it once.
**B2.** Contacts: import with mapping and merge, custom fields, tags, preferred locale, the
shared grid. Static lists.
**B3.** Provider integration behind `MailProvider`, sending-domain verification screen with live
SPF/DKIM/DMARC checks, single test send. Nothing else until a real email arrives.
**B4.** Template editor: blocks, tokens-to-inline-styles compiler, preview in light and dark,
multilingual content with completeness, web version page.
**B5.** Merge fields, fallbacks, conditional blocks, repeating blocks, period context.
**B6.** Transactional templates and the `POST /v1/messages` contract endpoint. Track A can now
send real confirmations.
**B7.** Dynamic audiences with send-time resolution; the audience push and pull contract
endpoints.
**B8.** One-off campaigns with the full blocking pre-send checklist.
**B9.** Segment types and scoped suppression. Test explicitly that a marketing unsubscribe does
not stop a rent notice, and that a marketing campaign to the same contact is stopped.
**B10.** Recurring schedules, draft generation, approval flow, next-five-dates preview.
**B11.** Delivery events: bounce and complaint webhooks, suppression rules, preference centre,
one-click unsubscribe headers, delivery webhook back to Forms.
**B12.** Per-recipient charts rendered as images with alt text.
**B13.** Reporting and deliverability health.
**B14.** Hardening: throttling, domain warm-up, load test of a full-size send, GDPR export and
erasure.

## Expansion — signing first (approved 2026-09-23)

From the owner's expansion brief. Gap analysis, conflicts and the contract proposal are in
`docs/EXPANSION.md`; the decisions are ADRs 0009–0015. **The owner decided on 2026-09-23 that the
expansion starts now, beside the v0.1 launch blockers** — `START-HERE.md`'s "after the first real
event" is overridden for this track only. The v0.1 rows in `LAUNCH-CHECKLIST.md` §1 still block
*launch*; they no longer block *building*.

Signing is a **third product**, `apps/sign` + `apps/api-sign` (ADR 0009, decided).

Each phase is one branch and one PR, tests first where practical, `docs/HANDOVER.md` updated at the
end, and done only when `pnpm verify`, `pnpm contract:check` and the relevant `pnpm test:e2e` pass
— run as `CLAUDE.md` requires, each step read on its own. A phase marked **(packages)** or
**(contract)** is a cross-track event and says so in its PR title.

P1 is three branches, because it touches two products and a new one:

**P1a — Forms: choice controls and the vector signature.** *Done — `docs/PROGRESS.md` § P1a
parts 1 and 2. Option icons deferred (part 2 says why).*
- Choice controls: author-chosen shape, icon, size and per-field colour through derived tokens;
  every option added to `locked.test.ts`'s hostile kits in both schemes.
- Signature field stores the vector path beside the PNG; no timing or pressure (ADR 0009).
- Labels per ADR 0012 "Decided": "Signature"/"Sign", method and time, never a level.

**P1b — The Sign product's skeleton.** (packages) (contract) *Done — `docs/PROGRESS.md` § P1b.
Its own database and the standalone mode moved to P1c, which is the first phase that stores
anything.*
- `packages/signing`: envelope and signer model, `SignatureLevel`, SHA-256 document hash, audit
  event shape, single-signer state machine. Pure, no I/O.
- `apps/api-sign` (Fastify, own Postgres database and migrations, bearer + refresh like the others)
  and `apps/sign` (the signer's page and a small admin), both on the shared tokens and i18n.
- `SigningProvider` moves here from `api-forms`; a console provider; test mode everywhere.
- Contract §5 schemas in `packages/shared/src/contract/`, entries in `manifest.ts` marked deferred,
  `contract:check` green; the check learns a third side.
- Standalone mode (rule 2): upload a PDF, type the parties, invitations by direct SMTP.
- `CLAUDE.md` and README gain the third product; eslint forbids imports between all three apps.
- CI licence allowlist check (ADR 0015).

**P1c — Sealing and the audit trail.** Four slices. *P1c-1 (storage, trail, §5.1–5.2, typed
signing by link) and P1c-2 (sealing, §5.3) done — `docs/PROGRESS.md` § P1c-1, § P1c-2.* Next:
P1c-3 Forms → Sign + webhook, P1c-4 standalone page + SMTP.
- From P1b: Sign's own Postgres database and migrations (envelopes, the event trail, evidence;
  identity data encrypted with its own key), and the standalone mode (upload a PDF, type the
  parties, invitations by direct SMTP). Contract §5 endpoints implemented.
- Sealed PDF: PAdES with a **development** certificate, audit-trail page, immutable signed versions;
  test mode watermarks. Validated in tests against an independent validator (ADR 0015).
- Wording: `WordingTemplate` with versions; signing is **blocked** without a human-authored
  declaration (ADR 0012).
- Forms → Sign: "send this submission for signing" through the contract; the webhook marks the
  submission signed.
- e2e: upload or submit → sign → download sealed PDF → hash verifies; a tampered byte fails.
- New dependencies approved with this plan: `@signpdf/signpdf`, `pkijs` + `asn1js` — both
  permissive. (`perfect-freehand` was approved for P1a and turned out to be unnecessary.)

**P2 — Nordic eID signing via a broker, multi-party flows.**
- `IdentityProvider` + console adapter, then the chosen broker's **sandbox** (ADR 0010).
- Same-device and other-device flows; app-switch return; evidence keeps the raw assertion.
- Multi-party: order, parallel/sequential, expiry, decline, reminders (through the thin mail path
  until Mailer exists).
- Identity data encrypted at rest in Sign's own database, with its own key.
- *Needs:* broker chosen and a test tenant; counsel's wording for method/level labels.

**P3 — Mailer document sends: rent, invoices, admission cards + QR check-in.** (contract)
- Contract v2 (`docs/EXPANSION.md` §3) — schemas and `manifest.ts` first, then `contract:check`.
- Mailer B2 (contacts), B3 (provider), B6 (transactional + `POST /v1/messages`), B9 (scoped
  suppression — rent is never stopped by a marketing unsubscribe), B10 (recurring + approval).
- Invoice/rent runs push document audiences; admission cards sent through Mailer.
- Offline-tolerant check-in with a local queue synced through the existing idempotent endpoint.
- *Needs:* the ledger decision (ADR 0011); `api-mailer` hosting and whether it sends marketing.
- *Realism:* this is most of Track B. It is the largest phase here by a distance.

**P4 — App shell and scanner.**
- `apps/mobile` (Capacitor around `apps/forms`), native document scanner plugin, SQLite for the
  door's offline queue, deep links for eID return (ADR 0014).
- Web fallback keeps the manual warp; automatic edge detection lazy-loaded within the bundle budget.
- e2e for capture (none exists today).
- *Needs:* app-store accounts, an iOS build route (no macOS on the dev machine).

**P5 — AI assistance.**
- `AiProvider` + console provider; form from description; form from a scanned page (opt-in,
  drafts only); validation suggestions; response summaries labelled as generated (ADR 0013).
- Refusal of operative wording classes before any provider call (ADR 0012).
- *Needs:* provider and region chosen; privacy page updated by counsel before it ships.

**P6 — Enterprise and wider eID.**
- SSO (OIDC, then SAML), SCIM, per-org API keys with scopes, webhooks (signed, retried), the
  public API documented from the Zod schemas via the existing `/openapi.json`, connectors, an MCP
  server exposing read and draft actions (send/sign require a human confirmation).
- EUDI Wallet adapter; US simple-signature + ID verification; Asian adapters one country at a time.

**D — Loppa desktop (Windows, macOS), offline first.** (packages: none; contract: none) — `docs/adr/0016-desktop-edition.md`.
Asked for by the owner on 2026-09-23: a downloadable `.exe` that runs forms, scanning, documents
and email fully locally, with AI and signing offering "connect online" or "work in cloud
(placeholder)". **Owner's direction (2026-09-23): offline product first, then hostable from the
same code; everything but eID signing works offline; mail through Outlook where it can; macOS
too.** **D1 is built** (PROGRESS § D1, § D1b): the Forms product in an Electron window on an
embedded Postgres (PGlite — the same migrations and repositories), mail to an `.eml` outbox, SMTP,
Outlook or Apple Mail, PDFs from the app's own Chromium, Windows and macOS installers from
`.github/workflows/desktop.yml`. Next is D4 — hostable — with D2 polish beside it; D3 scanner
hardware, D5 AI online, D6 Mailer locally after. Each is described in the ADR.

Explicitly **not** in these phases: qualified signatures, AGM voting and power of attorney
(`SPEC-forms.md` §8), tax calculation or VAT tables (ADR 0011), handwriting OCR (ADR 0007, unwritten).

## Running this with Claude Code

- Two repos-worth of work in one monorepo. Run the tracks in **separate sessions**, and say which
  track a session is on in your first message.
- Start every phase in **plan mode**. Read the plan, correct it, then let it build.
- One phase per branch. `pnpm verify` and `pnpm contract:check` must pass before a phase is done.
- Put narrow conventions in `.claude/rules/` scoped to a path rather than growing `CLAUDE.md`.
- When context gets heavy mid-phase, have it write state into `docs/PROGRESS-a.md` or
  `docs/PROGRESS-b.md`, then start a fresh session pointing at that file.
- A change to `packages/` or `CONTRACT.md` is a cross-track event. Flag it in the PR title.

**Phase kickoff prompt:**
> Track {A|B}, phase {N}. Read `docs/SPEC-{forms|mailer}.md` and `docs/SPEC-shared.md`. Enter plan
> mode. Plan the files you will create or change, the schema changes, the endpoints with their Zod
> schemas, the tests, and anything ambiguous in the spec. Do not write code until I approve.

**Phase closing prompt:**
> Run `pnpm verify`, `pnpm contract:check` and `pnpm test:e2e`. Fix what fails. Update
> `docs/PROGRESS-{a|b}.md` with what shipped, what you deferred and why, and any assumption I
> should check. Write a PR description. Do not start the next phase.

## Later

Mobile apps for each product, consuming the existing APIs unchanged: an attendee and inspector
app for Forms (admission QR, assigned forms, offline-capable check-in and inspection capture),
and a light approvals app for Mailer. If any phase above makes those hard, that is a bug in the
phase.

The regulated modules in `SPEC-forms.md` §8 — legal e-signature, AGM voting and POA, accounting —
sit outside this roadmap until someone commits to doing them properly.

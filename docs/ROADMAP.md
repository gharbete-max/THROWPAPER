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

## Track A — Formwork

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

*Remaining.* Favicon, per-form overrides, and image *fields* inside a form (header art,
per-question illustrations, image-choice options) — the upload path they need now exists.
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

**A16.** Template gallery. Prebuilt forms covering the most commonly used form in each sector and
business, chosen at creation and then edited freely. Requires A5 versioning to already exist, and
is mostly content work rather than engineering — the engineering is one screen, a seeded
catalogue, and keeping templates valid as the field schema moves.

### Open, from the direction note

Two things the "unregulated, no advanced accounting or science" line collides with, neither
resolved here:

- **A7 (`packages/calc`)** was specced as a formula AST with units and precision plus a statistics
  library. Basic arithmetic on form answers — totals, fees, quantities — is clearly wanted. The
  statistics half was there for A12 and may not be.
- **A12 (Measurements & quality)** is instrumentation-shaped. It may be out of scope entirely, or
  may survive as ordinary numeric fields with ranges.

Ask before building either. Cutting them is cheaper than cutting them later.

## Track B — Sendwork

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
one-click unsubscribe headers, delivery webhook back to Formwork.
**B12.** Per-recipient charts rendered as images with alt text.
**B13.** Reporting and deliverability health.
**B14.** Hardening: throttling, domain warm-up, load test of a full-size send, GDPR export and
erasure.

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
app for Formwork (admission QR, assigned forms, offline-capable check-in and inspection capture),
and a light approvals app for Sendwork. If any phase above makes those hard, that is a bug in the
phase.

The regulated modules in `SPEC-forms.md` §8 — legal e-signature, AGM voting and POA, accounting —
sit outside this roadmap until someone commits to doing them properly.

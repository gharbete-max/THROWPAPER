# Formwork — forms, inspections, measurements and reports

Read `SPEC-shared.md` first; this document assumes the grid, tokens, i18n and calc packages.

## 0. Parameters

Name `{{NAME}}` · users `{{WHO}}` · locales `{{LOCALES}}` · volume `{{N}}` forms/month, largest
dataset `{{R}}` rows · data residency `{{DATA_REGION}}`.

## 1. Objective

A form builder and reporting tool that a non-technical operator runs unsupervised. Collect
structured data, compute from it, and produce a branded report — on screen, as PDF, as
CSV/XLSX, or delivered by email.

The product ships as a core plus **vertical segments** the customer enables. Segments are
configuration — templates, reference tables, formulas, report layouts, seed data — not separate
applications. A segment may not fork the grid, the PDF renderer, auth, i18n or tokens. If one
seems to need to, the core is missing a feature; add it to the core.

**Segments at launch:** Events & registrations · Inspections & work orders · Measurements &
quality · Surveys & feedback. See §6.

## 2. Roles

Admin (everything) · Editor (build forms, templates, brand) · Operator (run a segment day to
day) · Analyst (reports, grids, exports; no editing) · Viewer (read-only).

## 3. Form builder

Left panel field palette, centre live canvas with drag-and-drop, right panel properties.
Autosave, version history, one-click restore.

**Fields:** short text, long text, number (with unit and precision), email, phone, date, time,
single select, multi select, matrix/grid, rating, linear scale, yes/no, file upload, photo
capture, section break, page break, rich text, image, signature (drawn), hidden field prefilled
from URL parameter or contact record, repeatable group, lookup-from-reference-table, and
**computed field** driven by `packages/calc`.

**Per field:** label, help text, placeholder, required, default, validation (regex, min/max,
count, file type and size), width, threshold rules that set a status automatically, and a
**translation tab covering every text property per locale** with a completeness indicator.

**Logic:** conditional show/hide and page branching built from dropdowns, never formula strings.

**Distribution:** public link with open/close dates and response caps; unique per-recipient
tokenised link that prefills known fields; iframe or script embed; QR code.

**Responses:** save-and-resume, duplicate control (one per token / email / unlimited), webhook on
submission, and a submission grid using the shared grid with saved views and export profiles.

**On submission:** a confirmation to the submitter and a notification to an admin, both branded,
both in the submitter's locale, both sent through the mailer contract (or SMTP fallback), with
configurable recipients and immediate-or-digest delivery.

## 3b. Collaboration on a draft

A form is written by more than one person. Someone builds it, someone else has opinions about the
wording, and the second person usually must not be able to publish. Google Docs and Google Forms
are the reference point people will consciously compare this to.

**Per-form access, separate from the org-wide role.** §2's roles say what somebody may do in
general; this says what they may do to *this draft*. Three levels: **can view**, **can comment**,
**can edit**. Publishing stays with Admin regardless — a shared draft must never become a route to
putting something live.

**Comments.** Threads anchored to a **field id**, which the versioned JSON definition already gives
us as a stable identifier, plus threads on the form as a whole. Resolve and reopen. `@` mentions
that notify by email through the same transactional path as everything else. Comments live outside
the definition document: they annotate a form, they are not part of it, and a published version
must not carry them.

**Presence and concurrent editing.** Who else is in the builder right now, and where they are.
Two editors on one form must not silently overwrite each other — the autosave from phase 3a is
last-write-wins, which is exactly the wrong behaviour here.

The honest options, in increasing order of cost:

1. **Soft lock** — one editor at a time, others see it read-only and can take over when idle.
   Cheap, obvious to users, and covers a two-or-three person team completely.
2. **Field-level locking** — concurrent editing of different fields, conflicts only on the same
   field. Middle cost, fits the definition's shape well.
3. **CRDT** — genuine simultaneous editing. Correct, and the largest single piece of engineering
   in this document.

Start at 1. Most customers are three people and a deadline, not a newsroom.

**Draft sharing links.** A tokenised link that grants view-or-comment on an unpublished form
without an account, so an operator can get sign-off from somebody who will never log in. Expiring,
revocable, and never edit.

**Activity.** Who changed what in the builder, from the audit log that already exists, shown beside
the version history rather than as a separate feature.

### What this needs that does not exist yet

- A per-resource permission table. Roles are currently organisation-wide only.
- A live transport. Nothing in the product pushes to a browser today; presence and live comments
  both need one, and it is the piece most likely to constrain hosting.
- A notification path for mentions, which the phase 4 mail provider already covers.

## 4. Reference data and datasets

- **Reference tables:** operator-managed lookup tables with versioning and effective dates
  (thresholds, price lists, categories, ranges). Forms and formulas read from them, so changing a
  threshold does not mean editing every form.
- **Datasets:** a form's submissions, an imported file (CSV/XLSX with a saved column-mapping
  profile), or the output of another dataset. Typed schema with units, so the formula engine, the
  grid and the chart builder all understand the data.

## 5. Reports

**Report builder:** choose dataset → columns and computed columns → filters and grouping →
charts → layout → locale. Saved as a definition, runnable on demand, scheduled, or triggered by a
submission.

**Individual report** — one record, branded, in the recipient's locale: identification header, the
submitted values with units and any thresholds applied, computed values, flags with a legend,
photos where captured, comments, and an audit footer (submission timestamp, template version,
document hash, generation timestamp).

**Aggregate report** — across a filtered set: the grid view, summary statistics with n stated,
charts, group comparisons, and trends over time. Every figure drills through to the records
behind it.

**Bulk generation** is a background job with progress and a download when ready — a ZIP of
individual PDFs plus a merged file. Exports use the grid's parity rule.

**Amendments:** a released report is never silently edited. An amendment creates a new version
marked as such, showing what changed and why, with the superseded version still retrievable.

## 6. Segments

### 6.1 Events & registrations
Event and session records with capacity and waiting lists. Registration forms with attendee and
organisation details, role, attendance mode (in person / virtual), session selection, dietary and
accessibility needs, accompanying guests with a cap, and deadline enforcement.

**Admission document:** branded PDF per attendee with name, organisation, role, event, date,
time, venue and address, reference, admission type, sessions, entry instructions and a per-event
information block — plus a **QR code encoding a signed token**. Generated in the attendee's
locale, delivered as attachment or download, bulk-generated for a whole event.

**Check-in screen:** scan or type the reference, show the record, mark arrival with a timestamp,
reject duplicates and revoked entries. **Idempotent**, so an offline scanner can safely replay —
this is what makes a future mobile app cheap.

**Reports:** attendee list, check-in status, no-show analysis, session attendance, capacity
utilisation, and per-attendee confirmation documents.

### 6.2 Inspections & work orders
Generalised from vehicle servicing; also fits property, equipment and site inspections.

**Asset record:** identifier, type, make/model, year, owner (linked to a contact), grouping or
fleet, usage log with dated readings (mileage, hours, cycles), and full service history. For
vehicles: registration number, VIN, engine, fuel, transmission. Lookup by registration sits
behind an interface with a manual-entry default.

**Inspection form:** a checklist built in the form builder with per-item status (OK / advisory /
defect / not applicable), severity, note, and photos attached to the specific item. Items may
carry a **measured value with thresholds** — pad thickness, tread depth per position, disc
thickness, battery voltage — and the status sets itself from the threshold rather than the
inspector judging it. Thresholds come from a versioned reference table per asset category.

**Work order:** linked to an asset and an inspection. Labour lines (operation, description, hours,
rate), parts lines (part number, description, quantity, unit price, supplier), sublet,
consumables, with per-line VAT rate and totals. Status flow: draft → estimate → awaiting approval
→ approved → in progress → completed → closed.

**Customer approval** for work discovered mid-job: a link showing the extra items with photos and
cost, approved or declined with a timestamp and an audit record. Approval is by tokenised link
and recorded consent, not a legal e-signature — see §8.

**Reports:** inspection report with a traffic-light summary and photos; job card for the floor;
cost summary clearly marked as an estimate or completed-work summary and **not** an accounting
document; asset history over time; fleet report with cost per asset, cost per kilometre or hour,
downtime, recurring defects by make or model, and upcoming service due.

**Reminders:** service due by date or projected usage, pushed to the mailer as an audience.

### 6.3 Measurements & quality
Non-clinical measurement and statistics: manufacturing QC, environmental sampling, food and
agriculture, materials testing, research and training data. **Explicitly not** human clinical
diagnostics — see §8.

**Reference data:** parameters with name, code, unit, precision, method, limit of detection,
limit of quantification, measurement uncertainty, and acceptable ranges that vary by group
(product line, matrix, batch type). Ranges are versioned with effective dates.

**Sample registration:** identifier with a configurable format, sample type, collection date and
time, source reference, batch, storage condition, chain-of-custody entries, and a printable
barcode or QR label.

**Result capture:** manual entry with plausibility validation, or instrument import (CSV/XLSX/TXT
with a saved mapping profile per instrument), with a review-and-accept step before results become
final. Replicates supported with automatic mean, SD and coefficient of variation.

**Flagging:** below LOD, below LOQ, outside range with direction, delta from previous beyond a
threshold, and QC rule failures. Flags render as symbols with a legend and drive a summary status.

**Quality control:** control samples with target and SD, a Levey-Jennings style control chart
with ±1/2/3 SD bands, and configurable violation rules (one point beyond 3 SD, two consecutive
beyond 2 SD, runs, trends). A failed QC batch blocks release until an operator overrides with a
logged reason.

**Reports:** per-sample certificate (results, units, ranges, flags, method, uncertainty, operator,
reviewer, dates); statistics report (descriptive stats, distributions, trends, group comparisons,
regression, QC summary); batch and trend reports.

### 6.4 Surveys & feedback
Anonymous or identified, single or recurring waves, comparison between waves, response-rate
tracking, likert and NPS-style scales with the appropriate aggregations, and free-text responses
in a reviewable grid. No sentiment scoring or automated interpretation.

## 7. Stack

React + TypeScript, a modern meta-framework, Tailwind wired to tokens, headless component
library, dnd-kit for the builder, TanStack Table plus a virtualiser for the grid. Typed API with
Zod schemas shared client and server, OpenAPI generated from them. PostgreSQL with a typed ORM;
form definitions and report definitions stored as **versioned JSON documents**, never HTML
strings; indexes designed for grid sort and filter at `{{R}}` rows. S3-compatible file storage
with signed URLs and virus scanning. Durable job queue with retries and idempotency keys for
bulk PDFs and exports. Server-side HTML-to-PDF with embedded fonts.

## 8. Deliberately deferred

Not built now. Each is a gated module for later, and each needs specialist input before it is
worth starting.

- **Legally binding e-signature** (BankID, MitID, FTN, Freja, itsme, iDIN). The architecture keeps
  the door open: a `SigningProvider` interface with a mock implementation, sealed immutable
  submissions and hashed evidence records. Until a real provider is contracted, approvals are
  **recorded consent with an audit trail**, and the UI must never call them signatures.
- **AGM postal voting and proxy/power of attorney.** Vote tabulation across share classes, weighted
  voting, majority thresholds and country-specific POA wording. Highest-value module in the
  corporate market and the most exacting; do it deliberately, with counsel, not as a side effect.
- **Accounting.** If it happens, reporting-only against an imported trial balance or SIE file, with
  no posting UI. A ledger of record is out of scope.
- **Clinical diagnostics.** Out of scope permanently unless someone takes on medical device
  regulation.

State these boundaries in the product UI, not only here.

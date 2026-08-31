# Start here

The other documents describe a destination. This one describes the first six weeks. If the two
ever disagree, this one wins.

## Honest position

What we have specified is roughly three years of work for a team. Written as a plan it would
fail; written as a destination it is useful, because it stops you making choices now that block
things later. Treat `SPEC-*.md` as reference material you consult when a decision has long-term
consequences, and treat this file as the plan.

The single most common way projects like this die is building the platform instead of the
product — six months of grid, token and formula engine work with nothing a real person uses. The
first slice below deliberately builds one narrow thing end to end.

---

## Five decisions before any code

Answer these in writing. They change the build, and changing them later is expensive.

1. **Who is the first real user?** A named person or team with a problem you have watched them
   have. Not a market segment. If you cannot name them, that is the first task, not the code.
2. **Which segment first?** Recommendation: **Events & registrations**. Least regulated, clearest
   buyer, and its output exercises both hard technical bets at once (branded PDF and delivered
   email). Inspections is the reasonable alternative if your first user is a workshop.
3. **One builder or two?** If it is you alone with Claude Code, build **sequentially** — see
   "About the parallel tracks" below.
4. **Where does it run, and where may data sit?** Pick the hosting region and the email provider
   region now. Both are painful to move once you have customer data.
5. **What would make you stop?** Write the condition down now, while you are still objective.

---

## The first slice: v0.1

One loop, end to end: **a form is filled in → a record exists → a branded PDF comes out → an
email arrives → someone is checked in at the door.**

That is a complete, sellable product on its own: a registration and check-in tool for
conferences, capital markets days, seminars and internal events.

### In scope

- Auth for a single organisation. Admin and Operator roles only.
- Brand Kit: colours, two fonts, logo, and nothing else. Compiled to web CSS, PDF stylesheet and
  inline email styles. **Prove all three from one token change before building anything else.**
- Form builder with a deliberately small field set: short text, long text, number, email, phone,
  date, single select, multi select, yes/no, section break, page break, rich text, hidden
  prefill field. Required, placeholder, help text and simple validation. Drag to reorder.
- Two languages, chosen at the start: a language dropdown on the public form that survives a
  multi-page flow without losing entered data, and a per-locale translation tab in the editor.
- One event object: name, dates, venue, capacity, description. Registration closes on a date and
  at capacity.
- Public form link, open and close dates, save-and-resume, duplicate control by email.
- Submissions table: sort, filter, column chooser, CSV and XLSX export. Use a library. Do not
  build the full grid from `SPEC-shared.md` yet.
- Admission PDF: branded, in the attendee's language, with the event details and a QR code
  encoding a signed token.
- Confirmation email to the attendee with the PDF attached, and a notification email to the
  operator. Sent through a real provider with the sending domain verified.
- Check-in screen: scan or type the reference, show the record, mark arrival, reject a second
  scan. **Idempotent**, because that is what makes an offline mobile scanner cheap later.
- Seed script producing a demo event with ~200 registrations.

### Explicitly out of scope for v0.1

Formulas, charts, statistics, reports beyond the admission PDF and the CSV export, campaigns,
audiences, recurring schedules, inspections, measurements, surveys, multi-tenancy, SSO, e-signing
of any kind, and the second product. All of it is specified elsewhere and none of it is now.

### Done means

- Changing the primary colour once visibly changes the app, the PDF and the email.
- A registration submitted in Swedish produces a Swedish confirmation and a Swedish PDF.
- The confirmation lands in a real Gmail and a real Outlook inbox, not a spam folder.
- The QR scans on a phone, admits once, and refuses the second attempt.
- The CSV opens in Excel with Swedish characters intact.
- Your first real user runs one real event on it.

The last one is the only criterion that matters. The others are how you get there.

---

## Sequence

Six phases. Each ends with `pnpm verify` passing and something demonstrable.

**0 — Skeleton (2–3 days).** Monorepo, TypeScript, lint, tests, `pnpm verify`, CI, Postgres in
Docker, first migration, health check, deployed to the real hosting target. Deploy on day one, not
at the end.

**1 — Tokens across three targets (3–4 days).** `packages/tokens` as JSON, the three compilers,
and a throwaway page that renders the same card as web, PDF and email side by side. This is the
riskiest bet in the whole product and the cheapest place to discover it does not work.

**2 — Auth, org, event (3–4 days).** Magic link, bearer tokens, roles, audit log, event CRUD,
app shell, and the language configuration.

**3 — Form builder and public form (1.5–2 weeks).** The field set above, drag-and-drop,
versioning, the public renderer with the language dropdown, translations, validation,
save-and-resume, submissions table with export.

**4 — Documents and email (1 week).** Admission PDF with signed QR, provider integration, domain
verification with live SPF/DKIM/DMARC checks, confirmation and notification emails, bulk PDF
generation as a background job.

**5 — Check-in and a real event (1 week).** Check-in screen, idempotent scanning, attendee and
check-in reports, then run a real event and fix what breaks.

Six weeks is optimistic and assumes focus. Eight is realistic. If you are at week ten still in
phase 3, the field set is too big — cut it.

---

## Running it with Claude Code

Put `CLAUDE.md` at the repo root and this file plus the specs in `docs/`. Then, per phase:

> Read `docs/START-HERE.md` phase {N}, and the sections of `docs/SPEC-forms.md` and
> `docs/SPEC-shared.md` it references. Enter plan mode. Plan the files, the schema changes, the
> endpoints with their Zod schemas, and the tests. List anything ambiguous. Do not write code
> until I approve the plan.

And to close a phase:

> Run `pnpm verify` and `pnpm test:e2e`. Fix what fails. Update `docs/PROGRESS.md` with what
> shipped, what you deferred and why, and any assumption I should check. Write a PR description.
> Do not start the next phase.

Rules worth holding to:

- Plan mode every phase. Read the plan properly — it is cheaper to argue with a plan than a
  codebase.
- One phase per branch, small commits.
- When the session gets heavy, have it write state to `docs/PROGRESS.md` and start fresh from
  there. Do not run the whole project in one session.
- When it proposes building something from `SPEC-*.md` that is not in v0.1 scope, say no. It will
  propose this often; the specs are seductive.

---

## About the parallel tracks

`SPEC-mailer.md` and `CONTRACT.md` describe a second product built alongside. That is the right
structure and the wrong sequence for one person.

Build v0.1 with a **thin transactional sending path** — provider integration, domain
verification, a handful of templates. You need that anyway for confirmations. Sendwork becomes a
real product later, when you have a customer who wants campaigns and does not want forms. The
contract already exists on paper, so splitting it out then is a refactor, not a rewrite. That is
what the contract document is actually buying you: permission to delay.

If you genuinely have a second builder, then yes, run the two tracks — and freeze
`docs/CONTRACT.md` before either writes code.

---

## Checkpoints

**After phase 1.** If one token change does not reach web, PDF and email, stop and solve that.
Everything downstream assumes it.

**After phase 4.** If email does not reliably land in real inboxes, the problem is domain
reputation and configuration, not code. Solve it before building more features on top.

**After the first real event.** Ask the user what they actually did outside the tool —
spreadsheet exports, manual chasing, things they worked around. That list, not this document, is
your v0.2 scope.

**If after three months there is no real user.** The problem is not the product.

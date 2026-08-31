# Sendwork — customised and recurring email

Read `SPEC-shared.md` first. This product stands alone: a customer can buy it with no forms
product at all, importing audiences from CSV. Its integration with Formwork is the contract in
`CONTRACT.md` and nothing more.

## 0. Parameters

Name `{{NAME}}` · locales `{{LOCALES}}` · volume `{{M}}` emails/month, largest single send
`{{X}}` · provider `{{ESP}}` · data residency `{{DATA_REGION}}`.

## 1. Objective

A campaign tool for people who send the same kind of message every month to a list that keeps
changing, where each recipient's copy differs. Non-technical operator, unsupervised, monthly.

## 2. Contacts and audiences

- **Contacts:** email, name, preferred locale, tags, and user-definable custom fields typed as
  text, number, date, boolean or enum. Import from CSV/XLSX with column mapping, duplicate
  detection and a merge step. A saved mapping profile per source so next month's import is one
  click.
- **Static lists** and **dynamic audiences** defined by filter rules over fields, tags, campaign
  history and delivery history. Dynamic audiences resolve **at send time**, never at creation.
- **External audiences** pushed or pulled through the contract (§CONTRACT 1.3, 2.1).
- Always show a live recipient count and a sample of ten matching contacts before anything sends.
- Contacts are managed in the shared grid: sortable, filterable, groupable, exportable.

## 3. Segment types

Three, each with its own rules. This distinction is enforced in code, not left to the operator.

| Segment | Nature | Consent basis | Unsubscribe | Cadence |
|---|---|---|---|---|
| **Marketing** | Commercial | Opt-in, with source and timestamp recorded | Mandatory, honoured globally | Ad hoc or monthly |
| **Monthly rent** | Contractual / transactional | The contract, not marketing consent | Must **not** be stopped by a marketing unsubscribe; a separate delivery preference only | Fixed monthly |
| **Events** | Invitations and logistics | Configurable; invitation and logistics are distinct | Honoured for invitations; logistics to a registered attendee is transactional | Campaign-driven |

Suppression entries carry a **scope**. A marketing unsubscribe must never silently stop a rent
notice or an event confirmation someone asked for. Warn the operator when a campaign's segment
type and its content look mismatched — a rent template in a marketing campaign, or the reverse.

## 4. Templates

Block-based editor on the shared tokens, compiling to email-safe inline styles and table layout.
Blocks: heading, text, image, button, divider, spacer, columns, table, chart image, attachment
list, footer with the legally required sender identity and unsubscribe.

**Personalisation:**
- Merge fields with fallbacks: `{{first_name | there}}`.
- **Conditional blocks** — show or hide a whole block per recipient based on a field.
- **Repeating blocks** driven by per-contact data: rent lines, holdings, sessions booked, assets
  due for service.
- A **period context** object available to every template — month name, quarter, period start and
  end, due date, days remaining — so a monthly template writes itself from the calendar.
- **Charts** rendered per recipient from their own data, as a static image with alt text.

**Multilingual templates:** one template with per-locale content, sending each contact their
preferred locale, with a completeness indicator and a block on sending with gaps unless
overridden. Every email links to a web version, which offers the other locales.

**Transactional templates** are a separate class with declared merge fields, callable through the
contract by key. They are exempt from marketing suppression and marked as such in the editor.

## 5. Campaigns

**Object:** name, segment type, template, audience, schedule, sender identity, approval setting,
tracking settings, locale strategy.

**Schedule:** one-off at a datetime, or recurring through a plain-language rule builder — "day N
of every month", "first / second / third / last {weekday}" — with time, timezone, and
weekend-and-holiday shifting. Show the next five computed dates so the operator can check the
rule before trusting it.

**Approval:** a recurring campaign generates a **draft** at a configurable lead time and notifies
the operator. It sends only after approval, or after an auto-approve delay the admin sets
explicitly. Nothing goes out unattended by default.

**Pre-send checks, all blocking:**
- Recipient count and audience summary on the confirm screen.
- Mandatory test send with a real sample contact's merged data.
- Empty merge field with no fallback → blocked, listing the affected recipients.
- Missing translation for a recipient's locale → blocked or explicitly overridden.
- Link checker across every URL.
- Sending domain unverified → refused outright.

**Post-send:** delivery, bounce, open and click tracking, each disableable per campaign; a
per-recipient log of exactly what was rendered and sent; re-send to failures only.

## 6. Deliverability and compliance

- Guided sending-domain setup: SPF, DKIM and DMARC with live check status. Refuse to send from an
  unverified domain — no override.
- Provider integration behind a `MailProvider` interface, with bounce and complaint webhooks.
  Choose a provider whose region matches `{{DATA_REGION}}`.
- Hard bounces suppress permanently; soft bounces retry with a cap then suppress.
- Complaints suppress immediately, globally, across every scope.
- One-click unsubscribe with `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
- A hosted **preference centre**: choose which segments to receive, change locale, update details,
  or unsubscribe from everything.
- Consent status, source and timestamp per contact. Per-contact data export and erasure.
- Send-rate throttling and warm-up scheduling for a new domain.

## 7. Reporting

Campaign performance (sent, delivered, bounced, opened, clicked, unsubscribed, complained), trend
across recurring runs, per-recipient message log, audience growth and churn, and deliverability
health by domain. All in the shared grid with export parity, plus charts from `packages/calc`.

## 8. Stack

Same foundation as Formwork: React + TypeScript, typed API with shared Zod schemas, PostgreSQL,
S3-compatible storage. The **durable job queue is load-bearing here** — every send is a job with
retries and an idempotency key, and a send is never issued from a request handler or a naive cron
loop. Rendering runs per recipient and stores the rendered output reference on the message row.

## 9. Deliberately not built

SMS, push and WhatsApp channels. A/B testing. AI copywriting. A template marketplace. Lead
scoring or a CRM. Your own SMTP infrastructure — always integrate an established provider.

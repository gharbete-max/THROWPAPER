# Handover

For a fresh session picking this up. Read `CLAUDE.md` first, then `docs/CONTRACT.md`, then
`PRE-LAUNCH-AUDIT.md`. Do not paste specs into `CLAUDE.md`.

## State

- `main == origin/main`, clean, no open PRs. Last merge: #63.
- PRs #53–#56 and #63 landed a code review, the invoice PDF, demo readiness, and Phase 1
  security + authorisation. **1235 tests.** `pnpm verify` and `pnpm contract:check` both pass and
  together are the definition of done.
- A pre-launch brief is being worked in phases. **Phase 0 (audit) and Phase 1 (security) are
  complete** and written up in `PRE-LAUNCH-AUDIT.md`. **Phase 2 (EU/Swedish legal) is blocked.**
  Phase 3 is a fortune-teller / folding-paper restyle. Phase 4 is polish and SEO.

## House rules that bite

- One phase per branch; commit per item. `pnpm verify` before calling anything done.
- **Evidence, not claims:** a diff, a passing test, or tool output. Never a TODO.
- Ask before adding a dependency, changing the data model, or changing legal copy.
- `CLAUDE.md` rule 8: never generate legal, clinical, tax or safety-critical wording. The proxy
  template shows the pattern — ship structure, leave the operative sentence as an explicit
  bracketed placeholder.
- Windows dev machine. **`&` in npm scripts does not background** (cmd.exe treats it as a
  sequential separator); use `pnpm --parallel`.
- **Verify a test discriminates:** stash the fix, confirm it fails, restore. A test that only
  passes after a fix proves nothing on its own.

## Blocked on the owner — Phase 2 cannot start without these

Registered company name, organisationsnummer and address; contact and privacy-request addresses;
**database and application hosting provider + region** (undecided since the demo phase; blocks the
privacy page and is the only open third-country-transfer question); retention periods per data
type; whether the product sells to consumers; headcount and turnover for the EAA microenterprise
exemption; whether a DPO exists; domain and canonical host; whether `api-mailer` will send
marketing email.

## Facts already established — do not re-derive

- The app sets **no cookies**, has no analytics, no external origins, and self-hosts fonts
  byte-inlined. **No cookie banner is required as the software stands** — that stops being true
  the moment analytics is added, so §2.2 and Phase 4's analytics item must be decided together.
- **No cross-organisation IDOR:** all 40 routes were traced to the query behind them.
- Auth is magic-link only. There are no passwords, so "MFA" means a second factor on the link.
- `LEGAL-REVIEW.md` already lists 22 pending business facts, rendered as visible amber markers on
  the five policy pages. Extend that file rather than duplicating it.

## Next unblocked work — pick one

1. **Item 12 — the anonymous-upload sweeper.** The index already exists in `schema.ts`
   (`form_uploads_unclaimed_idx`, commented *"finding what to sweep"*); only the job is missing.
   Unbounded anonymous disk growth today, and also a Phase 2 retention item.
2. **Items 14–17** in `PRE-LAUNCH-AUDIT.md`: `publicToken` in the invoice list, unchecked
   `eventId`, `JWT_SECRET` doing double duty as the document HMAC key, and the single-tenant
   public surface (`/f/:slug` resolves the org as `organisations.first()`).
3. **The catalogue architecture note** (below). No code.
4. `TRUST_PROXY` is configurable and empty. The day this deploys behind TLS, six requests disable
   sign-in for a whole tenant. **The value depends on the host**, so it is blocked with Phase 2.

---

## The catalogue direction — decide on paper before authoring templates

The product is to cover forms across verticals — real estate, AGM/EGM, small business, trades,
misc events — through an Akinator-style flow: *"what business are you in"* (including **none**,
which covers misc events), then a multi-select matrix of what the form should contain, then a
composed result, then easy-or-advanced customisation. Community sharing of forms is wanted later.

**This is composition, not retrieval.** You author blocks, not paths, and the millions are
combinations. That distinction matters: an earlier critique in this project claimed the wizard
"will not scale to millions of forms", and that critique was aimed at *selecting one leaf from a
library*. It does not apply to composing a form from selected blocks, which scales on a few dozen
authored blocks.

`packages/shared/src/wizard/tree.ts` **already composes**: `WizardOption.contributes` supplies
items and `WizardTree.keyOf` deduplicates them — *"two paths can both ask for an email address; a
form with two email boxes is a form somebody fills in twice."*

**What must change is the guarantee, not the model.** `WizardOption.next` fixes the question
order, and `everyPath()` — today's proof that no path dead-ends and nothing takes more than four
presses — becomes 2ⁿ once answers are multi-select. So:

- Keep `contributes` and `keyOf`.
- Replace `next` with a sector-selected question **set** (order-independent facets).
- Replace exhaustive path enumeration with three cheaper invariants: every question reachable,
  every contributed key resolvable, and no duplicate keys in any combination.

Two consequences to decide deliberately rather than drift into:

- **Trades and law are safety-critical and legal wording** — rule 8. Ship structure with bracketed
  placeholders, as the proxy template does.
- **Community sharing introduces public UGC**, which flips the Phase 0 classification and brings
  DSA notice-and-action, a published point of contact, moderation terms, and a contribution
  licence. Phase 0 concluded DSA does not currently apply *because* there is no public UGC.

### Verified-MIT resources — never ship anything unverified

`surveyjs/survey-library` (MIT; Creator/PDF/Dashboard are separate commercial products) — **do not
adopt**; it would replace a builder and renderer already translated into twelve languages with
SSR, print CSS and PDF. Take its question-type taxonomy as a checklist and its JSON schema as an
**import target**, which is worth more to a community catalogue than a rendering engine.
`FormBold/html-form-examples-templates` (MIT, no attribution required) — useful as field-list
content, not code. `formml/formml` (MIT) — skip; the Zod `FormDefinition` already covers it. The
other four repositories suggested are irrelevant to a TypeScript stack or actively wrong for it —
in particular a bulk-mail script is the opposite of rule 7 and of marknadsföringslagen.

---

## Reconciliation of styling

Phase 3 calls itself a redesign — *"treat the current look as evidence of what the site needs to
do, not as something to preserve"*. That is right about the **visual world** and wrong if read as
"start from an empty stylesheet". Here is what actually exists and how it reconciles.

### What already exists, and is an asset rather than debt

| Thing | Where | Bearing on Phase 3 |
|---|---|---|
| **A real token layer** | `packages/tokens` | One JSON set compiles to **four** targets: web CSS vars (`--tp-*`), inline email styles, print CSS, and native values. A new palette and type scale propagate without touching components. |
| **`DESIGN.md` + sidecar** | repo root, `.impeccable/` | `impeccable context` reads these as the incumbent authority. A redesign **replaces** `DESIGN.md`; it does not ignore it. |
| **A fold interaction, already built** | `apps/forms/src/lib/fold.ts` | The crease-on-press already exists, as one document-level listener. Phase 3's motion vocabulary starts here, not from nothing. |
| **The `.system` boundary** | `App.tsx`, `Login`, `Callback`, `site/Site.tsx` | **The single most important fact below.** |
| **A reduced-motion guard with a test** | `styles.css`, `lib/motion.test.ts` | `motion.test.ts` asserts the property against the stylesheet itself. Any new motion must keep it passing. |
| **Runtime brand override** | `lib/brand.tsx`, `PublicForm.tsx` | Tokens are re-emitted at runtime from the organisation's brand kit. |

### The boundary that governs the whole restyle

**`.system` marks the surfaces that are ours.** The app shell, the marketing site and the sign-in
screens carry it. **The published form deliberately does not** — it wears the customer's brand and
is read by their members. `fold.ts` says it plainly: *"a folding animation nobody chose is our
design arriving uninvited on somebody else's registration page."* The CSS is scoped the same way,
so neither half can drift into the form on its own.

So Phase 3 splits cleanly, and the brief's "one confident accent" applies to only one side:

- **Inside `.system`** — the marketing site, shell, sign-in. Formwork's own identity. This is where
  the fortune teller, the fold motion, the crease shadows and the single accent belong, and where
  the paper white / ink / crease grey palette is Formwork's to choose.
- **Outside `.system`** — the published form, the invoice, the admission card. These are rendered
  in **the customer's** palette from their brand kit. A fortune-teller accent applied here would
  fight the organisation's own colours, which is the feature they pay for.

Getting this wrong is the most likely way Phase 3 damages the product, and it will not show up in
a screenshot of the marketing page.

### Constraints the restyle inherits

1. **Rule 4 still applies.** Crease gradients, fold shadows and the light direction must become
   tokens in `packages/tokens`, not literals in `styles.css`. A hard-coded `rgb(0 0 0 / 0.18)` was
   already removed once from `Flag.tsx` for exactly this reason.
2. **A token change propagates to email, print and PDF.** The fold motion is web-only, but the
   palette and type scale reach the invoice PDF and the admission card. Check
   `compile-email.ts`, `compile-pdf.ts` and `compile-native.ts` before changing a primitive.
3. **`styles.css` is one 5,060-line file with no module boundaries.** This is the main structural
   risk: a redesign touches it everywhere at once. Consider splitting it *before* restyling, not
   during.
4. **`motion.test.ts` and the reduced-motion block must survive.** Phase 3's own brief agrees:
   reduced motion replaces every fold with a cross-fade, including the loader.
5. **The CSP permits no external origins.** Fonts are self-hosted and byte-inlined. Any new face
   must be OFL and self-hosted the same way — which also keeps the Phase 2 transfer answer at
   "none".
6. **Baseline for comparison:** 36 screenshots (18 templates × desktop/mobile) were captured in
   Phase 0 with the Playwright already in the repo. They live in a session scratchpad and **will
   not survive** — recapture or commit them before starting Phase 3, or there is nothing to
   compare against. Note they were taken against `pnpm demo`, which is Vite, so site-page titles in
   them show the SPA shell rather than the SSR output.

### Verdict

**A token swap plus a targeted rewrite, not a rebuild.** Colour, type, spacing and radius all flow
from `packages/tokens`, so the palette and scale are cheap. What is genuinely new work is the
fortune-teller mark, the fold/motion system beyond the existing press crease, and the geometry of
surfaces. Budget Phase 3 as *"tokens change cheaply; identity and motion are built from scratch;
the `.system` boundary decides where either is allowed to appear."*

Do not run `impeccable` and `ponytail` in the same pass — they pull in opposite directions. Design
first, then a single ponytail pass to remove what turned out to be dead.

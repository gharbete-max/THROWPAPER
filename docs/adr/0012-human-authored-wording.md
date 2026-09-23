# ADR 0012 — Signature, consent and payment wording is human-authored, versioned, and never generated

**Status:** proposed
**Date:** 2026-09-23
**Extends:** `CLAUDE.md` rule 8 to the three new surfaces the expansion adds — signing, AI, and money
documents sent at scale.

## Context

Rule 8 already holds, and the repo already has the pattern: *"ship structure, leave the operative
sentence as an explicit bracketed placeholder"* (`HANDOVER.md`), and `apps/forms/src/site/legal.ts`
renders every unknown fact as a visible amber "to be confirmed" marker. `templates.test.ts` checks
template wording against a forbidden list.

The expansion multiplies the places operative wording appears:

- the **declaration** a signer approves ("I have read and agree to …"), shown on a phone by an eID
  app and stored as evidence;
- the **signature-level label** ("advanced electronic signature") — a legal claim (ADR 0009);
- **consent texts** on forms that collect identity numbers or special-category data;
- **invoice and rent-notice terms**, reminders, late-payment text;
- the **AI** (ADR 0013), which can produce fluent versions of every one of the above on request.

## Decision (proposed)

1. **Operative wording is data with an author.** A `WordingTemplate` (per organisation, or Loppa's
   own when counsel has approved it) has: key, locale, text, version, `authoredBy` (a user id),
   `approvedAt`, and optionally `reviewedBy` (counsel). Published versions are immutable, like
   `form_versions`. Evidence and sealed PDFs reference the exact version.
2. **The code ships no default operative sentence.** Where one is needed and none is authored, the
   surface renders the existing amber placeholder, and a **send or sign action is blocked** — not
   warned — until a human-authored version exists. A blocked flow is recoverable; a signed
   document with invented wording is not.
3. **The AI never drafts wording in these classes.** The AI interface (ADR 0013) receives a
   classification of the target field; for `declaration`, `consent`, `legal`, `payment-terms` and
   `signature-level` it refuses and says the text must come from the organisation. Tested with the
   same forbidden-list approach `templates.test.ts` uses, plus a test that the refusal happens
   before any provider call.
4. **Translations of operative wording are human too.** Machine translation of a declaration is
   generated legal wording (the policy pages are English-only for this reason —
   `LAUNCH-CHECKLIST.md` §1.1). Each locale is its own authored version; a missing locale falls
   back to one a human authored, never to a translation Loppa made.
5. **Loppa's own defaults, if any are ever wanted, go through counsel** and are listed in
   `LEGAL-REVIEW.md`, not written in code.

## Decided (2026-09-23) — what the drawn field is called

The owner asked for whatever is most usual for these services. The e-signature products people
already know (DocuSign, Adobe Acrobat Sign, Scrive, Dropbox Sign) all call a drawn or typed mark a
**signature**, and eIDAS itself treats such a mark as the lowest level of electronic signature.
So:

- The field, the button and the pad say **"Signature" / "Sign"** in every locale. That is a
  control label, not a claim.
- The **level is never claimed** by default wording. Loppa's UI names the *method and time*:
  "Signed by drawing, 23 Sep 2026 14:02" or "Signed with BankID, 23 Sep 2026 14:02". The words
  "advanced", "qualified", "legally binding" or their translations appear only in text that counsel
  approved (a `WordingTemplate` with `reviewedBy` set), and only on evidence that carries that
  level.
- `SPEC-forms.md` §8 was amended the same day to match.

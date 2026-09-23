# ADR 0013 — AI assistance: provider-agnostic, EU by default, opt-in, drafts only

**Status:** proposed — the provider is the owner's choice (`LAUNCH-CHECKLIST.md` §6)
**Date:** 2026-09-23

## Context

The brief wants AI to build a form from a description or a scanned page, suggest field types and
validation, map scanned fields, and summarise responses — with a human confirming every output.

Three facts from the repo shape this more than any model choice:

- **The app has no external origins today.** No analytics, no CDN, CSP `'self'`, fonts
  byte-inlined, and **the privacy page's transfer answer is "none"** (`HANDOVER.md`, facts
  established). An AI provider is the first third party that would receive customer *content*.
- **OCR already runs in the browser** (`apps/forms/src/screens/builder/paper/ocr.ts`,
  tesseract.js, self-hosted) precisely so a photograph never leaves the device, and ADR 0004
  (accepted) rules that **OCR never creates a field** — it offers words beside a box a human drew.
  "AI maps scanned fields" re-opens that decision. This ADR treats it as a deliberate, opt-in
  exception, not a quiet reversal.
- **Hosting region is still undecided** (`LAUNCH-CHECKLIST.md` §3). The AI region should follow it.

## Decision (proposed)

### Interface

`AiProvider` in the Forms backend (server-side only — keys never reach the browser), with a
`console` implementation that returns fixed, obviously-fake drafts so the whole flow is testable
without a provider or network, as the mail and signing seams already do.

```ts
interface AiProvider {
  readonly name: string;
  readonly region: string;          // recorded on every call's log row
  draft(task: AiTask, input: AiInput): Promise<AiDraft>;  // never saves, never sends
}
type AiTask = 'form-from-description' | 'form-from-page' | 'suggest-validation'
            | 'map-scanned-fields' | 'summarise-responses';
```

- **Output is a draft object, validated by the same Zod schema as a human edit**
  (`FormDefinition`), rendered in the editor with a visible "suggested" state. Nothing is persisted
  until the author accepts; accepting is an ordinary, audited save by that user.
- **Refusals before calls**: ADR 0012's wording classes are refused locally, before any provider
  request.
- **Summaries are labelled as generated** in the UI and in any export, and never sent onward
  automatically.

### Data handling

- **Off by default, opt-in per organisation** by an admin, per task (an org may allow
  "form from description" and refuse "summarise responses", which sends respondent data).
- **EU region by default**; the provider is configured, never hard-coded (`AI_PROVIDER`,
  `AI_REGION`), and a non-EU region needs an explicit second setting.
- **No training on customer data**, as a contract term with the provider, not a setting we trust.
- **What is logged**: organisation, user, task, provider, region, model id, token counts, latency,
  outcome (accepted / edited / discarded). **Not** the prompt or the response, by default. An org
  may opt into 30-day content retention for support; that is a separate switch.
- **Minimise input**: "form from a page" sends the on-device OCR text and layout boxes first; the
  image is sent only if the org has opted into image processing.
- The provider becomes a sub-processor on the privacy page, and the "no transfers" answer changes.
  **That page change is counsel's**, and the feature does not ship before it.

### Providers to compare (verify before choosing)

| Option | EU processing | No-training term | Notes |
| --- | --- | --- | --- |
| Anthropic Claude via AWS Bedrock (EU regions, incl. Stockholm†) | yes† | yes† | Strong structured output; US parent company |
| Anthropic Claude via Google Vertex AI (EU regions†) | yes† | yes† | Same models, different cloud |
| Anthropic API direct | check current data-residency offer† | yes† | Simplest integration |
| Mistral (La Plateforme, EU) | yes, EU company† | yes† | EU-native; avoids the US-parent question |
| Azure OpenAI (EU data zone†) | yes† | yes† | US parent |
| Self-hosted open-weights model in the chosen EU host | yes | n/a | Most private, most ops, weakest output |

**Recommendation:** build against the interface with the console provider in P5, then trial two —
one hyperscaler-hosted Claude option in an EU region and Mistral — on the same fixed task set
(ten real form descriptions, ten scanned pages), measured by how often the author accepts the
draft unedited. Choose on that number and on counsel's view of the US-parent question.

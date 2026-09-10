# ADR 0001 — Theming layers, and what none of them may touch

**Status:** accepted for the locked list, proposed for layers 2 and 3
**Date:** 2026-09-10

## Context

Two requirements pull against each other. Paloppa has an identity — a mark, two hue families, a
paper canvas — and the product's selling point is that an organisation replaces it. Left
unstructured, "the customer can change things" becomes "every value in the app is customer
controlled", at which point nothing can be designed and nothing can be tested.

The repo already had one theming layer and it is open: `brand_kits` stores a **whole `TokenSet`**
per organisation as `jsonb`, and `DESIGN.md` says plainly that an organisation may replace the
entire palette. That is a shipped feature, not an accident, and it is the right feature — the form,
the invoice and the admission card are the organisation's documents and should look like theirs.

What it lacked was a floor.

## Decision

### The layers, and what each one is for

```
0. Paloppa brand      packages/tokens/default-tokens.json   always present, the fallback
1. Client theme       per organisation, white-label         Paloppa's own chrome wears the
                                                            customer's identity
2. Organisation kit   brand_kits, the whole TokenSet        the customer's documents look like
                                                            theirs — already shipped
3. Form theme         per form, editor + advanced           one form deviating from its
                                                            organisation's kit
```

The brief describes three layers and this is four, because the layer it calls "client theme" and
the one this repo already has are **not the same thing** and collapsing them would be a regression.

- **The client theme is narrow on purpose.** It overrides *our* chrome: accent, logo light and
  dark, wordmark text, favicon, email header. We keep design control of everything else, because
  what is being themed is the Paloppa application, not the customer's document.
- **The organisation kit is wide on purpose.** It themes *their* outputs. Narrowing it to an accent
  would take away a feature customers already have, to satisfy a contract written for the other
  scope.

A form theme is layer 3 and does not exist yet: `FormDefinition` is `{schemaVersion, fields,
settings}`, purely structural. Today every form inherits its organisation's kit, which is the right
default and is why layer 3 is an addition rather than a repair.

### Layers 1 and 3 are custom properties on a scope element

Not compiled per-tenant stylesheets: one cached bundle for every tenant, no build step per
customer, and a form's scope nests inside an organisation's without a cascade fight. This matches
how layer 2 already reaches the page — `toCssBlock` writes `:root { --tp-* }` and `brand.tsx`
re-emits it at runtime.

### The locked list is code, not documentation

**Implemented now**, because it protects the layer that already ships:

| Guarantee | Mechanism |
| --- | --- |
| Focus ring visible on **both** the page and a card | `focusRing()`, derived; `--tp-focus` |
| A filled button's label is readable | `buttonSurface()` walks the fill until one is |
| Tap targets ≥ 44px | `controlHeight` floored in the schema |
| Inputs ≥ 16px, so iOS does not zoom | `baseSize` floored in the schema |
| Controls have a visible edge | `borderWidth` floored at 1px |
| Label-to-input association | Structural, in the markup; no token reaches it |

`locked.test.ts` asserts these against six themes a customer could plausibly save, in light and
derived dark, and each guarantee was checked by removing it and watching the test fail.

Two decisions inside that are worth stating:

**Sizes are clamped, not rejected.** `resolveTokens` falls back to the *entire* default kit when a
stored row fails to parse, so rejecting a 30px control height would answer that by silently
discarding the organisation's colours, fonts and logo too. A floor keeps every choice that is
theirs and holds the one that is not.

**`checkContrast` is not the mechanism and must not become it.** Its findings are deliberately
advisory — refusing to save a brand over one subtle border would be obnoxious. That makes it the
wrong instrument for a guarantee: a warning somebody can click past is not a floor. It stays
advisory, and the locked list is absolute.

## Consequences

- A customer cannot remove the focus ring, shrink a target below a thumb, or make a button label
  unreadable, whatever they set. They can still make the product ugly, which is their right.
- `focusRing` derives from `secondary` and keeps it when it clears 3:1 on both surfaces, so a
  themed interface keeps a themed ring. Twelve outlines that reached for `--tp-colour-secondary` or
  `--tp-colour-primary` now read `--tp-focus`; the stylesheet must never reach for a brand colour
  for an outline again.
- Three near-identical lightness walks became one `walkAway`. Three copies of that loop is three
  places for the direction to be got backwards, which means darkening a colour on a dark page.
- **The closed contracts for layers 1 and 3 are specified here and not yet implemented as typed
  objects.** There is nothing to validate until those layers exist, and an abstraction with no
  consumer is the thing the reduction pass would delete. The boundary is the decision; the code
  arrives with the layer it bounds.

## Client logos: SVG stays refused

`BUILD-BRIEF.md` §4 says "SVG preferred, PNG accepted" and "sanitise uploaded SVG — strip
`<script>`, event handlers and external references. An SVG upload field is an XSS vector; treat it
as one."

This repo already treats it as one, and more strongly: `checkImage` **refuses SVG outright**, with
a distinct `svg-not-supported` code so the message can name a way forward, and `AssetPath` only
matches `png|jpg|webp|gif`. There are tests for the ways a real file from a design tool disguises
itself — a byte-order mark, an XML declaration, a doctype, uppercase tags.

That is kept, deliberately, against the brief. Sanitising SVG is a denylist against a format that
is a whole document language: `<foreignObject>`, `xlink:href`, CSS `@import`, entity expansion and
namespace tricks are all live, and every sanitiser worth the name has had a bypass. The file is
served from our own origin to a signed-in admin's browser, so a bypass is stored XSS against the
tenant. Refusing the format removes the class of bug rather than filtering it, and the cost is that
a customer converts a logo to PNG once.

Revisit only with a rasterise-on-upload step — accept the SVG, render it to PNG server-side, store
the PNG and discard the source. That gets the convenience without ever serving customer-authored
markup.

## The contracts, for when those layers land

**CLIENT CONTRACT** — `--accent`, `--accent-fg` (derived, never chosen), logo light + dark,
wordmark text, favicon source, email header logo and accent.

**FORM CONTRACT** — `--accent`, `--accent-fg` (derived), `--surface`, `--radius-scale`,
`--font-body`, `--font-heading` from a curated set, form logo, cover image, button shape.

**Locked against every layer** — the table above.

A theme layer setting anything outside its contract is a bug and should fail validation rather than
being merged and ignored, so that "it did nothing" is never the symptom somebody has to debug.

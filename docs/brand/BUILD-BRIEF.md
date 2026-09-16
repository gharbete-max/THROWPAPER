> Live for **structure only** (see START-HERE.md §3). Token prefixes and the product name were
> renamed on ingest; every colour name and old asset path in here is dead — `tokens-loppa.css`,
> `css/loppa-motion.css` and `css/loppa-spinner.svg` replace them.

# Loppa — implementation prompt

Paste this whole file to Claude Code, working in the `throwpaper` repo, with the
Loppa asset bundle available. This is the instruction set. `tokens-loppa.css`
is the reference it points at for palette, assets and theme rules.

---

## 0. The job, in one paragraph

Roll the Loppa identity across the product — palette, mark, motion, and a
glass-surface visual system in the vein of Apple's recent interfaces. At the same
time, build two theming capabilities that pull in the opposite direction from a
fixed brand: **client mode**, a full white-label so a company can replace the
logo, title, colour, favicon and email branding across the entire site; and a
**fully customisable form creator**, where forms inherit the active theme by
default but can be overridden in the form editor and again in the advanced
editor.

The tension between "consistent brand" and "customer can change everything" is
the actual engineering problem here. §3 is how it gets resolved. Read it before
you write a line of CSS.

---

## 1. Phases and skills

Work in this order. Each phase has skills attached; invoke them. Do not batch
all critique to the end, and do not run reduction before the feature works.

| Phase | Skills | Output |
| --- | --- | --- |
| **0. Recon** | `taste-skill:redesign-existing-projects` | a written map of the repo: stack, styling approach, routing, where the form creator lives, where global chrome lives, what already handles theming. **Report this before building.** |
| **1. Architecture** | `ui-ux-pro-max:design-system`, `engineering:architecture` | the three-layer token contract (§3), the client-theme data model, the resolution order. An ADR for the theming decision. |
| **2. Foundations** | `ui-ux-pro-max:ui-styling` | tokens wired, glass system in, dark theme working, no components yet |
| **3. Direction** | `taste-skill:design-taste-frontend` | visual direction for the site — layout, rhythm, what stops it reading as a template |
| **4. Build** | `ui-ux-pro-max:ui-styling`, `taste-skill:high-end-visual-design` | shell, pages, components, form creator, client mode |
| **5. Critique** | `impeccable:impeccable`, `design:accessibility-review` | per section as you finish it, then once on the whole. Fix what it finds. |
| **6. Reduction** | `ponytail:ponytail-review`, then `ponytail:ponytail-audit` if the review keeps finding the same class of thing, then `ponytail:ponytail-debt` | delete what the feature doesn't need |
| **7. Verify** | `engineering:code-review`, `engineering:testing-strategy` | security, correctness, test plan for the theming layers |

**On ponytail specifically.** It runs at phase 6, on the diff, scoped to "what
can we delete". It will want to collapse the theming abstraction in §3 — some of
that is fair (any layer with one consumer and no second one planned), and some of
it is not (the token contract is a deliberate boundary that stops white-labelling
metastasising). When ponytail and §3 disagree, keep the boundary and record the
disagreement in your summary. Use `ponytail:ponytail-debt` to capture anything
you deliberately defer rather than leaving `TODO` comments to rot.

**When skills conflict.** They will — `taste-skill` pushes toward desaturated
accents, which would gut the palette. Precedence, highest first:

1. **Accessibility** — §5, and the contrast table in `tokens-loppa.css` §3.
2. **`tokens-loppa.css`** — palette, mark usage, naming.
3. **This document.**
4. **The skills**, in the table order.

Follow the higher tier and say so in your summary. Don't silently obey a skill.

---

## 2. Recon first — do not skip

I do not know this codebase. Before phase 1, report:

- Framework, styling approach (CSS modules / Tailwind / styled-components /
  something else), build tool, rendering model (SSR? SSG? SPA?).
- Whether there is an existing theming or design-token layer, and whether it is
  worth keeping.
- Where the form creator lives, and what the form schema looks like — is styling
  already part of the schema, or is it purely structural?
- Where global chrome (header, corner lockup, favicon, email templates) is
  defined.
- Whether there is a tenant/organisation model already, and where org settings
  are stored.

**Conform to the existing stack.** Do not introduce Tailwind into a CSS-modules
codebase, or a new component library, to make the styling job easier. If you
believe a migration is genuinely warranted, propose it — don't perform it.

---

## 3. Theming architecture — the core of this work

Three layers, resolved in this order. Each **only** overrides a named, closed set
of tokens. Everything else is not overridable at that layer.

```
1. Loppa brand      tokens.css + glass.css         always present, the fallback
2. Client theme       per organisation, white-label  overrides the CLIENT CONTRACT
3. Form theme         per form, editor + advanced    overrides the FORM CONTRACT,
                                                     scoped to the form root only
```

**Implement layers 2 and 3 as CSS custom properties set on a scope element**, not
as compiled per-tenant stylesheets. Reasons: one cached CSS bundle for every
tenant, no build step per customer, and layer 3 can nest inside layer 2 without a
cascade fight.

```html
<html data-theme="dark">                             <!-- light / dark -->
  <body data-client-theme="acme">                    <!-- layer 2 vars set here -->
    <div class="form-root" style="--form-accent: …"> <!-- layer 3, scoped -->
```

### The closed contracts

Define these explicitly in code, as a typed object, not as "whatever CSS var
happens to exist". A theme layer setting a token outside its contract is a bug
and should fail validation.

**CLIENT CONTRACT** (what a white-label customer controls):
`--accent`, `--accent-fg` (derived, not chosen), logo (light + dark), wordmark
text, favicon source, email header logo + accent.

**FORM CONTRACT** (what a form author controls):
`--accent`, `--accent-fg` (derived), `--surface`, `--radius-scale`,
`--font-body`, `--font-heading` (from a curated set), form logo, cover image,
button shape.

**LOCKED — no layer may override, ever:**

- focus ring visibility and its minimum 3:1 contrast against both adjacent
  surfaces
- error and required-field indicator contrast
- disabled-state distinguishability
- minimum 44×44px tap targets
- input `font-size: 16px` minimum on mobile (below this, iOS zooms on focus)
- label-to-input association

These are the things a customer will happily break and then blame you for. Lock
them in code, not in documentation.

### Server-side resolution — no flash of Loppa

The client theme **must be resolved server-side and inlined into the document
head**. A white-label customer seeing Loppa branding flash before their own
loads is the single most visible way this feature fails. Same for public form
pages. If the current rendering model can't do this, say so in recon — it changes
the approach.

---

## 4. Client mode — full white-label

Org settings gets a **Client mode** section: a toggle, plus logo upload, title
text, accent colour, and a live preview.

When enabled, across the entire site:

- **Corner lockup** — client logo + title replaces the Loppa mark. Needs a
  defined max height, safe area, and a graceful fallback to the title text alone
  if the logo fails to load or is missing. `alt` is the company name.
- **Accent** — their colour drives `--accent` through the contrast guard in §5.
- **Favicon** — see the caveat below.
- **Emails** — header logo and accent.

### Logo handling

- SVG preferred, PNG accepted. Reject anything else.
- **Ask for a dark-theme variant, don't auto-invert.** Inverting a logo produces
  garbage more often than not. If they supply only one, use it on both and show
  them a dark preview so they can see the problem themselves.
- Never recolour, crop, add a container to, or apply the glass treatment to a
  client's logo. It is their asset.
- Sanitise uploaded SVG — strip `<script>`, event handlers and external
  references. An SVG upload field is an XSS vector; treat it as one.

### Favicon — flag this, don't silently ship it

Generating a good 16px favicon from an arbitrary logo is not automatable. Our own
mark needed a separately drawn reduced version to survive that size. A customer's
detailed logo, downscaled, will be mud.

Implement: use their logo for the 180px and 512px slots, and for the 32px slot
only if its aspect ratio is near-square. Otherwise fall back to a solid tile in
their accent. **Raise this as a known limitation** rather than pretending it
works.

### Emails

Different rules — do not reuse the web approach:

- No CSS custom properties, no `backdrop-filter`, no external stylesheet. Inline
  styles, resolved per send.
- **PNG logo at an absolute URL, not SVG.** Gmail strips SVG.
- Assume dark-mode mail clients will invert your background. Test on a dark
  client before calling it done.
- Always a text fallback — a good proportion of recipients block images.

### Attribution

Whether a white-labelled site still shows "Powered by Loppa", and where, is a
commercial decision. **Raise it, don't decide it.** Build the slot so it can be
switched on or off per plan.

---

## 5. The contrast guard — non-negotiable

A customer will pick `#FFEE00`. Our own palette is hand-checked; theirs is not.

Implement one function that every theme layer runs through:

```
contrast(a, b)      → WCAG ratio
pickForeground(bg)  → whichever of ink / paper scores higher against bg
usable(bg, need)    → max(contrast(ink,bg), contrast(paper,bg)) >= need
```

Rules:

- `--accent-fg` is **derived, never chosen**. Run `pickForeground` on the accent.
- Required ratios: **4.5** for text, **3.0** for large text, UI boundaries and
  focus rings.
- If an accent can't reach 3.0 with either foreground, adjust its lightness
  (OKLCH, preserving hue and chroma) until it does. Cap the iterations. If it
  still fails, **reject it in settings with a plain explanation and a live
  pass/fail badge** — don't accept it and render something unreadable.
- Store the raw colour *and* the derived accessible variants. Never recompute in
  a render path.
- **A client accent may never set body text colour.** Fills, borders, focus
  rings, links — yes, subject to the ratios above. Body text is ink or paper.
- Keep the glass tint neutral. Tinting the translucent layer with an arbitrary
  accent makes contrast unpredictable in a way no static check will catch. The
  accent may touch the border and the specular edge only.

---

## 6. The form creator

**Default: forms inherit the active theme** — Loppa's, or the client's when
client mode is on. A form author who changes nothing gets something coherent.

Two editing tiers on top:

**Form editor** (everyone): accent, light / dark / auto, corner radius scale,
font pairing from a curated set, form logo, cover image, button shape.

**Advanced editor**: the extended FORM CONTRACT, per-section spacing, and — if
you support custom CSS at all — it must be **scoped to the form root and
sanitised**, and it must not be able to touch anything in the LOCKED list. Prefer
a constrained token surface over a free CSS box. If you do ship a CSS box, say
plainly in your summary what it can and cannot reach.

Two more requirements:

- **Forms render standalone.** A public form page must not depend on app chrome,
  app-only providers or the authenticated layout. Verify by rendering one logged
  out.
- **Forms default to opaque surfaces, not glass.** Glass over a customer's
  arbitrary cover image is exactly the unpredictable-backdrop case that breaks
  contrast. Glass belongs to app chrome. If a form author explicitly opts into a
  translucent surface, the contrast guard runs against the worst case.

Every form theme, however customised, must still pass the LOCKED list. Write a
test that asserts this against a deliberately hostile theme.

---

## 7. Glass, motion and assets

Specified in full elsewhere — follow them rather than re-deriving:

- **Glass** — `glass.css` and the rules in `tokens-loppa.css`. Short version:
  glass is a surface, never a text background; the specular edge and saturation
  are what read as glass, not the blur; `backdrop-filter` stays inside
  `@supports`; cap roughly three live glass layers per viewport and never nest
  them; **the primary CTA is solid, not glass.**
- **Motion** — reuse `--loppa-ease-unfurl` and `--loppa-ease-chomp`. No new
  curves, no `linear`, no bare `ease-in-out`. Honour `prefers-reduced-motion` and
  `prefers-reduced-transparency` everywhere. If more than two things animate in
  one viewport, cut one.
- **Assets** — the table in `tokens-loppa.css` §5. The three that get misused:
  `spinner.svg` for loading (never the raster spinners on web); WebP over GIF
  because it has alpha and covers both themes; and `mark-intro-256.webp` is
  ~1 MB, so lazy-load it or regenerate at 20fps from `source/`.
- **Header mark hover** — implement from `animation/hover-demo.html`. Read it; it
  handles restarting from frame 0 and removing the motion layer under
  reduced-motion. **Loppa branding only** — when client mode is on, the corner
  is the customer's static logo, not our animation.
- On ingest, strip the C2PA `<metadata>` block from the delivered SVGs (see
  `tokens-loppa.css` §6b).

---

## 8. Naming

The repo is `throwpaper`; the product is **Loppa**.

- Rename **user-facing strings**: page titles, nav, manifest, meta tags, email
  subjects and bodies, app display name, auth screens, error copy.
- **Do not mass-rename internal identifiers**, module paths, package names,
  database tables or API routes. That is a large, risky diff with no user-visible
  benefit, and it will bury the actual work in review.
- The repo rename itself is not Claude Code's to make — flag it.
- Always "Loppa": capital P, no other capitals, never hyphenated or split.

---

## 9. Definition of done

State the result of each. Don't just tick them.

- [ ] Both themes at 320 / 768 / 1280 / 1920.
- [ ] Contrast audited **per theme** — light mode fails wherever a pastel was
      used for text; dark mode passes with the same colours, so don't "fix" it
      there.
- [ ] Glass contrast checked against the worst-case backdrop, not a blank page.
- [ ] Client mode tested with a **deliberately hostile** theme: near-white
      accent, near-black accent, a wildly non-square logo, a missing logo, a 2 MB
      PNG, and an SVG containing a `<script>` tag.
- [ ] Form theming tested the same way, and the LOCKED list verified to survive.
- [ ] No flash of Loppa branding on a white-labelled page, app or form.
- [ ] A public form renders correctly logged out.
- [ ] Full keyboard pass: everything reachable, visible focus, logical order, no
      traps, modals restore focus.
- [ ] `prefers-reduced-motion` and `prefers-reduced-transparency` honoured.
- [ ] `backdrop-filter` disabled — layout still legible.
- [ ] No hard-coded colour outside `tokens.css` / `glass.css` / the theme layer.
- [ ] Lighthouse: Performance ≥ 90, **Accessibility 100** (requirement, not
      target). LCP under 2.5s on a mid-range phone over 4G. No CLS from the mark
      or the animations.
- [ ] `impeccable` and `ponytail:ponytail-review` both run, findings applied or
      argued.

---

## 10. Raise, don't decide

- **The wordmark.** There is none. "Loppa" set in the body font is a
  placeholder — label it provisional.
- **The typeface.** Nothing in the bundle specifies one. Propose two or three
  with reasoning.
- **"Powered by Loppa"** on white-labelled sites — commercial call.
- **The favicon limitation** for client logos (§4).
- **Any fifth colour** needed for success / warning / error states.
- **A repo rename**, and any stack migration you think is warranted.
- Any point where a skill's advice conflicted with §1's precedence and you
  followed the higher tier.

## 11. How to report back

When you finish, give me: what you built; the recon findings from §2; what you
changed from the skills' advice and why; what failed contrast and how you fixed
it; what ponytail wanted to delete that you kept and why; and the open items
from §10.

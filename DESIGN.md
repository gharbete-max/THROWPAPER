---
name: Loppa
description: Forms, registrations and the door, for organisations that have to get it right.
colors:
  primary: '#cea85c'
  secondary: '#8f6b3a'
  accent: '#8f6b3a'
  accent-ink: '#8f6b3a'
  background: '#fafaf8'
  surface: '#e9ebee'
  text: '#0e0e10'
  muted: '#4a4e55'
  border: '#7c8188'
  success: '#2f6b45'
  warning: '#8a5f00'
  danger: '#a12b25'
typography:
  display:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '39.063px'
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: '-0.015em'
  heading:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '31.25px'
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: '-0.015em'
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 'normal'
  label:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '16px'
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: 'normal'
  caption:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    fontSize: '12.8px'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 'normal'
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '12.8px'
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 'normal'
rounded:
  sm: '5px'
  md: '10px'
  lg: '17.5px'
  xl: '25px'
  pill: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
    height: '44px'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
    height: '44px'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
    padding: '24px'
  input:
    backgroundColor: '{colors.background}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '8px'
    height: '44px'
  nav-link:
    backgroundColor: 'transparent'
    textColor: '{colors.muted}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
---

# Loppa design system

## Overview

Two products share these tokens: **Loppa**, a form builder with events, a door and a ledger,
and **Mailer**, its email counterpart. The audience is membership secretaries, event organisers
and association treasurers — people who have to get a registration right the first time, in front
of an audience, often at a door in bad weather.

That audience sets the whole direction. The interface is warm rather than corporate, quiet rather
than expressive, and it never asks somebody to work out what a control does. Where taste and
legibility disagree, legibility wins; this is written down because it has already decided several
arguments.

**Every value here is derived from one source.** `packages/tokens/src/default-tokens.json` holds
what a person can set; everything else in this file is computed from it by
`packages/tokens/src/derive.ts` and emitted by `compile-web.ts`. There are four compilers — web,
email, PDF and native — so a brand change reaches the app, the confirmation email and the printed
admission card without any of them knowing about each other. **Do not hard-code a value from this
file.** Read the custom property.

An organisation may replace the entire palette from the Brand Kit screen. Nothing below may assume
the shipped colours; it may only assume the _relationships_ between them.

## Colors

| Token                        | Value                         | Used for                                                                                                                                    |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary`                    | `#cea85c`                     | Gold, the face. Filled buttons, the current nav item, selected states. **A fill, never text on a light page**                               |
| `secondary`                  | `#8f6b3a`                     | Bronze. Links and focus rings — the one brand tone that reads on paper                                                                      |
| `accent`                     | `#8f6b3a`                     | Bronze again: quote rules, eyebrows, hover tints. **Decoration, and the one accent that is also readable**                                  |
| `accent-ink`                 | `#8f6b3a`                     | The accent where it must be _read_. Derived; for this palette `accentInk` returns bronze untouched                                          |
| `heading`                    | `#0e0e10`                     | Headings: the primary where it reads on the page, the ink otherwise. Derived (`headingInk`) — gold does not read on paper, so it is the ink |
| `background`                 | `#fafaf8`                     | The page. The brand's white, never pure `#fff`                                                                                              |
| `surface`                    | `#e9ebee`                     | Cards, the rail, raised areas. Platinum's pale tier                                                                                         |
| `text`                       | `#0e0e10`                     | Body copy. The brand's black, never pure `#000`                                                                                             |
| `muted`                      | `#4a4e55`                     | Captions, help text, inactive nav. Graphite, 8.00:1                                                                                         |
| `border`                     | `#7c8188`                     | Every boundary. Pewter, 3.75:1                                                                                                              |
| `success` `warning` `danger` | `#2f6b45` `#8a5f00` `#a12b25` | Status only. The one exception below                                                                                                        |

Every value is the brand's own, from `docs/brand/tokens-loppa.css`, and `packages/tokens/src/loppa.test.ts`
holds the shipped default to that table — including the ratios — so a palette that drifts fails CI.

### The palette is the mark's two metals, plus paper and ink

The mark is folded foil in **two materials, gold and platinum**, and that is the whole palette. Gold
has three tiers because foil does: the face (`#cea85c`), the crease (`#8f6b3a`, bronze), and the
sheen (`#f0e2c2`). Platinum has the same three: the face (`#c6cad1`), the crease (`#7c8188`, pewter)
and the sheen (`#e9ebee`). Bronze and pewter are not additional colours; they are where the metal
folds away from the light. Then there is paper (`#fafaf8`) and ink (`#0e0e10`), and between them
one grey, graphite (`#4a4e55`).

**The sixth-hue rule, restated for a metal palette: gold, gold's tiers, and the greys — nothing
else.** Platinum _is_ a grey, which is what makes this palette narrower than the last: seafoam and
coral were two hue families that had to be kept from dominating each other; gold is the only hue
on the page and everything else is neutral, so there is nothing to balance. `muted` and `border`
are therefore the platinum ramp and graphite, not a warmed grey — a khaki border would be gold
wearing a disguise, and the one warm thing on the page has to stay the one warm thing.

The exception is **status**, and it is deliberate. `success`, `warning` and `danger` are not brand
colours and should not be — an error in gold on a page whose buttons are gold is an error nobody
reads as one, and the palette has no red or green to lend. They stay conventional, they are never
used for anything but status, and per the rule below they are never the only signal.

Transparency is not a sixth colour. Hover fills, pressed states and overlays are the ink or the
gold at reduced alpha, which is why gold's sheen tier does not appear in the token table: a tint
that is needed is `color-mix` of the primary, not a value somebody can set.

**The page is the brand's white, and that reverses the warm off-white this document argued for
one palette ago.** The argument then was that pure white is the one background that is never a
choice, so the product's own page — the frame around a customer's palette — should be a cream
far enough from white to be a decision. That argument was about seafoam on paper, where a warm
page made the cool brand read as chosen. Under gold it does the opposite: a cream page is a tint
of the brand, and gold on a gold-tinted page is more gold, not more decision. `#fafaf8` is what
lets the face gold be the only warm thing on the page. It is still not `#ffffff` — the brand's
own token says "never pure #FFF", and the frame argument survives in the two units it keeps off
white.

**No pure white and no pure black anywhere**, except where a machine needs it: the QR code's dark
modules are `#000000` because that is the contrast a camera needs at a door, and that is the only
exception in the product.

`border` is `#7c8188` (3.75:1 on the page, 3.28:1 on a card) because `checkContrast` holds a
boundary to 3:1 and a border may be a control's only edge. It is platinum's crease tier, not a
grey invented to clear the bar.

**The face gold is not a text colour.** It measures 2.14:1 on the page — the brand bundle's own
table says so — and `checkContrast` deliberately never tests it as text, because in the app it
is a fill. Where the brand must be read, it is bronze: 4.64:1 on the page, 4.06:1 on a card. That
is why `secondary`, `accent` and the derived `accent-ink` are all the same value in this palette.
It is not an oversight to tidy: bronze is the one brand tone that can carry words on paper, so
every place the brand becomes words — a link, a focus ring, an eyebrow — lands on it.

### The filled button, which is the one place this palette is hard

A brand colour in the middle of the tonal range cannot do both jobs a filled button needs, and
gold is exactly such a colour: 8.61:1 against the ink, 2.14:1 against the page. It carries a
label beautifully and shows its own edge not at all. Seafoam before it was the same case (5.11
and 2.12), which is why the mechanism was worked out on it and gold arrives to find it ready.

The old answer was to darken the fill until it stood off the page. For gold that walk lands on
`#ac8434` — 3.29:1 against the page, 5.61:1 against the ink — which, unlike seafoam's `#499482`,
would still carry a label. It is still the wrong answer, for the other reason: `#ac8434` is a
bronze nobody chose, and a product whose face is gold would have no gold button on it.

So the two requirements are carried by two different parts of the button. **The fill keeps the
colour somebody chose** and takes whichever of the ink and the page reads on it — for this palette,
gold with an ink label at 8.61:1. **The border carries the boundary**, and it is the label's own
colour: ink, at 18.45:1 against the page. The fill is only darkened when no label can be read on it
either way. This is the brand bundle's own instruction — `--loppa-accent-fill: gold; /* fill only,
black label */` — arrived at by derivation rather than written down.

The border was `brandFill` — the brand walked away from the page until it cleared 3:1 — which
worked and invented a colour. Every darkening of a mid-tone is a muddier version of it, so seafoam
grew a `#499482` edge and gold would grow an `#ac8434` one, in no palette and picked by nobody.
Reusing the label solves it without a third colour existing: `readableOn` has already found
something that reads against the fill, drawn from the theme's own two poles, and the ink is by
construction far from the page.

This is why `checkContrast` no longer reports "the page colour on top of the primary": nothing
paints that pair. What it reports instead is a primary that _no_ label can be read on — `#767676`
under this ink, 4.35:1 to the page and 4.25:1 to the ink — which is a palette fault only the person
choosing it can fix.

**Dark mode is derived, never authored.** `toDark()` computes it from the light palette: the page
becomes a dark tint of the brand's own ink so a warm palette stays warm, surfaces sit _above_ the
page rather than below it, and brand colours are lifted in HSL so they keep their hue. Mixing
toward white was tried and turned the brand colour into a dead grey. Never write a second palette.

With a near-black ink there is nothing to tint: **an ink that is already a night page is the night
page.** Tinting `#0e0e10` further walked it to `#050505`, collapsed the card onto the page (1.01:1)
and dropped the border under 3:1 — so the page is floored at the ink, and a surface is always a
step from the page toward the paper rather than a second darkening. The derived dark theme lands on
`#0e0e10` with cards at `#1c1c1e`, borders at 3.46:1, and gold reading at 8.61:1 — the numbers the
brand bundle measured for its own dark theme, reached without writing them down. It is where the
identity is strongest: headings turn gold there (`headingInk` keeps a brand that reads), and links
and focus rings lift to a pale gold.

## Typography

One family, `Inter` first with a system fallback chain. **`Inter` must stay first**: the PDF
compiler embeds that font's actual bytes, and the native compiler takes the first family, so
leading with a CSS generic silently breaks both.

**Font stacks may not contain quotes.** They are interpolated into an inline `style` attribute in
email, where a quote ends the attribute early. Multi-word families are written unquoted.

The scale is computed from `baseSize` (16px) and `scaleRatio` (1.25), so changing the ratio in the
Brand Kit moves every heading together: `xs` 10.24 · `sm` 12.8 · **`ui` 14.31** · `base` 16 ·
`lg` 20 · `xl` 25 · `2xl` 31.25 · `3xl` 39.06.

**`ui` is a half step, and it exists because interface text needed one.** The ramp is built for
display type, where 12.8 to 16 is a clean jump; a table row, a button label, a badge and a help line
all live inside that gap. The stylesheet had been solving it by hand — 21 of its 33 hand-written
sizes sat between 12 and 15px, on four different values no rule could reproduce. `ratio ** -0.5` is
what they were all approximating. It is derived rather than fixed at 14px so it stays tied to the
brand: widening the ratio opens the gap downward, and the step drops with it — 13.06 at a ratio of
1.5 — keeping interface text in proportion to the headings instead of a constant 14px beside them.

**Three sizes are deliberately off the ramp**, because they are not reading sizes: the two glyphs
centred in a fixed 48px and 44px circle, which are sized to the circle and would burst it if a brand
raised the ratio, and the landing page's fluid `clamp()` headline.

Body sits at 1.55 line-height; headings drop to 1.15 with `-0.015em` tracking, because display type
wants less leading than body text rather than the same.

**One monospace face, for two things that are not prose.** The hex field in the Brand Kit uses it so
the digits keep their columns while somebody types, and the `⌘K` hint uses it because a key cap is
a key cap. It is written in CSS rather than added to `TokenSet`: that schema is on the wire and in
every brand kit row, and a customer choosing their own monospace for a hex field is not a setting
anybody wants. Both places share one stack — they had drifted to two.

## Layout

A grid frame: a 15rem rail, a session row, and a scrolling column of work. **Navigation is
vertical.** A horizontal bar was tried and could not hold the product's sections plus the account
controls on one line at 1440px — a vertical list cannot wrap however many sections are added.

Below 64rem the rail becomes a fixed bottom bar, icons over labels, clear of the home indicator.

Content widths, chosen by what the screen is rather than by preference:

- **52rem** — documents: a form being filled in, one event being edited. A reading measure.
- **68rem** (`--roomy`) — lists of cards.
- **76rem** (`--wide`) — the builder and the response grid.

Every grid track that holds content uses `minmax(0, 1fr)`, never `1fr`. `1fr` means "at least as
wide as the widest thing inside", which let one row of tabs widen the whole frame past the viewport
on a phone.

Touch targets are **44px minimum** on anything a respondent taps. Authoring chrome may go smaller
and pads its hit area back out with a pseudo-element.

## Elevation & Depth

Flat by default. Hierarchy comes from weight, space and colour, because that is what survives a
customer replacing the palette.

- `--tp-shadow` — the theme's resting height, `none` on a flat theme.
- `--tp-shadow-raised` — at least level 1, for something that must read as lifted.
- `--tp-shadow-overlay` — never `none`; a dialog on a flat theme still needs a visible edge.

Two soft layers at low opacity, never one hard drop shadow.

**Glass** is for surfaces with page behind them, and only those: the session row, the command
palette, toasts, the site header. Not cards, not form fields, not the public form. It is an
_approximation_ of Apple's Liquid Glass — a translucent tint, `blur(20px) saturate(1.7)`, a
specular hairline along the top edge, and a shadow. It must degrade: `prefers-reduced-transparency`
removes it entirely, and `@supports not (backdrop-filter)` fills solid.

## Shapes

One radius set from `radius` (10px): `sm` 5 · `md` 10 · `lg` 17.5 · `xl` 25 · `pill` 999. Cards
take `lg`, controls `md`, badges `pill`. Set `radius: 0` and the whole product goes square together.

Borders are `1px` of `border` on every boundary. Inputs and buttons are `44px` tall.

## Components

- **Buttons, three tiers and only three.** _Primary_ is filled, at most one per screen. _Quiet_ is
  outlined, the ordinary action. _Bare_ is text, for what would otherwise be a row of six frames. A
  filled button carries the glass hairline so it is lit from the same direction as the panes.
- **Nav links are text, not buttons.** They are places. The current one is marked by weight and a
  soft fill in the rail.
- **Fields** own their messages. Help text and errors carry ids, and every control points at them
  with `aria-describedby` plus `aria-invalid` — a red sentence near an input is invisible to a
  screen reader.
- **Empty states** are a quiet mark, a sentence at full contrast, and the action that fixes it.
  Never a dashed box: that is what a drop zone looks like.
- **The mark** is a paper fortune teller seen from above, folded in gold and platinum foil: one
  diamond, four flaps, eight triangles meeting at the pinch. The header shows the brand bundle's
  own render (`Mark.tsx`: a still at rest, the loop where something is loading or arriving), in
  Loppa's colours whatever palette the page wears — white-label replaces it with the customer's
  logo rather than tinting it, because a brand that can be repainted by whoever installs it is not
  a brand.
  - The favicon and launcher icons are still drawn from the geometry in
    `apps/forms/src/components/mark-geometry.ts` by `pnpm icons`, on a tile of `primary` with paper
    and `accent` flaps — gold, paper and bronze — so a palette change regenerates them.
    `mark-consistency.test.ts` holds the geometry and the icon together. Cutting them over to
    `docs/brand/vector/loppa-mark-flat.svg` is an asset task, not a palette one.

## Do's and Don'ts

**Do**

- Read `var(--tp-*)`. Every colour, size, radius and duration is a token.
- Derive new scales in `derive.ts` rather than adding fields to `TokenSet` — that schema is on the
  wire, in every brand kit row, and in four compilers.
- Write a guard test whenever two things must agree. That pattern has caught a stale favicon, four
  unsaveable fonts, an admission card in the wrong language and a logo drifting from its icons.
- Check contrast as somebody chooses a colour, not after they save.

**Don't**

- Don't hard-code a colour, size or font. The one exception is the QR code's black.
- Don't author a dark palette. It is derived.
- Don't use `accent` as text. Use `accent-ink`.
- Don't put glass on anything without page behind it.
- Don't animate anything that must be readable without JavaScript, and never gate content on a
  class that JavaScript adds.
- Don't add gradients as decoration. The only two in the product are on `body`, and they exist to
  give `backdrop-filter` something to work with: blur over one flat colour returns that colour.

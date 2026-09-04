---
name: Formwork
description: Forms, registrations and the door, for organisations that have to get it right.
colors:
  primary: '#1b2a45'
  secondary: '#3a5578'
  accent: '#b0763a'
  accent-ink: '#916435'
  background: '#faf7f0'
  surface: '#f2ece1'
  text: '#171a20'
  muted: '#5f5a50'
  border: '#998b75'
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
    textColor: '{colors.background}'
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

# Formwork design system

## Overview

Two products share these tokens: **Formwork**, a form builder with events, a door and a ledger,
and **Sendwork**, its email counterpart. The audience is membership secretaries, event organisers
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

| Token                        | Value                         | Used for                                                    |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `primary`                    | `#1b2a45`                     | Filled buttons, the current nav item, the mark's top wing   |
| `secondary`                  | `#3a5578`                     | Focus rings                                                 |
| `accent`                     | `#b0763a`                     | The mark's near wing, quote rules. **Decoration, not text** |
| `accent-ink`                 | `#916435`                     | The accent where it must be _read_. See below               |
| `background`                 | `#faf7f0`                     | The page                                                    |
| `surface`                    | `#f2ece1`                     | Cards, the rail, raised areas                               |
| `text`                       | `#171a20`                     | Body copy                                                   |
| `muted`                      | `#5f5a50`                     | Captions, help text, inactive nav                           |
| `border`                     | `#998b75`                     | Every boundary                                              |
| `success` `warning` `danger` | `#2f6b45` `#8a5f00` `#a12b25` | Status only                                                 |

Parchment and midnight, with cognac as the one warm note. **No pure white and no pure black
anywhere** except where a machine needs it: the QR code's dark modules are `#000000` because that
is the contrast a camera needs at a door, and that is the only exception in the product.

**`accent` is not a text colour.** `checkContrast` deliberately never tests it against the
background, because in the app it is a wing of the logo and the edge of a quote. The moment it
became words on the landing page it measured 3.57:1, under the 4.5 small text needs. Use
`accent-ink`, which walks the accent toward the palette's own ink only until it clears the bar.

**Dark mode is derived, never authored.** `toDark()` computes it from the light palette: the page
becomes a dark tint of the brand's own ink so a warm palette stays warm, surfaces sit _above_ the
page rather than below it, and brand colours are lifted in HSL so they keep their hue. Mixing
toward white was tried and turned the midnight navy into a dead grey. Never write a second palette.

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
- **The mark** is a paper plane folded from a fortune teller. It holds still and unfolds on hover.
  Its geometry lives in `FortuneTeller.tsx` and is the single source for the favicon, the launcher
  icons and the intro's final frame.

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

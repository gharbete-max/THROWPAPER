# Loppa — wordmark, lockups and typeface

## The typeface decision

**Recommended: a light neo-grotesque, set in caps, generously letterspaced.**

The reasoning is subtractive. The mark is already doing a lot — eight facets,
two metals, gradients, a sheen band that moves. A wordmark has to sit next to
that without competing. So:

- **Not a Didone** (Bodoni, Didot, Playfair). High-contrast serifs plus metallic
  gradients tips straight into costume luxury — perfume-counter, not product.
- **Not a display serif.** Same problem, more of it.
- **Not a geometric sans at regular weight.** Reads as generic SaaS.
- **A light grotesque, tracked wide, in caps.** Quiet, confident, dateless. The
  tracking is what signals intent; at a regular weight and normal tracking the
  same face would look like body copy.

Caps rather than title case because the tracking only reads as deliberate in
caps. "L o p p a" looks like a mistake; "L O P P A" looks like a decision.

**Specify one of these, in order of preference:**

1. **Söhne Leicht** or **Söhne Buch** (Klim Type Foundry) — the modern
   luxury-tech default for good reason. Commercial licence.
2. **Neue Haas Grotesk Display 45 Light** (Monotype) — the timeless version of
   the same idea. Commercial licence.
3. **Founders Grotesk Light** (Klim) — slightly warmer, more editorial.
4. **Free fallback: Archivo Light**, or **Inter Display Light** if the product
   already uses Inter for UI. Inter is everywhere, so it costs distinctiveness,
   but it costs nothing else.

**What shipped in this bundle is NOT the final letterform.** These files are set
in DejaVu Sans ExtraLight, the closest weight available here. The proportions,
tracking, lockup geometry, clear space and animation are all correct and
production-ready — **only the letterforms need re-setting** once a face is
licensed. Regenerate from `source/build-title.py`; change `FONT_PATH` and
nothing else. Treat the current files as an accurate comp, not as final artwork.

## Body typography

Whatever you pick above should not also set body copy — a light display
grotesque at 16px is thin and hard to read. Pair it with the same family at
Regular/Book for UI, or a neutral system stack. Raise the pairing separately.

## What's in the bundle

```
title/
  vector/
    loppa-wordmark-{light,dark,gold}.svg        caps, tracked, outlined paths
    loppa-wordmark-titlecase-{light,dark}.svg   for body-adjacent use
    loppa-lockup-h-{light,dark,gold}.svg        mark left, wordmark right
    loppa-lockup-stacked-{light,dark,gold}.svg  mark above, wordmark below
  raster/
    loppa-lockup-{h,stacked}-{light,dark}-{xl,lg,md,sm}.png / .webp
    …-{xl,lg}.jpg                                opaque slots only
  animated/
    loppa-title-reveal-{light,dark}-{xl,md}.webp / .gif   plays once
    loppa-title-poster-{light,dark}.png          final frame
  qa-reveal-sequence.png
```

Letterforms are **outlined to paths** in every SVG, so no font file ships and
nothing renders wrong on a machine that lacks the face.

## Usage

| Context | Use |
| --- | --- |
| Site header, app chrome | `lockup-h` — horizontal, reads at a glance |
| Splash, footer, print, social avatar | `lockup-stacked` |
| Where the mark already appears nearby | `wordmark` alone — never repeat the mark |
| Body-adjacent, small, in a sentence | `wordmark-titlecase` |
| Launch page, first load, intro | `title-reveal` animation |

**The gold wordmark is a special-occasion asset.** Gold type is weak on white
(bronze at 4.64:1 is the only text-safe gold) and it reads cheap at small sizes.
Default to ink on light and paper on dark, and let the mark carry the metal.
Use `-gold` for large display only.

**Clear space:** one mark-width on every side of the lockup. Minimum width for
`lockup-h` is 160px; below that use the mark alone.

**Never**: stretch, re-track, recolour the wordmark outside the three supplied
fills, add a container or rule between mark and wordmark, or set "Loppa" in a
different face and call it the logo.

## The reveal animation

Mark settles in first, then the wordmark resolves letter by letter with the
tracking tightening from 0.46em to 0.30em. It plays **once** (`loop=1`) and ends
on the resting pose, so `loppa-title-poster-*.png` can replace it with no jump —
which is exactly what to do under `prefers-reduced-motion`.

Do not loop it. A title that keeps re-announcing itself is the definition of
obnoxious.

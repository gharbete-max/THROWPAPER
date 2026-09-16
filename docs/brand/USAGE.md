# Loppa — asset usage and completion

Prompt for Claude Code, working in the `throwpaper` repo with the `loppa/`
bundle available. Read `ASSET-REPLACEMENT-PROMPT.md` first — that covers the
rename and the swap. **This covers what to do with the assets once they're in,
and what still has to be generated.**

---

## 0. What you have

```
loppa/
  tokens-loppa.css              colour + motion tokens — import first
  ASSET-REPLACEMENT-PROMPT.md   the migration
  animation/   loppa-{512,256,128,64}.webp | -on-white.gif | -on-black.gif
  still/       loppa-{1024,512,256,128,64}.png | .webp | -on-white.jpg | -on-black.jpg
  vector/      loppa-mark.svg (gradient) | -flat.svg | -black.svg | -white.svg
  motion/      11 variants, 160px, .webp + -on-white.gif + -on-black.gif
               MOTION.md — what each one is for
  css/         loppa-spinner.svg   vector loader, 1.5 KB
               loppa-motion.css    motion utilities
  source/      Python generators — regenerate any size or variant
```

Import order: `tokens-loppa.css` → `glass.css` (rename its `--paloppa-*`
references) → `css/loppa-motion.css`.

---

## 1. Mapping — every asset to a place in the product

Work through this list and report anything in the app that needs a mark or a
motion state and isn't covered.

| Where | Asset |
| --- | --- |
| Header logo, static | `vector/loppa-mark.svg` |
| Header logo, hover | `.loppa-mark` pattern + `motion/loppa-breathe.webp` or `animation/loppa-256.webp` |
| Favicon, ≤32px, print | `vector/loppa-mark-flat.svg` |
| Single-colour / knockout | `vector/loppa-mark-black.svg`, `-white.svg` |
| Any loading state | `css/loppa-spinner.svg` — **never a raster** |
| Page / modal entrance | `.loppa-rise` |
| Form submitted | `motion/loppa-success.webp` + confirmation text |
| Validation failure | `.loppa-invalid` + the error message |
| Theme toggle | `motion/loppa-flip.webp` |
| Empty state / 404 | `motion/loppa-collapse.webp` (ends at rest — doubles as a still) |
| Offline / disabled | `motion/loppa-drift.webp` |
| Marketing hero | `animation/loppa-512.webp`, lazy-loaded |
| Social card | `still/loppa-1200x630` — **does not exist yet, see §3** |
| Email header | `still/loppa-256-on-white.jpg` at an absolute URL |

`motion/loppa-tumble`, `-scatter` and `-chatter` are personality pieces.
`scatter` destroys the mark mid-cycle — never where the logo must stay legible.

---

## 2. Patterns to implement

**Serve WebP with a real fallback.** Not a blind swap:

```html
<picture>
  <source srcset="/loppa-256.webp 1x, /loppa-512.webp 2x" type="image/webp">
  <img src="/loppa-mark.svg" width="256" height="256" alt="Loppa">
</picture>
```

**The hover mark needs one line of JS.** Animated WebP and GIF start playing on
load, so by the time anyone hovers they land mid-cycle. Reset `src` on enter:

```js
document.querySelectorAll('.loppa-mark').forEach(el => {
  const img = el.querySelector('.loppa-mark__motion');
  if (!img || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const src = img.getAttribute('src');
  const restart = () => { img.src = ''; img.src = src; };
  el.addEventListener('mouseenter', restart);
  el.addEventListener('focus', restart, true);
});
```

**One-shot motion states** (`success`, `flip`, `shake`, `collapse`) carry
`loop=1` and settle on the resting pose, so they can be swapped for
`still/loppa-*.png` with no visible jump. Do exactly that under
`prefers-reduced-motion`.

**Never let motion carry meaning alone.** `shake` without an error message and
`success` without confirmation text are both accessibility failures.

---

## 3. What you must generate — these do not exist

Use `source/` to regenerate from the real geometry. **Do not upscale a PNG and
do not downscale the gradient mark below 32px** — the gradients turn to sludge,
which is precisely why `loppa-mark-flat.svg` exists.

1. **Favicon and PWA icon set.** From `vector/loppa-mark-flat.svg`:
   `favicon.svg`, `favicon.ico` (16/32/48), `apple-touch-icon-180.png`
   (opaque, padded — iOS applies its own corner radius), `icon-192.png`,
   `icon-512.png`, plus `-maskable` versions inset to 60% so Android's circle
   crop doesn't clip the tips. Regenerate `site.webmanifest` with
   `"name": "Loppa"`.
2. **Social cards.** 1200×630 PNG and WebP, mark centred on
   `--loppa-black` (gold is weak on white — see §4), plus a 1200×1200 square
   for platforms that crop.
3. **Email assets.** PNG only at absolute URLs — Gmail strips SVG. Inline
   styles, no custom properties, no `backdrop-filter`. Test on a dark-mode
   client; assume it will invert your background. Always a text fallback.
4. **A sprite or icon font is NOT needed.** Four SVGs is not a sprite problem.
   If you find yourself building one, stop and report why.

Optional, only if the product needs them — propose before building:

- A **client-mode placeholder mark** for white-label orgs that haven't uploaded
  a logo yet (see `BUILD-BRIEF.md` §4).
- **Open Graph variants per page type** if the marketing site has more than a
  handful of routes.
- A **print/PDF mark** — `-flat.svg` converted to CMYK-safe values. Raise it;
  I have not specified CMYK.

---

## 4. Two standing problems — do not paper over

**Gold is weak on white.** Measured 2.14:1. The mark is gold-forward, so this
identity is materially stronger on near-black. If the product's default theme
is light, say so in your report and show both. This is a brand decision, not a
CSS one.

**The materials rotate during the chomp.** In every animation, gold and platinum
appear to trade sides as the mark folds. This is intrinsic: the two chomp states
are related by a 90° rotation of the geometry, so on a four-fold mark any
two-material arrangement will appear to rotate. It is not a bug in the files and
it is not fixable by re-exporting. It is unresolved pending a decision between
keeping it (it reads as turning foil) and going single-metal. **Do not attempt
to fix it in code.**

---

## 5. Definition of done

- [ ] Import order correct; `glass.css` token prefixes renamed to `--loppa-`.
- [ ] Every row of §1 mapped, or reported as not applicable.
- [ ] Nothing in the app requests a mark or motion state that isn't covered.
- [ ] Every raster served through `<picture>` with a working fallback.
- [ ] No raster loader anywhere — `css/loppa-spinner.svg` only.
- [ ] Hover restart script in place; `prefers-reduced-motion` removes the
      animated layer entirely, not just the transition.
- [ ] Icon set, social cards and email assets generated (§3) and listed.
- [ ] Page weight per route reported before and after.
- [ ] Contrast audited per theme.
- [ ] The two standing problems in §4 restated in your summary, not silently
      dropped.

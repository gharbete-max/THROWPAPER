# Loppa — asset replacement

Prompt for Claude Code, working in the `throwpaper` repo with the `loppa/`
bundle available.

**The product is now Loppa, not Paloppa.** And this supersedes every earlier
palette — seafoam/coral, gold/silver metal, and the four-pastel set. Wherever
older docs name `--paloppa-*` tokens, those are dead; `tokens-loppa.css`
replaces them all. The structural rules in `BUILD-BRIEF.md` — the three-layer
theming contract, client mode, the LOCKED list, the contrast guard — still
apply unchanged, but rename every token prefix from `--paloppa-` to `--loppa-`.

## 0. Naming

Always **Loppa**. Capital L, no other capitals, never hyphenated or split.
Rename **user-facing strings only**: page titles, nav, manifest, meta tags,
email subjects and bodies, app display name, auth screens, error copy. Do not
mass-rename internal identifiers, module paths, package names, database tables
or API routes — large, risky, no user-visible benefit. Flag the repo rename.

Grep for all three of `paloppa`, `Paloppa`, `PALOPPA` **and** `throwpaper` in
user-facing strings. Report anything ambiguous rather than guessing.

## 1. Inventory before you replace

Produce a report first: every image, icon and animation referenced anywhere —
components, CSS, `public/`, email templates, manifest, meta tags, README,
storybook, tests, seed data. For each: path, where referenced, rendered size,
and whether it sits on a light or dark surface. Flag anything referenced from a
database column, a CMS, or a URL built at runtime — those won't show in a file
search and are where this kind of migration breaks.

## 2. The bundle

```
loppa/
  animation/loppa-{512,256,128,64}.webp            alpha — works on both surfaces
  animation/loppa-{512,256,128,64}-on-white.gif    baked white
  animation/loppa-{512,256,128,64}-on-black.gif    baked black
  still/loppa-{1024,512,256,128,64}.png            alpha
  still/loppa-{1024,512,256,128,64}.webp           alpha, ~⅓ the PNG
  still/loppa-{1024,512,256,128}-on-white.jpg      no alpha
  still/loppa-{1024,512,256,128}-on-black.jpg      no alpha
  vector/loppa-mark.svg          gradient metal — primary, ≥32px
  vector/loppa-mark-flat.svg     four flat tones — small sizes, print
  vector/loppa-mark-black.svg    one colour, light surfaces
  vector/loppa-mark-white.svg    one colour, dark surfaces
  tokens-loppa.css
  source/                        regenerate any size or variant from here
```

Every still shares one camera and pose, so sizes and formats are
interchangeable without the composition shifting.

## 3. Format routing

| Slot | Use |
| --- | --- |
| Logo in markup, ≥32px | `vector/loppa-mark.svg` |
| Below 32px, favicon, print | `vector/loppa-mark-flat.svg` — gradients turn to sludge small |
| Single-colour contexts | `-black.svg` / `-white.svg` |
| Animated, any surface | `animation/loppa-*.webp` (alpha) |
| Animated, no WebP support | the matching `-on-white` / `-on-black` GIF |
| Static over unknown background | `still/*.png` or `.webp` |
| Static into an opaque slot (email, OG, PDF) | `still/*-on-white.jpg` / `-on-black.jpg` |

Serve WebP with a fallback rather than replacing blindly:

```html
<picture>
  <source srcset="/loppa-256.webp 1x, /loppa-512.webp 2x" type="image/webp">
  <img src="/loppa-mark.svg" width="256" height="256" alt="Loppa">
</picture>
```

- **Never** put a `.jpg` where the old asset had transparency — it renders black.
- **Never** use an `-on-white` GIF on a dark surface, or the reverse. Most likely
  mistake in this migration.
- Keep `width`/`height` or `aspect-ratio` on every `img` — no CLS.
- `alt="Loppa"` on the logo; `alt=""` + `aria-hidden` on decorative instances.

## 4. Weight

`loppa-512-on-black.gif` is ~4 MB; `loppa-512.webp` is ~2 MB. Hero assets only.

- Above the fold: 256px WebP. Below: lazy-load.
- Anything that isn't the focal element: 128px or 64px.
- **Do not ship any of these as a loading spinner.** See §7.

## 5. Contrast — measured

| | on white | on black |
| --- | --- | --- |
| gold `#CEA85C` | **2.14** ✗ | 8.61 ✓ |
| gold-deep (bronze) `#8F6B3A` | 4.64 ✓ | 3.98 ✓ |
| platinum `#C6CAD1` | **1.57** ✗ | 11.73 ✓ |
| platinum-deep (pewter) `#7C8188` | **3.75** ✗ (large text / UI only) | 4.92 ✓ |
| graphite `#4A4E55` | 8.00 ✓ | **2.31** ✗ |

On white the only text-safe accent is bronze. On black, gold and platinum are
both text-safe and graphite is not. `--loppa-accent` already resolves correctly
per theme — use the token, never a raw hex.

**The mark is gold-forward and gold is weak on white.** This identity is
materially stronger on a dark surface. If the product's default theme is light,
raise that.

## 6. Motion

Slow, accelerating through the middle, slowing again — no overshoot. Match UI
transitions to it: `--loppa-ease-settle` for anything arriving,
`--loppa-ease-in-fast` for anything leaving. Replace any easing inherited from
an earlier palette. Under `prefers-reduced-motion`, swap the animation for
`still/loppa-*.png` — same pose, so the layout doesn't shift.

## 7. Raise, don't decide

- **Loading spinner.** None in this bundle. The mark is too detailed to reduce
  to 44px and a 130 KB GIF is not an acceptable spinner. Needs a purpose-built
  vector loader.
- **Favicon and PWA icon set.** Not regenerated in this palette. Use
  `loppa-mark-flat.svg` as the source; do not downscale the gradient mark.
- Any asset referenced from a database, CMS or runtime-built URL.
- The wordmark and typeface — still unspecified.
- Whether older asset bundles are deleted or kept for rollback.

## 8. Definition of done

- [ ] Inventory reported, every entry accounted for.
- [ ] No `paloppa` / `throwpaper` string survives in user-facing copy.
- [ ] No `--paloppa-*` token or dead hex survives. Grep hex values too.
- [ ] No `.jpg` in a slot that previously had transparency.
- [ ] No `-on-white` GIF on a dark surface, or the reverse.
- [ ] Every replaced `img` has explicit dimensions; CLS unchanged or better.
- [ ] Contrast audited per theme against §5.
- [ ] Page weight compared before and after — report the delta per route.
- [ ] Email templates: absolute URLs, PNG/JPG only, no SVG, text fallback intact.
- [ ] Old asset files deleted, not orphaned. List what you removed.

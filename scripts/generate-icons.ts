/**
 * Generates the PWA icons from the brand tokens.
 *
 * Checked-in binaries that nobody can regenerate go stale the moment the brand changes. This is a
 * script so a token change can reproduce them — `pnpm icons` — and so the mark is defined in one
 * place rather than in a design file nobody has.
 *
 * Flat, no gradients, no corner ornament: the treatment SPEC-shared.md §Brand direction asks for.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { defaultTokens } from '@tp/tokens';

import { FACETS, MARK } from '../apps/forms/src/components/mark-geometry.js';

const SIZES = [192, 512];
const OUT_DIR = resolve('apps/forms/public');

/**
 * The mark, imported rather than copied.
 *
 * It used to be three path strings written out again here, with a test comparing them to the
 * component's, because the component is JSX and this runs in node. The geometry now lives in
 * `mark-geometry.ts`, which is plain TypeScript and imports nothing — so both can read it and
 * there is no second copy to keep in step.
 */

/** `primary` taken towards black, for a facet that should read as folded away from the light. */
function darken(hex: string, amount = 0.72): string {
  const value = hex.replace('#', '');
  const parts = [0, 2, 4].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  return `#${parts
    .map((c) =>
      Math.round(c * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * What each facet is painted, on a tile that is itself `primary`.
 *
 * The app draws the mark in `primary` on the page; here the page *is* primary, so the same tones
 * would give a navy letter on a navy square. These are the same four surfaces — paper toward the
 * light, paper away, and the accent in two values — reckoned against the tile instead.
 */
const TILE_TONES: Record<string, (colour: { background: string; accent: string }) => string> = {
  face: (colour) => colour.background,
  fold: (colour) => darken(colour.background, 0.82),
  warm: (colour) => colour.accent,
  glow: (colour) => darken(colour.accent, 1.18),
};

/**
 * The mark as a filled tile: the plane on a brand-coloured square.
 *
 * A tile rather than a bare plane, and that is decided by where these end up. A launcher icon
 * sits on a wallpaper nobody chose and a favicon sits on browser chrome that may be light or
 * dark — a thin two-tone plane on transparency disappears into half of them. A filled square is
 * visible on all of them and is what the eye picks out of a row of tabs.
 *
 * The wings are `background` and `accent` rather than `primary` and `accent`, because the tile
 * *is* primary: a navy wing on a navy square is not a wing.
 *
 * The plane spans 62% of the tile, so the maskable variant survives a circular crop — a launcher
 * that clips the nose off leaves a shape nobody recognises.
 */
export function markSvg(size = 100): string {
  const { colour } = defaultTokens;
  const radius = Math.round(size * 0.22);

  /*
   * Fit the letter to the tile from its own bounding box rather than from the 100x100 viewBox.
   *
   * The drawing does not fill its box — the P sits at x 22..90, y 8..92 — so scaling the viewBox
   * would leave the letter small and off-centre inside the square. Measuring the shape means the
   * mark is optically centred whatever the geometry is changed to later.
   */
  const xs = FACETS.flatMap((facet) => facet.points.map(([x]) => x));
  const ys = FACETS.flatMap((facet) => facet.points.map(([, y]) => y));
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;

  // 62% of the tile, so a launcher cropping it to a circle still leaves a whole letter.
  const scale = (size * 0.62) / Math.max(width, height);
  const dx = (size - width * scale) / 2 - left * scale;
  const dy = (size - height * scale) / 2 - top * scale;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${colour.primary}"/>`,
    `<g transform="translate(${dx} ${dy}) scale(${scale})">`,
    ...FACETS.map(
      (facet) => `<path d="${MARK[facet.id]}" fill="${TILE_TONES[facet.tone]!(colour)}"/>`,
    ),
    '</g></svg>',
  ].join('');
}

const markup = (size: number) => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  html, body { margin: 0; padding: 0; }
  svg { display: block; }
</style></head>
<body>${markSvg(size)}</body></html>`;

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(markup(size), { waitUntil: 'load' });
    await page.evaluate(
      '(async () => { await document.fonts.ready; })()' as unknown as () => Promise<void>,
    );
    const png = await page.screenshot({ type: 'png' });
    await writeFile(resolve(OUT_DIR, `icon-${size}.png`), png);
    await page.close();
    console.log(`icon-${size}.png`);
  }
  await writeFile(resolve(OUT_DIR, 'favicon.svg'), markSvg(), 'utf8');
  console.log('favicon.svg');
} finally {
  await browser.close();
}

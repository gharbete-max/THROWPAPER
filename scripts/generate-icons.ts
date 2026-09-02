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

const SIZES = [192, 512];
const OUT_DIR = resolve('apps/forms/public');

/**
 * The mark, as one string, shared by every size and by the favicon.
 *
 * The same three polygons as `Logo.tsx` — top wing, keel, near wing — because a launcher icon
 * that is not the logo is just a second logo nobody agreed to. Kept as literal path data rather
 * than imported from the component: this runs in node, the component is JSX, and duplicating six
 * numbers is cheaper than building a renderer to avoid it. `icons.test.ts` compares the two.
 */
export const PLANE_PATHS = {
  topWing: 'M6 6 L96 32 L20 38.5 Z',
  keel: 'M96 32 L46 55 L26 49 Z',
  nearWing: 'M20 38.5 L96 32 L18 58 Z',
} as const;

/** `primary` taken towards black, the same shade the stylesheet mixes for the keel. */
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
  const planeWidth = size * 0.62;
  const planeHeight = planeWidth * 0.64;
  const x = (size - planeWidth) / 2;
  const y = (size - planeHeight) / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${colour.primary}"/>`,
    `<g transform="translate(${x} ${y}) scale(${planeWidth / 100})">`,
    `<path d="${PLANE_PATHS.topWing}" fill="${colour.background}"/>`,
    `<path d="${PLANE_PATHS.keel}" fill="${darken(colour.background, 0.75)}"/>`,
    `<path d="${PLANE_PATHS.nearWing}" fill="${colour.accent}"/>`,
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

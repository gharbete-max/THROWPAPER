import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXT_CONTRAST, contrastRatio } from './contrast.js';
import { toDark } from './derive.js';
import { defaultTokens } from './index.js';
import { IMAGE_CHIP_ALPHA, IMAGE_DIM, IMAGE_SCRIM, IMAGE_TEXT } from './media.js';
import stats from './media-stats.json' with { type: 'json' };

/**
 * Text over the shipped photographs. The committed statistics (`media-stats.json`, written by
 * `python scripts/media-process.py --stats` from the WebP files themselves) hold the brightest and
 * the darkest pixel of each picture, whole and in the bottom third where a scrim is at full
 * strength. The test composites a scrim or a chip over those pixels, in each theme, and asks for
 * 4.5:1. It reads no image, so it needs no decoder; the hash check is what keeps the statistics
 * honest, and a changed photograph fails there until they are made again.
 */
type Rgb = readonly [number, number, number];
const MEDIA = join(import.meta.dirname, '..', '..', '..', 'apps', 'forms', 'public', 'media');
const photographs = Object.entries(stats) as [string, (typeof stats)[keyof typeof stats]][];

const hex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const channels = (colour: string): Rgb => {
  const n = Number.parseInt(colour.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** `top` at `alpha` over `under`, per channel in sRGB, as a browser composites it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
const dim = (pixel: Rgb, theme: 'light' | 'dark'): Rgb =>
  (theme === 'dark' ? pixel.map((c) => c * IMAGE_DIM) : pixel) as unknown as Rgb;
const ratio = (a: Rgb, b: string) => contrastRatio(hex(a), b) ?? 0;

const THEMES = { light: defaultTokens, dark: toDark(defaultTokens) } as const;

describe('the statistics belong to the pictures', () => {
  it('has one entry per shipped photograph, each with the hash of its bytes', () => {
    const files = readdirSync(MEDIA).filter((name) => name.endsWith('.webp'));
    expect(photographs.map(([name]) => name).sort()).toEqual(files.sort());
    for (const [name, entry] of photographs) {
      const sha256 = createHash('sha256')
        .update(readFileSync(join(MEDIA, name)))
        .digest('hex');
      expect(entry.sha256, `${name}: run python scripts/media-process.py --stats`).toBe(sha256);
    }
  });

  it('dims in the dark theme by the number the stylesheet uses', () => {
    const css = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'apps', 'forms', 'src', 'styles.css'),
      'utf8',
    );
    expect(css).toContain(`filter: brightness(${IMAGE_DIM})`);
  });
});

describe.each(Object.keys(THEMES) as (keyof typeof THEMES)[])(
  'text over a photograph, %s theme',
  (theme) => {
    const tokens = THEMES[theme];

    it.each(photographs)(
      '%s: white text on the scrim reaches 4.5:1 on its brightest pixel',
      (name, entry) => {
        const pixel = dim(entry.bands.bottom.brightest as unknown as Rgb, theme);
        const under = over(channels(IMAGE_SCRIM.colour), IMAGE_SCRIM.alpha, pixel);
        expect(ratio(under, IMAGE_TEXT), name).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      },
    );

    it.each(photographs)(
      '%s: the theme text on a chip reaches 4.5:1 on its brightest and darkest pixel',
      (name, entry) => {
        for (const extreme of ['brightest', 'darkest'] as const) {
          const pixel = dim(entry.bands.whole[extreme] as unknown as Rgb, theme);
          const plate = over(channels(tokens.colour.background), IMAGE_CHIP_ALPHA, pixel);
          expect(ratio(plate, tokens.colour.text), `${name} ${extreme}`).toBeGreaterThanOrEqual(
            TEXT_CONTRAST,
          );
        }
      },
    );
  },
);

describe('the guard bites', () => {
  const white: Rgb = [255, 255, 255];

  it('fails a scrim too thin for the brightest photograph', () => {
    const thin = over([0, 0, 0], 0.3, white);
    expect(ratio(thin, IMAGE_TEXT)).toBeLessThan(TEXT_CONTRAST);
  });

  it('fails a chip too faint for a bright pixel under dark-theme text', () => {
    const dark = THEMES.dark;
    const faint = over(channels(dark.colour.background), 0.3, white);
    expect(ratio(faint, dark.colour.text)).toBeLessThan(TEXT_CONTRAST);
  });

  it('holds with margin: the scrim is enough for pure white, so for any picture', () => {
    expect(
      ratio(over(channels(IMAGE_SCRIM.colour), IMAGE_SCRIM.alpha, white), IMAGE_TEXT),
    ).toBeGreaterThan(TEXT_CONTRAST);
  });
});

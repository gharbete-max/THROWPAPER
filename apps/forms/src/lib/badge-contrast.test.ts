import { describe, expect, it } from 'vitest';
import { TEXT_CONTRAST, contrastRatio, defaultTokens, toDark } from '@tp/tokens';
import { allCss } from './all-css.js';

/**
 * Status badges (Signed, Published, Paid) on the tinted fill (review 2026-10, forms UI).
 *
 * Axe cannot judge them: the page behind is a gradient, so it reports "incomplete". Measured on the
 * rendered pixels the plain success green read 4.1:1 in the light theme. The label now moves 25%
 * toward the ink; this holds that formula to 4.5:1 on the page colour in both themes, and holds the
 * stylesheet to the formula.
 */
const channel = (hex: string, at: number) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
function blend(a: string, b: string, amount: number): string {
  const out = [0, 1, 2].map((i) =>
    Math.round(channel(a, i) * amount + channel(b, i) * (1 - amount)),
  );
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('the success badges', () => {
  for (const [name, tokens] of [
    ['light', defaultTokens],
    ['dark', toDark(defaultTokens)],
  ] as const) {
    it(`read at ${TEXT_CONTRAST}:1 on their tint in the ${name} theme`, () => {
      const { success, text, background } = tokens.colour;
      const label = blend(success, text, 0.75);
      const fill = blend(success, background, 0.1);
      expect(contrastRatio(label, fill)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    });
  }

  it('use the label colour the test measures', () => {
    const css = allCss();
    const rule =
      /\.badge--(published|paid|completed)[^{]*\{[^}]*color: color-mix\(in srgb, var\(--tp-colour-success\) 75%, var\(--tp-colour-text\)\)/g;
    expect(css.match(rule)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

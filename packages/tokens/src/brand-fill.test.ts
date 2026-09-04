import { describe, expect, it } from 'vitest';
import { brandFill, buttonSurface } from './derive.js';
import { BOUNDARY_CONTRAST, TEXT_CONTRAST, contrastRatio } from './contrast.js';
import { defaultTokens } from './index.js';

/**
 * A filled button has to be visible, not only legible.
 *
 * These are two different requirements and only one of them was being checked. `readableOn` picks a
 * label that reads against the fill, and `accentInk` walks the accent until text on the page clears
 * 4.5:1 — but nothing compared the *fill* to the page behind it. A pale button with dark text on it
 * passes every text check and is still a rectangle nobody can see the edge of.
 *
 * It became a real risk rather than a theoretical one when the Brand Kit started reading an
 * organisation's logo and offering its dominant colour as the primary. The palette is no longer
 * something a person chose by looking at it: a pale yellow wordmark gives a pale yellow primary,
 * and nobody reviewed that against parchment.
 */
const PALE = {
  ...defaultTokens,
  colour: { ...defaultTokens.colour, primary: '#f2e6a8' },
};

describe('the brand fill', () => {
  it('leaves a colour alone when it already stands off the page', () => {
    // The shipped midnight is far from parchment, so nothing should move.
    expect(brandFill(defaultTokens.colour)).toBe(defaultTokens.colour.primary);
  });

  it('rescues a pale colour that a logo could plausibly produce', () => {
    const before = contrastRatio(PALE.colour.primary, PALE.colour.background) ?? 0;
    const after = contrastRatio(brandFill(PALE.colour), PALE.colour.background) ?? 0;

    expect(before).toBeLessThan(BOUNDARY_CONTRAST);
    expect(after).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST);
  });

  /**
   * The fix must not become a different fix.
   *
   * Walking toward the palette's own ink keeps a warm brand warm. Simply darkening toward black
   * was the obvious implementation and it turns a yellow into an olive, which is a colour nobody
   * chose and cannot be defended to the organisation whose logo it came from.
   */
  it('keeps the hue it was given', () => {
    const fill = brandFill(PALE.colour);
    const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(fill.slice(at, at + 2), 16));

    // The source is a warm yellow: red and green well ahead of blue. That has to survive.
    expect(red).toBeGreaterThan(blue!);
    expect(green!).toBeGreaterThan(blue!);
  });

  it('is used by the button, which is where it matters', () => {
    const surface = buttonSurface(PALE);
    expect(contrastRatio(surface.background, PALE.colour.background) ?? 0).toBeGreaterThanOrEqual(
      BOUNDARY_CONTRAST,
    );
  });

  /**
   * And the label still has to read against whatever the fill became.
   *
   * Darkening the fill changes what colour the text on it should be, so the two decisions have to
   * be made in that order. Making them independently is how a dark button ends up with dark text.
   */
  it('leaves the label readable against the fill it produced', () => {
    for (const tokens of [defaultTokens, PALE]) {
      const surface = buttonSurface(tokens);
      if (surface.background === 'transparent') continue;
      expect(contrastRatio(surface.text, surface.background) ?? 0).toBeGreaterThanOrEqual(
        TEXT_CONTRAST,
      );
    }
  });

  /**
   * A soft button is a tint, so it is fainter than the fill it is tinted from.
   *
   * Its boundary therefore has to come from its border rather than its background, or the whole
   * control is a slightly different shade of page.
   */
  it('gives a soft button a border that can be seen', () => {
    const surface = buttonSurface({ ...PALE, buttonStyle: 'soft' });
    expect(surface.border).not.toBe('transparent');
    expect(contrastRatio(surface.border, PALE.colour.background) ?? 0).toBeGreaterThanOrEqual(
      BOUNDARY_CONTRAST,
    );
  });

  /**
   * Every button style, against a palette chosen to be as unhelpful as a real one can be.
   *
   * Not a fixed list of colours somebody thought of: this walks a range of lightnesses, because the
   * failure is a function of how close the brand is to the page and any single sample would only
   * prove one point on that curve.
   */
  it.each(['solid', 'outline', 'soft'] as const)(
    'holds for a %s button at every lightness',
    (style) => {
      for (let level = 0x11; level <= 0xee; level += 0x11) {
        const hex = `#${level.toString(16).padStart(2, '0').repeat(3)}`;
        const tokens = {
          ...defaultTokens,
          buttonStyle: style,
          colour: { ...defaultTokens.colour, primary: hex },
        };
        const surface = buttonSurface(tokens);

        /*
         * Either surface may carry the boundary, and which one does is the style's business.
         *
         * A solid button is its fill. An outline button is its border. A soft button is a tint too
         * faint to be an edge, so its border does the work — which is the whole reason the border
         * stopped being transparent. Asking only about the fill was this test being wrong about a
         * design that was right.
         */
        const edges = [surface.background, surface.border]
          .filter((value) => value !== 'transparent')
          .map((value) => contrastRatio(value, tokens.colour.background) ?? 0);

        expect(
          Math.max(...edges),
          `${style} button at ${hex} has no visible edge`,
        ).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST);
      }
    },
  );
});

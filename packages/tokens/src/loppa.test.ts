import { describe, expect, it } from 'vitest';
import { BOUNDARY_CONTRAST, TEXT_CONTRAST, checkContrast, contrastRatio } from './contrast.js';
import { toCssVariables } from './compile-web.js';
import { buttonSurface, toDark } from './derive.js';
import { defaultTokens } from './index.js';

/**
 * The shipped palette is Loppa's, and these are its measured numbers.
 *
 * `docs/brand/tokens-loppa.css` carries a table of WCAG ratios for the identity — gold 2.14:1 on
 * white, 8.61:1 on black; bronze 4.64:1 — and START-HERE §7 asks for exactly this file: a contrast
 * test per theme against that table, so a future palette change fails CI rather than shipping.
 * Every other test in this package holds the *mechanism* against whatever a customer might save.
 * This one holds the *default* to the brand.
 *
 * Gold failing 3:1 on the page is not a fault. It is the case the filled-button mechanism exists
 * for: the fill keeps the brand, and the label and boundary come from the ink. What would be a
 * fault is the mechanism giving up on it — a walked, muddier gold — which is what the button
 * assertions below rule out.
 */
const LOPPA = {
  gold: '#cea85c',
  bronze: '#8f6b3a',
  white: '#fafaf8',
  platinumPale: '#e9ebee',
  black: '#0e0e10',
  graphite: '#4a4e55',
  pewter: '#7c8188',
} as const;

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;

describe('the shipped palette is Loppa', () => {
  it('takes its values from the brand bundle, not from an earlier round', () => {
    const { colour } = defaultTokens;
    expect(colour.primary).toBe(LOPPA.gold);
    expect(colour.secondary).toBe(LOPPA.bronze);
    expect(colour.accent).toBe(LOPPA.bronze);
    expect(colour.background).toBe(LOPPA.white);
    expect(colour.surface).toBe(LOPPA.platinumPale);
    expect(colour.text).toBe(LOPPA.black);
    expect(colour.muted).toBe(LOPPA.graphite);
    expect(colour.border).toBe(LOPPA.pewter);
  });

  /** The table in `tokens-loppa.css`, to two decimals, on the page the app actually paints. */
  it('measures what the brand bundle measured', () => {
    const { colour } = defaultTokens;
    expect(ratio(colour.primary, colour.background)).toBe(2.14);
    expect(ratio(colour.primary, colour.text)).toBe(8.61);
    expect(ratio(colour.secondary, colour.background)).toBe(4.64);
    expect(ratio(colour.border, colour.background)).toBe(3.75);
    expect(ratio(colour.muted, colour.background)).toBe(8);
    expect(ratio(colour.text, colour.background)).toBe(18.45);
    expect(checkContrast(defaultTokens)).toEqual([]);
  });

  /** Gold face, ink label, ink edge: `--loppa-accent-fill` as the brand writes it. */
  it('paints the filled button gold with an ink label and an ink boundary', () => {
    const button = buttonSurface(defaultTokens);
    expect(button).toEqual({ background: LOPPA.gold, text: LOPPA.black, border: LOPPA.black });
    expect(ratio(button.text, button.background)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(ratio(button.border, defaultTokens.colour.background)).toBeGreaterThanOrEqual(
      BOUNDARY_CONTRAST,
    );
  });

  /** Where the brand becomes words it is bronze or the ink — never the face gold. */
  it('reads in bronze and ink, not in gold', () => {
    const vars = toCssVariables(defaultTokens);
    expect(vars['--tp-colour-heading']).toBe(LOPPA.black);
    expect(vars['--tp-colour-accent-ink']).toBe(LOPPA.bronze);
    expect(vars['--tp-focus']).toBe(LOPPA.bronze);
  });

  /**
   * The identity is strongest on near-black, and the derived dark theme has to land there rather
   * than past it. An ink that is already a night page is the night page; darkening it further is
   * the walk to pure black the brand forbids, and it collapsed the card onto the page (1.01:1) with
   * the border under 3:1 beneath it.
   */
  it('derives a dark theme on the brand’s own near-black, with gold reading on it', () => {
    const dark = toDark(defaultTokens);
    expect(dark.colour.background).toBe(LOPPA.black);
    expect(ratio(dark.colour.primary, dark.colour.background)).toBeGreaterThanOrEqual(8);
    // The brand's own raised surface, `#1a1a1d`, is 1.11:1 above its page: a step, not a hole.
    expect(ratio(dark.colour.surface, dark.colour.background)).toBeGreaterThanOrEqual(1.1);
    expect(ratio(dark.colour.border, dark.colour.background)).toBeGreaterThanOrEqual(
      BOUNDARY_CONTRAST,
    );
    expect(checkContrast(dark)).toEqual([]);
  });

  it('compiles to CSS with no trace of the seafoam and coral round', () => {
    for (const theme of [defaultTokens, toDark(defaultTokens)]) {
      const css = Object.values(toCssVariables(theme)).join(' ');
      expect(css).not.toMatch(/#(6fb8a6|2e3a38|ef8874|8f6156|f6f5f2|eceae5|858585)/i);
    }
  });
});

/**
 * Loppa's own gold is 2.14:1 on white, which is why a chosen answer's edge is derived rather than
 * painted in the raw primary. Pinned here, beside the palette, so the default theme is proven to
 * clear the floor that `locked.test.ts` holds hostile ones to.
 */
describe('the shipped palette marks a chosen answer at 3:1', () => {
  it('walks the gold for the edge, and keeps the ink ones as they are', () => {
    const vars = toCssVariables(defaultTokens);
    const edge = vars['--tp-colour-primary-edge']!;
    expect(edge).not.toBe(defaultTokens.colour.primary);
    for (const ground of [defaultTokens.colour.background, defaultTokens.colour.surface]) {
      expect(contrastRatio(edge, ground) ?? 0).toBeGreaterThanOrEqual(3);
    }
  });
});

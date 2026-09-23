import { describe, expect, it } from 'vitest';
import { brand } from '@tp/shared';
import { BOUNDARY_CONTRAST, TEXT_CONTRAST, contrastRatio } from './contrast.js';
import { buttonSurface, focusRing, toDark } from './derive.js';
import { toCssVariables } from './compile-web.js';
import { defaultTokens } from './index.js';
import type { TokenSet } from './types.js';

/**
 * What survives a theme written by somebody who is not thinking about it.
 *
 * The product's selling point is that an organisation replaces the palette, and the consequence is
 * that a person with no interest in contrast ratios decides what a form looks like for four hundred
 * members. Most of what they choose is theirs to choose. A short list is not, because the cost of
 * getting it wrong is paid by somebody else entirely — the member on a phone at a door, the person
 * navigating by keyboard — and is invisible to the person who chose it, who is using a mouse on a
 * laptop and thinks it looks smart.
 *
 * So these are locked in code rather than documented, and this file is the proof. Each case is a
 * theme somebody could plausibly save today, not a fuzzer's output: a pale corporate cream, a
 * near-black "dark brand", a mid-grey that no text reads on, and a set of sizes that look tidy in
 * a preview and break a phone.
 *
 * `checkContrast` is deliberately *not* the mechanism. Its findings are advisory — refusing to save
 * a brand over one subtle border would be obnoxious — which makes it exactly the wrong instrument
 * for a guarantee. A warning somebody can click past is not a floor.
 */

const hostile = (colour: Partial<TokenSet['colour']>, rest: Partial<TokenSet> = {}): TokenSet =>
  brand.BrandKit.parse({
    ...defaultTokens,
    ...rest,
    colour: { ...defaultTokens.colour, ...colour },
  }) as TokenSet;

/** Themes a real customer could save, each hostile to a different guarantee. */
const THEMES: Array<[string, TokenSet]> = [
  ['near-white brand', hostile({ primary: '#fdfdfb', secondary: '#f7f7f5', accent: '#fbfbf9' })],
  ['near-black brand', hostile({ primary: '#050505', secondary: '#0a0a0a', accent: '#020202' })],
  // `#767676`, not `#808080`: the ink went near-black and an ink label reads on `#808080` at 4.6.
  ['mid-grey, readable by nothing', hostile({ primary: '#767676', secondary: '#7f7f7f' })],
  [
    'brand identical to the page',
    hostile({
      primary: defaultTokens.colour.background,
      secondary: defaultTokens.colour.background,
    }),
  ],
  /**
   * The palette this product shipped with before Loppa's: seafoam, coral, a green-black ink on
   * warm paper. A customer who liked it can save it, so it is held to the same floors as anything
   * else — and it is the mid-tone case the filled-button mechanism was worked out on.
   */
  [
    'the seafoam and coral round',
    hostile({
      primary: '#6fb8a6',
      secondary: '#2e3a38',
      accent: '#ef8874',
      background: '#f6f5f2',
      surface: '#eceae5',
      text: '#2e3a38',
      muted: '#666666',
      border: '#858585',
    }),
  ],
  ['dark page, light ink', hostile({ background: '#101010', surface: '#1c1c1c', text: '#f2f2f2' })],
  [
    'one colour for everything',
    hostile({
      primary: '#888888',
      secondary: '#888888',
      surface: '#888888',
      background: '#888888',
      text: '#111111',
    }),
  ],
];

describe('the locked list, against a hostile theme', () => {
  /**
   * A focus ring nobody can see ends keyboard navigation, and does it silently.
   *
   * Both surfaces, not just the page: a ring is drawn around a control on the page *and* around one
   * inside a card, and a colour that clears the first can vanish on the second — which is where
   * most focusable things in this product actually sit.
   */
  it.each(THEMES)('keeps the focus ring visible on both surfaces: %s', (_name, tokens) => {
    for (const theme of [tokens, toDark(tokens)]) {
      const ring = focusRing(theme.colour);
      expect(contrastRatio(ring, theme.colour.background) ?? 0).toBeGreaterThanOrEqual(
        BOUNDARY_CONTRAST,
      );
      expect(contrastRatio(ring, theme.colour.surface) ?? 0).toBeGreaterThanOrEqual(
        BOUNDARY_CONTRAST,
      );
    }
  });

  /**
   * A button's label has to be readable on whatever the fill became.
   *
   * This is the pair that used to be checked in the wrong place — the page colour against the raw
   * primary — and passed for themes that render badly while failing for themes that render well.
   */
  it.each(THEMES)('keeps a button label readable: %s', (_name, tokens) => {
    for (const theme of [tokens, toDark(tokens)]) {
      const surface = buttonSurface(theme);
      if (surface.background === 'transparent') continue;
      expect(contrastRatio(surface.text, surface.background) ?? 0).toBeGreaterThanOrEqual(
        TEXT_CONTRAST,
      );
    }
  });

  /**
   * The brand where it becomes words.
   *
   * Two tokens turn a chosen colour into text — `accent-ink` for a label, `heading` for an `h1` —
   * and both exist because the raw colour was painted as text and measured under 2.2:1. Whatever
   * the customer chose, the derived value has to read on the page it is read on.
   */
  it.each(THEMES)('keeps derived text readable: %s', (_name, tokens) => {
    for (const theme of [tokens, toDark(tokens)]) {
      const vars = toCssVariables(theme);
      for (const name of ['--tp-colour-accent-ink', '--tp-colour-heading']) {
        expect(
          contrastRatio(vars[name]!, theme.colour.background) ?? 0,
          `${name} on the page`,
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST);
      }
      // And on the page turned over, which is what the site's dark band is.
      expect(
        contrastRatio(vars['--tp-colour-accent-on-ink']!, theme.colour.text) ?? 0,
        'accent on ink',
      ).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    }
  });

  /**
   * The mark that says which choice is chosen.
   *
   * A selected button or card is told apart from its neighbours by its edge alone — that is WCAG
   * 1.4.11, 3:1 for a boundary. The edge used to be the raw primary, which under Loppa's own gold
   * is 2.14:1 on the page: the product's default theme failed its own floor. An author can now
   * pick which brand colour marks a question's choices, so all three have an edge token, and each
   * has to clear both surfaces a choice sits on, in both schemes, whatever was saved.
   */
  it.each(THEMES)('keeps a chosen answer distinguishable: %s', (_name, tokens) => {
    for (const theme of [tokens, toDark(tokens)]) {
      const vars = toCssVariables(theme);
      for (const role of ['primary', 'secondary', 'accent']) {
        const edge = vars[`--tp-colour-${role}-edge`];
        expect(edge, `--tp-colour-${role}-edge is emitted`).toBeDefined();
        for (const ground of ['background', 'surface'] as const) {
          expect(
            contrastRatio(edge!, theme.colour[ground]) ?? 0,
            `${role} edge on ${ground}`,
          ).toBeGreaterThanOrEqual(BOUNDARY_CONTRAST);
        }
      }
    }
  });

  /**
   * The sizes, which are the ones a customer breaks by picking a number that looks tidy.
   *
   * Clamped on the way in rather than rejected, so an organisation that sets a 30px control keeps
   * its colours, its fonts and its logo and loses only the number that was not theirs to set.
   */
  it('holds the tap target, the input size and the hairline', () => {
    const tiny = brand.BrandKit.parse({
      ...defaultTokens,
      controlHeight: '28px',
      borderWidth: '0px',
      typography: { ...defaultTokens.typography, baseSize: '11px' },
    });

    expect(tiny.controlHeight).toBe('44px');
    expect(tiny.borderWidth).toBe('1px');
    expect(tiny.typography.baseSize).toBe('16px');
  });

  /** A theme that already clears the floors is left exactly as it was written. */
  it('does not round up a theme that was already fine', () => {
    const generous = brand.BrandKit.parse({
      ...defaultTokens,
      controlHeight: '52px',
      borderWidth: '2px',
      typography: { ...defaultTokens.typography, baseSize: '18px' },
    });

    expect(generous.controlHeight).toBe('52px');
    expect(generous.borderWidth).toBe('2px');
    expect(generous.typography.baseSize).toBe('18px');
  });

  /**
   * Nothing a theme sets may leave a `var()` or an empty value in the compiled CSS.
   *
   * The email and PDF targets cannot follow a custom property, and a token that arrives as the
   * string `undefined` is a colour the browser ignores — which is how a locked guarantee becomes
   * "no outline at all" without any check noticing.
   */
  it.each(THEMES)('compiles every token to a literal: %s', (_name, tokens) => {
    for (const [name, value] of Object.entries(toCssVariables(tokens))) {
      expect(value, `${name} is not a literal`).not.toMatch(/var\(|undefined|NaN/);
      expect(value.trim(), `${name} is empty`).not.toBe('');
    }
  });
});

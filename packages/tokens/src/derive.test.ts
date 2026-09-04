import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from './presets.js';
import { accentInk, buttonSurface, mix, readableOn, shadow, toDark, toHsl } from './derive.js';
import { checkContrast, contrastRatio } from './contrast.js';
import { toCssVariables, toThemedCssBlock } from './compile-web.js';
import defaults from './default-tokens.json' with { type: 'json' };
import type { TokenSet } from './types.js';

const base = defaults as TokenSet;

const describeFindings = (findings: ReturnType<typeof checkContrast>) =>
  findings
    .map((finding) => `${finding.token} on ${finding.against} is ${finding.ratio.toFixed(2)}:1`)
    .join('; ');

/**
 * The dark palette is computed, so nobody looks at it before it ships.
 *
 * That is the whole risk of deriving a theme instead of authoring one: it is generated for every
 * organisation's colours, including combinations nobody has ever seen. The contrast checker
 * already exists and is the only thing that can look at all of them.
 */
describe('the derived dark theme', () => {
  it.each(THEME_PRESETS.map((theme) => theme.id))('is readable: %s', (id) => {
    const theme = THEME_PRESETS.find((candidate) => candidate.id === id)!;
    const text = checkContrast(toDark(theme.tokens)).filter((finding) => finding.kind === 'text');
    expect(text, describeFindings(text)).toEqual([]);
  });

  it('puts surfaces above the page, not below it', () => {
    // On a light theme a card is darker than the page. Invert that naively and every card on a
    // dark theme reads as a hole punched in the background.
    for (const theme of THEME_PRESETS) {
      const dark = toDark(theme.tokens).colour;
      expect(contrastRatio(dark.surface, '#000000') ?? 0, theme.id).toBeGreaterThan(
        contrastRatio(dark.background, '#000000') ?? 0,
      );
    }
  });

  it('lifts a dark brand colour so it can be seen at all', () => {
    // A navy primary is invisible on a dark page and useless as a button.
    const midnight = THEME_PRESETS.find((theme) => theme.id === 'midnight')!;
    const dark = toDark(midnight.tokens).colour;
    expect(contrastRatio(dark.primary, dark.background) ?? 0).toBeGreaterThan(3);
  });

  /**
   * The bug this exists for, which the contrast test could not see.
   *
   * Lifting a brand colour by mixing it toward the page's near-white text turned the midnight
   * navy `#1b2a45` into `#b0b2b5` — a dead grey with excellent contrast and no brand left in it.
   * Every readability assertion passed. Saturation is the property that was lost, so saturation is
   * what has to be asserted.
   */
  it('keeps a lifted brand colour coloured, not grey', () => {
    for (const theme of THEME_PRESETS) {
      const before = toHsl(theme.tokens.colour.primary);
      const after = toHsl(toDark(theme.tokens).colour.primary);
      if (!before || !after || before[1] < 0.15) continue; // A grey primary may stay grey.
      // Some loss is inevitable on the way up; losing nearly all of it is the failure.
      expect(after[1], `${theme.id}: ${theme.tokens.colour.primary}`).toBeGreaterThan(
        before[1] * 0.6,
      );
    }
  });

  it('keeps the hue itself, not merely some colour', () => {
    // A lift that preserved saturation but rotated the hue would pass the test above and give a
    // customer a dark mode in somebody else's brand.
    const midnight = THEME_PRESETS.find((theme) => theme.id === 'midnight')!;
    const before = toHsl(midnight.tokens.colour.primary)!;
    const after = toHsl(toDark(midnight.tokens).colour.primary)!;
    const apart = Math.abs(before[0] - after[0]);
    expect(Math.min(apart, 360 - apart)).toBeLessThan(8);
  });

  it('keeps the theme warm or cool rather than making every dark mode the same grey', () => {
    const midnight = toDark(THEME_PRESETS.find((theme) => theme.id === 'midnight')!.tokens).colour;
    const garden = toDark(THEME_PRESETS.find((theme) => theme.id === 'garden')!.tokens).colour;
    expect(midnight.background).not.toBe(garden.background);
  });
});

describe('the button style token', () => {
  /**
   * The regression this exists for: `buttonStyle` was a token for two phases, four presets set it,
   * and it reached nothing. Choosing "Minimal" gave the same solid button as everything else.
   */
  it('paints outline, soft and solid differently', () => {
    const solid = buttonSurface({ ...base, buttonStyle: 'solid' });
    const outline = buttonSurface({ ...base, buttonStyle: 'outline' });
    const soft = buttonSurface({ ...base, buttonStyle: 'soft' });

    expect(outline.background).toBe('transparent');
    expect(soft.background).not.toBe(solid.background);
    expect(soft.background).not.toBe('transparent');
    expect(new Set([solid.background, outline.background, soft.background]).size).toBe(3);
  });

  it('puts readable text on a solid button', () => {
    for (const theme of THEME_PRESETS) {
      const button = buttonSurface({ ...theme.tokens, buttonStyle: 'solid' });
      expect(contrastRatio(button.text, button.background) ?? 0, theme.id).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('uses the theme’s own colours rather than reaching for white', () => {
    // A parchment theme wants its cream on a navy button, not the one pure white in a palette
    // that deliberately has none.
    const midnight = THEME_PRESETS.find((theme) => theme.id === 'midnight')!;
    const button = buttonSurface({ ...midnight.tokens, buttonStyle: 'solid' });
    expect([midnight.tokens.colour.background, midnight.tokens.colour.text]).toContain(button.text);
  });
});

/**
 * `accent` is decoration in the app, so `checkContrast` deliberately never tests it against the
 * background — reporting a pair nothing renders trains people to ignore the warnings.
 *
 * Then the site used it as a small uppercase label, and the shipped accent came out at 3.57:1 on
 * parchment. Nothing could have caught it: the checker was right not to look, and the stylesheet
 * was the first place the colour became words.
 */
describe('the accent, where it has to be read', () => {
  it.each(THEME_PRESETS.map((theme) => theme.id))('is legible as text: %s', (id) => {
    const theme = THEME_PRESETS.find((candidate) => candidate.id === id)!;
    const ink = accentInk(theme.tokens.colour);
    expect(contrastRatio(ink, theme.tokens.colour.background) ?? 0).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves an accent alone when it already reads', () => {
    // Darkening a colour that passes would cost the brand for nothing.
    const readable = { ...defaults.colour, accent: '#000000', background: '#ffffff' };
    expect(accentInk(readable)).toBe('#000000');
  });

  it('leaves an accent that already reads exactly as it is', () => {
    /**
     * It stops at the first mix that clears the bar rather than walking all the way to the ink.
     * Darkening a colour that was already legible would throw away the brand for contrast nobody
     * asked for — the point is a readable accent, not a readable grey.
     *
     * `minimal` is the case worth having in the list: its accent and its ink are the same colour on
     * purpose, so "keeps some accent" and "is not the text colour" are different claims there.
     */
    for (const theme of THEME_PRESETS) {
      const { accent, background } = theme.tokens.colour;
      if ((contrastRatio(accent, background) ?? 0) < 4.5) continue;
      expect(accentInk(theme.tokens.colour), theme.id).toBe(accent);
    }
  });
});

describe('the derived scales', () => {
  it('gives a flat theme no resting shadow but still floats an overlay', () => {
    const flat = toCssVariables({ ...base, shadowLevel: 0 });
    expect(flat['--tp-shadow']).toBe('none');
    // A dialog with no shadow on a flat theme has no visible edge.
    expect(flat['--tp-shadow-overlay']).not.toBe('none');
  });

  it('keeps a square theme square all the way down the radius family', () => {
    const square = toCssVariables({ ...base, radius: '0px' });
    expect(square['--tp-radius-sm']).toBe('0px');
    expect(square['--tp-radius-lg']).toBe('0px');
    expect(square['--tp-radius-xl']).toBe('0px');
  });

  it('follows the brand’s own ratio up the type scale', () => {
    const tight = toCssVariables({
      ...base,
      typography: { ...base.typography, baseSize: '16px', scaleRatio: 1.2 },
    });
    const loose = toCssVariables({
      ...base,
      typography: { ...base.typography, baseSize: '16px', scaleRatio: 1.5 },
    });
    expect(tight['--tp-text-3xl']).not.toBe(loose['--tp-text-3xl']);
    expect(tight['--tp-text-base']).toBe('16px');
  });

  it('survives a stored length the compiler cannot parse', () => {
    // Brand kits are old data. A radius saved as `0.5rem` must not take the whole page down.
    expect(() => toCssVariables({ ...base, radius: '0.5rem' })).not.toThrow();
  });

  it('emits no variable references, so email and print can read it', () => {
    for (const theme of THEME_PRESETS) {
      expect(toThemedCssBlock(theme.tokens).includes('var('), theme.id).toBe(false);
    }
  });

  it('lets a stated choice turn dark mode off as well as on', () => {
    // The common bug: dark mode that only the system can control, so the toggle is one-way.
    const css = toThemedCssBlock(base);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root:not([data-theme="light"])');
  });
});

describe('colour helpers', () => {
  it('mixes toward the first colour', () => {
    expect(mix('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(mix('#ffffff', '#000000', 0)).toBe('#000000');
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
  });

  it('picks the more readable of two candidates', () => {
    expect(readableOn('#000000', '#ffffff', '#111111')).toBe('#ffffff');
    expect(readableOn('#ffffff', '#ffffff', '#111111')).toBe('#111111');
  });

  it('clamps an out-of-range shadow level rather than returning undefined', () => {
    expect(shadow(-1)).toBe('none');
    expect(shadow(99)).toBe(shadow(3));
  });
});

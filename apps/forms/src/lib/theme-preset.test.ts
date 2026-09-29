import { describe, expect, it } from 'vitest';
import { THEME_PRESETS, defaultTokens, type TokenSet } from '@tp/tokens';
import { presetById, withPreset } from './theme-preset.js';

/**
 * A preset over a kit — the Brand screen's gallery and the guided builder's colour question
 * (owner question 8) apply it with this one function.
 */
describe('a preset applied over a kit', () => {
  const kit: TokenSet = {
    ...defaultTokens,
    radius: '3px',
    colour: { ...defaultTokens.colour, primary: '#123456' },
    logoLight: '/uploads/logo-light.png',
    logoDark: '/uploads/logo-dark.png',
    favicon: '/uploads/favicon.png',
  };

  it("replaces the whole look, and keeps the organisation's marks", () => {
    for (const theme of THEME_PRESETS) {
      const applied = withPreset(theme, kit);
      expect(applied).toEqual({
        ...theme.tokens,
        logoLight: kit.logoLight,
        logoDark: kit.logoDark,
        favicon: kit.favicon,
      });
    }
  });

  it('with no kit yet, is the preset itself: the first kit, with no logo', () => {
    const garden = presetById('garden')!;
    expect(withPreset(garden, defaultTokens)).toEqual(garden.tokens);
  });

  it('finds presets by id, and nothing else', () => {
    expect(presetById('midnight')?.id).toBe('midnight');
    expect(presetById('nonsense')).toBeUndefined();
  });
});

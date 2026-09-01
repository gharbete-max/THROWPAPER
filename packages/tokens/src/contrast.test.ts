import { describe, expect, it } from 'vitest';
import { checkContrast, contrastRatio, parseHex } from './contrast.js';
import defaults from './default-tokens.json' with { type: 'json' };
import type { TokenSet } from './types.js';

const defaultTokens = defaults as TokenSet;

describe('contrast', () => {
  it('agrees with the values every checker reports', () => {
    // The two anchors: black on white is 21, and a colour against itself is 1.
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#1f4b99', '#1f4b99')).toBe(1);
    // A published figure, so this cannot drift into self-consistency.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('does not care which way round the colours are given', () => {
    expect(contrastRatio('#1B263B', '#F4F1EA')).toBe(contrastRatio('#F4F1EA', '#1B263B'));
  });

  it('reads three-digit hex, with or without the hash', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
  });

  it('says it does not know rather than guessing', () => {
    // Reporting 21:1 for a typo would be worse than reporting nothing.
    expect(parseHex('rebeccapurple')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(contrastRatio('#ffffff', 'not a colour')).toBeNull();
  });

  /**
   * The default palette passes on every text pair. It reports exactly one advisory: the border is
   * a pale grey at 1.36 against white, where WCAG 1.4.11 wants 3 for a boundary that identifies a
   * control.
   *
   * That is left as it is, deliberately. Reaching 3:1 on white needs roughly #8b919b — a
   * noticeably heavy grey around every input — and the visual direction for this product is flat
   * and quiet. So contrast findings are **advisory**: shown to whoever is choosing colours, never
   * blocking a save. Refusing to store somebody's brand over a subtle border would be obnoxious;
   * not telling them at all would be negligent.
   *
   * This test exists to make that a decision rather than an oversight — if the border changes, it
   * fails and somebody has to think about it again.
   */
  it('passes the shipped default palette on text, with the border as the one known advisory', () => {
    const findings = checkContrast(defaultTokens);
    expect(findings.map((finding) => finding.token)).toEqual(['colour.border']);
    expect(findings.every((finding) => finding.kind === 'boundary')).toBe(true);
  });

  it('catches text that cannot be read on its own background', () => {
    const unreadable: TokenSet = {
      ...defaultTokens,
      colour: { ...defaultTokens.colour, text: '#eeeeee', background: '#ffffff' },
    };

    const findings = checkContrast(unreadable);
    expect(findings.map((finding) => finding.token)).toContain('colour.text');
    expect(findings.find((finding) => finding.token === 'colour.text')?.required).toBe(4.5);
  });

  it('holds a border to the lower non-text bar, not the text one', () => {
    // A border at 3.2:1 is fine and must not be reported; the same colour as text would not be.
    const tokens: TokenSet = {
      ...defaultTokens,
      colour: { ...defaultTokens.colour, border: '#8a8a8a', background: '#ffffff' },
    };
    expect(checkContrast(tokens).map((f) => f.token)).not.toContain('colour.border');
  });

  it('checks the button, which paints background on top of primary', () => {
    const tokens: TokenSet = {
      ...defaultTokens,
      colour: { ...defaultTokens.colour, primary: '#f0f0f0', background: '#ffffff' },
    };
    expect(checkContrast(tokens).map((f) => f.token)).toContain('colour.background on primary');
  });
});

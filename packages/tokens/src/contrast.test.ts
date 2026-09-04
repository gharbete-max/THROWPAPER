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
   * The shipped default now passes every pair, boundary included. It did not always.
   *
   * This test used to record a deliberate exception: the border was a pale grey at 1.36 against
   * white, and reaching 3:1 on white needs roughly #8b919b — a noticeably heavy grey ring around
   * every input, against a stated visual direction of flat and quiet. The exception was the honest
   * call at the time, and the test existed so that it stayed a decision rather than becoming an
   * oversight.
   *
   * It has now done its job twice. When the default moved to the parchment palette the assertion
   * failed, and the question came back with a different answer: the old trade was specifically
   * about *grey on pure white*, and this palette has neither. A warm taupe at 3.11:1 on parchment
   * is not heavy — it reads as the edge of a page. There was no longer anything to trade, so the
   * exception is gone.
   *
   * Findings stay **advisory** for a customer's own palette: shown while they choose, never
   * blocking a save. Refusing to store somebody's brand over a subtle border would be obnoxious;
   * not telling them would be negligent. That is about *their* colours. Ours have no excuse.
   */
  it('passes the shipped default palette on every pair, including the boundary', () => {
    expect(checkContrast(defaultTokens)).toEqual([]);
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

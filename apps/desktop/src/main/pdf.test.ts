import { describe, expect, it } from 'vitest';
import { DEFAULT_MARGIN } from '@tp/tokens/pdf';
import { toInches } from './pdf.js';

describe('the Electron renderer margins', () => {
  it('converts the print margins to the inches printToPDF takes', () => {
    expect(toInches('25.4mm')).toBe(1);
    expect(toInches('2.54cm')).toBeCloseTo(1);
    expect(toInches('0.5in')).toBe(0.5);
  });

  it('understands every default margin, so a token change cannot break it silently', () => {
    for (const value of Object.values(DEFAULT_MARGIN)) {
      expect(toInches(value)).toBeGreaterThan(0);
    }
  });

  it('refuses a unit it does not know rather than guessing', () => {
    expect(() => toInches('12px')).toThrow(/unsupported margin/);
  });
});

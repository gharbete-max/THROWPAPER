import { describe, expect, it } from 'vitest';
import { lnMille } from './ln.js';

/**
 * T2's weights need `round(1000 × ln(N / df))`, and the core may not call `Math.log` in a decision
 * (`CAVEATS.md` #50). The integer series must agree with the true value everywhere it is used: a
 * test may use `Math.log` as the reference, since the purity rules exempt tests.
 */
describe('lnMille', () => {
  it('matches round(1000 × ln(p / q)) for every p ≥ q up to 400', () => {
    const wrong: string[] = [];
    for (let p = 1; p <= 400; p += 1) {
      for (let q = 1; q <= p; q += 1) {
        const expected = Math.round(1000 * Math.log(p / q));
        if (lnMille(p, q) !== expected) wrong.push(`${p}/${q}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is exact at the fixed points and negative below 1', () => {
    expect(lnMille(1, 1)).toBe(0);
    expect(lnMille(2, 1)).toBe(693);
    expect(lnMille(10, 1)).toBe(2303);
    expect(lnMille(1, 2)).toBe(-693);
  });

  it('refuses what is not a positive integer', () => {
    expect(() => lnMille(0, 1)).toThrow(RangeError);
    expect(() => lnMille(1.5, 1)).toThrow(RangeError);
  });
});

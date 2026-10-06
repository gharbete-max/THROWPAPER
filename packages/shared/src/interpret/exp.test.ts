import { describe, expect, it } from 'vitest';
import { EXP_ZERO_FROM, expMicro } from './exp.js';

/**
 * The belief engine's exponential (`docs/plan/BELIEF.md`, `CAVEATS.md` #50): integers, the same on
 * every machine. A test may use `Math.exp` as the reference; the core may not.
 */
describe('expMicro', () => {
  it('is round(10⁶ × e^(−d/1000)) wherever it is not 0', () => {
    const wrong: number[] = [];
    for (let d = 0; d < EXP_ZERO_FROM; d += 7) {
      const exact = 1e6 * Math.exp(-d / 1000);
      // Math.exp may be off in its last bit; only a value on a rounding boundary could differ.
      if (Math.abs(expMicro(d) - exact) > 0.5 + 1e-6) wrong.push(d);
    }
    expect(wrong).toEqual([]);
  });

  it('is exact at the fixed points, and 0 from where it rounds to 0', () => {
    expect(expMicro(0)).toBe(1_000_000);
    expect(expMicro(693)).toBe(500_074);
    expect(expMicro(1000)).toBe(367_879);
    expect(expMicro(EXP_ZERO_FROM - 1)).toBe(0);
    expect(expMicro(EXP_ZERO_FROM)).toBe(0);
    expect(expMicro(1_000_000)).toBe(0);
  });

  it('falls as d grows', () => {
    for (let d = 1; d < 6000; d += 1) expect(expMicro(d)).toBeLessThanOrEqual(expMicro(d - 1));
  });

  it('refuses what is not a whole number of millinats ≥ 0', () => {
    expect(() => expMicro(-1)).toThrow(RangeError);
    expect(() => expMicro(0.5)).toThrow(RangeError);
  });
});

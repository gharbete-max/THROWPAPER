import { describe, expect, it } from 'vitest';
import table from './sigmoid.json';
import { sigmoidMille } from './sigmoid.js';
import { SIGMOID_FROM, SIGMOID_STEP, SIGMOID_TO, sigmoidTableValues } from './sigmoid-table.js';

describe('the committed sigmoid (ADR 0019)', () => {
  it('is exactly what the integer series makes, so the file cannot drift from its definition', () => {
    // A failure here means the file was edited by hand, or the series changed: regenerate with
    // `pnpm exec tsx scripts/sigmoid-table.ts` and review the diff.
    expect(table.values).toEqual(sigmoidTableValues());
    expect([table.from, table.to, table.step]).toEqual([SIGMOID_FROM, SIGMOID_TO, SIGMOID_STEP]);
  });

  it('is the true sigmoid, rounded — checked against Math.exp, which a test may use', () => {
    table.values.forEach((value, i) => {
      const x = SIGMOID_FROM + i * SIGMOID_STEP;
      expect(Math.abs(value - 1000 / (1 + Math.exp(-x / 1000))), `x = ${x}`).toBeLessThanOrEqual(
        0.5,
      );
    });
  });

  it('is symmetric and never decreases', () => {
    const values = table.values;
    values.forEach((value, i) => expect(value + values[values.length - 1 - i]!).toBe(1000));
    values.slice(1).forEach((value, i) => expect(value).toBeGreaterThanOrEqual(values[i]!));
    expect(sigmoidMille(0)).toBe(500);
  });

  it('reads the nearest step, halves up, and clamps beyond the table', () => {
    expect(sigmoidMille(24)).toBe(sigmoidMille(0));
    expect(sigmoidMille(25)).toBe(sigmoidMille(50));
    expect(sigmoidMille(-25)).toBe(sigmoidMille(0));
    expect(sigmoidMille(-26)).toBe(sigmoidMille(-50));
    expect(sigmoidMille(1000)).toBe(731);
    expect(sigmoidMille(2000)).toBe(881);
    expect(sigmoidMille(1_000_000)).toBe(1000);
    expect(sigmoidMille(-1_000_000)).toBe(0);
    expect(() => sigmoidMille(0.5)).toThrow(TypeError);
  });
});

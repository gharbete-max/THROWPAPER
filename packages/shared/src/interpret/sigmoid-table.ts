/**
 * How `sigmoid.json` is made: `round(1000 / (1 + e^(−x / 1000)))` for x from −8000 to +8000
 * millinats in steps of 50 (ADR 0019), computed with integers only.
 *
 * `Math.exp` is not required to be correctly rounded, so two engines may disagree in the last bit
 * — which is exactly why the table is committed rather than computed where it is used. Making it
 * with a series in 40-digit fixed point, like `ln.ts`, means the committed values do not depend on
 * whichever engine happened to write them either. Nothing at runtime imports this module: the
 * script `scripts/sigmoid-table.ts` writes the file, and `sigmoid.test.ts` checks that the file is
 * what this produces.
 */

export const SIGMOID_FROM = -8000;
export const SIGMOID_TO = 8000;
export const SIGMOID_STEP = 50;

const SCALE = 10n ** 40n;

/** e^(n / 1000) × SCALE for 0 ≤ n ≤ 8000, by its Taylor series. */
function expMille(n: number): bigint {
  const x = BigInt(n);
  let sum = SCALE;
  let term = SCALE;
  for (let k = 1n; term !== 0n; k += 1n) {
    term = (term * x) / (1000n * k);
    sum += term;
  }
  return sum;
}

/** round(num / den) for positive integers, halves up. */
const rounded = (num: bigint, den: bigint) => (2n * num + den) / (2n * den);

/** 1000 × σ(x / 1000), rounded, for an integer x in millinats. */
export function sigmoidMilleExact(x: number): number {
  const e = expMille(Math.abs(x));
  // σ(x) = e^x / (e^x + 1) for x ≥ 0, and 1 / (1 + e^|x|) below it.
  const num = x >= 0 ? 1000n * e : 1000n * SCALE;
  return Number(rounded(num, e + SCALE));
}

/** The table's values, in order from SIGMOID_FROM to SIGMOID_TO. */
export function sigmoidTableValues(): number[] {
  const values: number[] = [];
  for (let x = SIGMOID_FROM; x <= SIGMOID_TO; x += SIGMOID_STEP) values.push(sigmoidMilleExact(x));
  return values;
}

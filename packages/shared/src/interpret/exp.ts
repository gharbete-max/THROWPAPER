/**
 * `round(10⁶ × e^(−d / 1000))` for a whole number of millinats d ≥ 0, computed with integers only —
 * the belief engine's probabilities in parts per million (`docs/plan/BELIEF.md`, ADR 0019).
 *
 * `Math.exp` is not required to be correctly rounded, so two engines may differ in the last bit,
 * and a probability compared with a threshold could flip. So the exponential is the same 40-digit
 * series the committed sigmoid table was made with (`sigmoid-table.ts`): the same integers on
 * every machine. From 16 000 millinats on the value is below half a part per million, so 0.
 *
 * Results are kept once computed: the function is pure, so a kept value is the value.
 */

const SCALE = 10n ** 40n;
const MILLION = 1_000_000n;

/** Beyond this, e^(−d/1000) × 10⁶ rounds to 0. */
export const EXP_ZERO_FROM = 16_000;

/** e^(n / 1000) × SCALE for 0 ≤ n, by its Taylor series. */
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

const kept = new Map<number, number>();

/** `round(10⁶ × e^(−d / 1000))`, halves up, for a whole number d ≥ 0. */
export function expMicro(d: number): number {
  if (!Number.isSafeInteger(d) || d < 0) {
    throw new RangeError(`expMicro needs a whole number of millinats ≥ 0, not ${d}`);
  }
  if (d >= EXP_ZERO_FROM) return 0;
  const known = kept.get(d);
  if (known !== undefined) return known;
  const e = expMille(d);
  // round(10⁶ × SCALE / e), halves up: (2a + b) / 2b.
  const value = Number((2n * MILLION * SCALE + e) / (2n * e));
  kept.set(d, value);
  return value;
}

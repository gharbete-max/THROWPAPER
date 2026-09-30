/**
 * `round(1000 × ln(p / q))` for positive integers, computed with integers only.
 *
 * T2 weighs a keyword by its inverse frequency, `round(1000 × ln(N / df))` (`INTENT-LADDER.md`).
 * `Math.log` is not required to be correctly rounded, and two engines — the author's browser and
 * the desktop's — may differ in the last bit, which is enough to move a weight by one and a score
 * across a threshold. So the logarithm is a series in 40-digit fixed point, whose error is far below
 * anything that could change the rounding: the same integers on every machine, with nothing to
 * generate at build time and keep fresh.
 *
 * ln n = k·ln 2 + 2·atanh(z), with 2^k ≤ n < 2^(k+1) and z = (n − 2^k) / (n + 2^k) ≤ 1/3.
 */

const SCALE = 10n ** 40n;

/** atanh(num / den) × SCALE, for 0 ≤ num / den ≤ 1/3. */
function atanh(num: bigint, den: bigint): bigint {
  let sum = 0n;
  let power = (num * SCALE) / den;
  const square = [num * num, den * den] as const;
  for (let k = 1n; power !== 0n; k += 2n) {
    sum += power / k;
    power = (power * square[0]) / square[1];
  }
  return sum;
}

const LN2 = 2n * atanh(1n, 3n);

/** ln n × SCALE. */
function ln(n: bigint): bigint {
  let k = 0n;
  let power = 1n;
  while (power * 2n <= n) {
    power *= 2n;
    k += 1n;
  }
  return k * LN2 + 2n * atanh(n - power, n + power);
}

/** `round(1000 × ln(p / q))`, half away from zero. */
export function lnMille(p: number, q: number): number {
  if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q) || p < 1 || q < 1) {
    throw new RangeError(`lnMille needs positive integers, not ${p} and ${q}`);
  }
  const scaled = 1000n * (ln(BigInt(p)) - ln(BigInt(q)));
  const half = SCALE / 2n;
  const rounded = scaled >= 0n ? (scaled + half) / SCALE : -((-scaled + half) / SCALE);
  return Number(rounded);
}

/**
 * T3's word similarity — `docs/plan/INTENT-LADDER.md`, "T3 — fuzzy". Two words match when
 * **trigram Dice ≥ 0.62 and Jaro-Winkler ≥ 0.80**, or when both are at least six characters long
 * and their **Levenshtein distance is at most 2**.
 *
 * Every ratio is an exact fraction compared by cross-multiplication: `dice ≥ 0.62` is
 * `2·|A∩B|·100 ≥ 62·(|A| + |B|)`. No division, no floating point, so a word pair sits on the same
 * side of every threshold on every machine. Words are compared as code points, in their folded
 * form (the caller's choice), and are short — the products stay far inside safe integers.
 */

/** The distinct trigrams of `#word#`. */
function trigrams(word: readonly string[]): Set<string> {
  const padded = ['#', ...word, '#'];
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3).join(''));
  return set;
}

/** Dice ≥ 62/100 over trigram sets. */
export function diceAtLeast62(a: readonly string[], b: readonly string[]): boolean {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const gram of ta) if (tb.has(gram)) shared += 1;
  return 2 * shared * 100 >= 62 * (ta.size + tb.size);
}

/**
 * Jaro-Winkler ≥ 8/10, with the usual match window `max(|a|, |b|) / 2 − 1`, prefix scale 1/10 and
 * a prefix of at most four.
 *
 * With `m` matches, `T` matched characters out of order (so `t = T/2` transpositions), `A = |a|`,
 * `B = |b|`: Jaro is `Jn / Jd` with `Jn = 2m²B + 2m²A + (2m − T)·A·B` and `Jd = 6·A·B·m`, and
 * Jaro-Winkler is `(10·Jn + l·(Jd − Jn)) / (10·Jd)`.
 */
export function jaroWinklerAtLeast80(a: readonly string[], b: readonly string[]): boolean {
  const A = a.length;
  const B = b.length;
  if (A === 0 || B === 0) return false;
  const window = Math.max(0, Math.floor(Math.max(A, B) / 2) - 1);
  const usedB = new Array<boolean>(B).fill(false);
  const matchedA: string[] = [];
  for (let i = 0; i < A; i += 1) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(B - 1, i + window);
    for (let j = lo; j <= hi; j += 1) {
      if (!usedB[j] && a[i] === b[j]) {
        usedB[j] = true;
        matchedA.push(a[i]!);
        break;
      }
    }
  }
  const m = matchedA.length;
  if (m === 0) return false;
  const matchedB = b.filter((_, j) => usedB[j]);
  let T = 0;
  for (let k = 0; k < m; k += 1) if (matchedA[k] !== matchedB[k]) T += 1;
  let l = 0;
  while (l < 4 && l < A && l < B && a[l] === b[l]) l += 1;
  const Jn = 2 * m * m * B + 2 * m * m * A + (2 * m - T) * A * B;
  const Jd = 6 * A * B * m;
  return 10 * Jn + l * (Jd - Jn) >= 8 * Jd;
}

/** Levenshtein distance ≤ 2, stopping as soon as it cannot be. */
export function levenshteinAtMost2(a: readonly string[], b: readonly string[]): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > 2) return false;
    previous = current;
  }
  return previous[b.length]! <= 2;
}

/** The T3 rule for one pair of words (already folded, never equal — equality is not fuzzy). */
export function fuzzyMatch(a: string, b: string): boolean {
  const ca = [...a];
  const cb = [...b];
  if (diceAtLeast62(ca, cb) && jaroWinklerAtLeast80(ca, cb)) return true;
  return ca.length >= 6 && cb.length >= 6 && levenshteinAtMost2(ca, cb);
}

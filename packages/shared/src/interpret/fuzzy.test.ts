import { describe, expect, it } from 'vitest';
import { diceAtLeast62, fuzzyMatch, jaroWinklerAtLeast80, levenshteinAtMost2 } from './fuzzy.js';

/**
 * T3's similarity, compared as exact fractions. Each test holds the integer comparison to the
 * textbook floating-point definition (tests may use floats: they decide nothing) over every pair
 * of a small vocabulary, so a slip in the cross-multiplication shows up as a disagreement.
 */

const chars = (s: string) => [...s];

function dice(a: string, b: string): number {
  const grams = (w: string) => {
    const p = ['#', ...w, '#'];
    return new Set(p.slice(0, -2).map((_, i) => p.slice(i, i + 3).join('')));
  };
  const ta = grams(a);
  const tb = grams(b);
  const shared = [...ta].filter((g) => tb.has(g)).length;
  return (2 * shared) / (ta.size + tb.size);
}

function jaroWinkler(a: string, b: string): number {
  const s = chars(a);
  const t = chars(b);
  const window = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const used = new Array<boolean>(t.length).fill(false);
  const ms: string[] = [];
  s.forEach((c, i) => {
    for (let j = Math.max(0, i - window); j <= Math.min(t.length - 1, i + window); j += 1) {
      if (!used[j] && t[j] === c) {
        used[j] = true;
        ms.push(c);
        break;
      }
    }
  });
  const m = ms.length;
  if (m === 0) return 0;
  const mt = t.filter((_, j) => used[j]);
  const half = ms.filter((c, k) => c !== mt[k]).length / 2;
  const jaro = (m / s.length + m / t.length + (m - half) / m) / 3;
  let l = 0;
  while (l < 4 && s[l] !== undefined && s[l] === t[l]) l += 1;
  return jaro + l * 0.1 * (1 - jaro);
}

function levenshtein(a: string, b: string): number {
  const s = chars(a);
  const t = chars(b);
  let row = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= t.length; j += 1) {
      next.push(
        Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (s[i - 1] === t[j - 1] ? 0 : 1)),
      );
    }
    row = next;
  }
  return row[t.length]!;
}

const WORDS = [
  'buttons',
  'buttoms',
  'button',
  'pill',
  'pile',
  'tile',
  'rounded',
  'rounde',
  'square',
  'squre',
  'mandatory',
  'mandatroy',
  'optional',
  'optinal',
  'watermark',
  'watremark',
  'knappar',
  'knapar',
  'frivillig',
  'frivilig',
  'lodratt',
  'lagratt',
  'vagratt',
  'кнопки',
  'кнопкы',
  'light',
  'slight',
  'bright',
  'a',
  'ab',
  'abc',
  'abcdef',
  'axcdxf',
];

describe('fuzzy similarity, as exact fractions', () => {
  const pairs = WORDS.flatMap((a) => WORDS.map((b) => [a, b] as const));

  it('agrees with Dice ≥ 0.62 on every pair', () => {
    const disagree = pairs.filter(
      ([a, b]) => diceAtLeast62(chars(a), chars(b)) !== dice(a, b) >= 0.62,
    );
    expect(disagree).toEqual([]);
  });

  it('agrees with Jaro-Winkler ≥ 0.80 on every pair', () => {
    const disagree = pairs.filter(
      ([a, b]) => jaroWinklerAtLeast80(chars(a), chars(b)) !== jaroWinkler(a, b) >= 0.8 - 1e-12,
    );
    expect(disagree).toEqual([]);
  });

  it('agrees with Levenshtein ≤ 2 on every pair', () => {
    const disagree = pairs.filter(
      ([a, b]) => levenshteinAtMost2(chars(a), chars(b)) !== levenshtein(a, b) <= 2,
    );
    expect(disagree).toEqual([]);
  });

  it('decides the rule as the plan’s examples say', () => {
    expect(fuzzyMatch('buttoms', 'buttons')).toBe(true); // Levenshtein 1, both ≥ 6
    expect(fuzzyMatch('squre', 'square')).toBe(false); // five letters: Dice decides, and says no
    expect(fuzzyMatch('pile', 'pill')).toBe(false);
    expect(fuzzyMatch('pile', 'tile')).toBe(false);
    expect(fuzzyMatch('slight', 'light')).toBe(true);
    expect(fuzzyMatch('slight', 'bright')).toBe(true);
    expect(fuzzyMatch('abcdef', 'axcdxf')).toBe(true); // no trigram in common, two edits
  });
});

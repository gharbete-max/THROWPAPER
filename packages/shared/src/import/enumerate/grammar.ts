import type { Family, Style } from './types.js';

/**
 * The marker grammar — `docs/plan/NUMBERING-RULES.md` §4.
 *
 * It looks at a line's first word (first two for the spaced styles) and nothing else (P1): a
 * token that would match anywhere later in the line is never tested and stays in the label.
 */

export type Production = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9';

/** One way to read a marker. A lone i, v or x has two (R10); every other marker has one. */
export interface Reading {
  readonly family: Family;
  readonly style: Style;
  readonly path: readonly number[];
}

export interface MarkerMatch {
  readonly production: Production;
  /** Verbatim: the first word, or the first two joined by one space. */
  readonly raw: string;
  readonly wordCount: 1 | 2;
  /** Roman first, then alpha, where there are two (R10's order for "a reading"). */
  readonly readings: readonly Reading[];
  /** R10's "preferred reading": roman for i and I, alpha for v, x, V and X. */
  readonly preferred: Reading;
}

/** ROMAN_MAX (§2): i–xxxix, so the only single-letter romans are i, v and x. */
export const ROMAN_MAX = 39;

/**
 * §4 `probe`: the form a word is matched in, never stored or output. NFKC first (full-width
 * digits and punctuation become ASCII), then quotes, dashes and fixed-width spaces are folded.
 * NFKC has already turned U+2033 into two U+2032, so it arrives as `''`; it is listed anyway, as
 * the rules list it.
 */
export function probe(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ');
}

const ONES = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix'];
const TENS = ['', 'x', 'xx', 'xxx'];

/** Every canonical (subtractive) lower-case roman numeral 1–39, to its value. */
const ROMAN = new Map(
  Array.from({ length: ROMAN_MAX }, (_, i) => {
    const n = i + 1;
    return [`${TENS[(n - (n % 10)) / 10] ?? ''}${ONES[n % 10] ?? ''}`, n] as const;
  }),
);

/** The value of a canonical roman numeral 1–39 (either case), or null: `iiii` is not one. */
export function romanValue(letters: string): number | null {
  return ROMAN.get(letters.toLowerCase()) ?? null;
}

const BULLETS = new Set(['•', '◦', '▪', '‣', '∙', '·', '*', '-']);

const DIGITS = /^\d{1,3}$/;
const DOTTED = /^\d{1,3}(?:\.\d{1,2}){1,3}\.?$/;
const NUMBERED: readonly (readonly [Production, RegExp, Style])[] = [
  ['M1', /^(\d{1,3})\.$/, 'dot'],
  ['M2', /^(\d{1,3})\)$/, 'paren'],
  ['M3', /^(\d{1,3}):$/, 'colon'],
];
const ENCLOSED = /^\((\d{1,3}|[a-z]|[A-Z]|[ivx]{2,7}|[IVX]{2,7})\)$/;
const ROMAN_MARKER = /^([ivx]{2,7}|[IVX]{2,7})([.)])$/;
const LETTER = /^([a-zA-Z])([.)])$/;

const isLower = (letters: string) => letters === letters.toLowerCase();

function romanReading(letters: string, style: Style): Reading | null {
  const value = romanValue(letters);
  if (value === null) return null;
  return { family: isLower(letters) ? 'roman-lower' : 'roman-upper', style, path: [value] };
}

/** A single letter: its alpha reading, and for i, v and x its roman reading first. */
function letterReadings(letter: string, style: Style): Pick<MarkerMatch, 'readings' | 'preferred'> {
  const lower = letter.toLowerCase();
  const alpha: Reading = {
    family: isLower(letter) ? 'alpha-lower' : 'alpha-upper',
    style,
    path: [lower.charCodeAt(0) - 96],
  };
  const roman = romanReading(letter, style);
  if (!roman) return { readings: [alpha], preferred: alpha };
  return { readings: [roman, alpha], preferred: lower === 'i' ? roman : alpha };
}

/** The first production that matches the line's first word(s), or null (§4, in its order). */
export function grammar(words: readonly { readonly text: string }[]): MarkerMatch | null {
  const [first, second] = words;
  if (!first) return null;
  const w1 = probe(first.text);
  const w2 = second ? probe(second.text) : null;

  const one = (production: Production, reading: Reading): MarkerMatch => ({
    production,
    raw: first.text,
    wordCount: 1,
    readings: [reading],
    preferred: reading,
  });
  const letters = (production: Production, letter: string, style: Style): MarkerMatch => ({
    production,
    raw: first.text,
    wordCount: 1,
    ...letterReadings(letter, style),
  });
  const arabic = (style: Style, path: number[]): Reading => ({ family: 'arabic', style, path });

  // M9 — a bullet glyph.
  if (BULLETS.has(w1)) return one('M9', { family: 'bullet', style: 'glyph', path: [] });

  // M8 — "1 ." or "1 -": a number, then a lone dot or dash as its own word.
  if (second && DIGITS.test(w1) && (w2 === '.' || w2 === '-')) {
    const reading = arabic(w2 === '.' ? 'spaced-dot' : 'spaced-dash', [Number(w1)]);
    return {
      production: 'M8',
      raw: `${first.text} ${second.text}`,
      wordCount: 2,
      readings: [reading],
      preferred: reading,
    };
  }

  // M4 — a dotted path, "12.1" or "3.2.1.".
  if (DOTTED.test(w1))
    return one('M4', arabic('dot', w1.replace(/\.$/, '').split('.').map(Number)));

  // M1, M2, M3 — "1." "1)" "1:".
  for (const [production, pattern, style] of NUMBERED) {
    const m = pattern.exec(w1);
    if (m) return one(production, arabic(style, [Number(m[1])]));
  }

  // M5 — enclosed: "(1)", "(a)", "(iv)".
  const enclosed = ENCLOSED.exec(w1)?.[1];
  if (enclosed !== undefined) {
    if (DIGITS.test(enclosed)) return one('M5', arabic('enclosed', [Number(enclosed)]));
    if (enclosed.length === 1) return letters('M5', enclosed, 'enclosed');
    const roman = romanReading(enclosed, 'enclosed');
    return roman ? one('M5', roman) : null;
  }

  // M7 — a roman numeral of two or more letters: "ii." "IV)".
  const numeral = ROMAN_MARKER.exec(w1);
  if (numeral) {
    const roman = romanReading(numeral[1] ?? '', numeral[2] === '.' ? 'dot' : 'paren');
    return roman ? one('M7', roman) : null;
  }

  // M6 — a single letter: "a)" "B." (and i, v, x with their roman reading).
  const letter = LETTER.exec(w1);
  if (letter) return letters('M6', letter[1] ?? '', letter[2] === '.' ? 'dot' : 'paren');

  return null;
}

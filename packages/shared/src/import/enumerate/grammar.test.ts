import { describe, expect, it } from 'vitest';
import { grammar, probe, romanValue, ROMAN_MAX, type MarkerMatch } from './grammar.js';

/**
 * The productions of `NUMBERING-RULES.md` §4, one table row per first word: what each matches,
 * and the near misses that must not match. The fixtures prove the rules on whole documents; this
 * proves the grammar on the words it will meet, including the ones no fixture happens to contain.
 */

const words = (line: string) => line.split(' ').map((text) => ({ text }));
const read = (line: string) => {
  const match = grammar(words(line));
  return match && summary(match);
};
const summary = (m: MarkerMatch) => ({
  production: m.production,
  raw: m.raw,
  wordCount: m.wordCount,
  readings: m.readings.map((r) => `${r.family} ${r.style} [${r.path.join(',')}]`),
  preferred: `${m.preferred.family} [${m.preferred.path.join(',')}]`,
});

describe('the productions, in their order', () => {
  it.each([
    ['• Namn', 'M9', 'bullet glyph []'],
    ['- Namn', 'M9', 'bullet glyph []'],
    ['– Namn', 'M9', 'bullet glyph []'], // an en dash is folded to "-"
    ['* Namn', 'M9', 'bullet glyph []'],
    ['1 . Namn', 'M8', 'arabic spaced-dot [1]'],
    ['12 - Namn', 'M8', 'arabic spaced-dash [12]'],
    ['12.1 Namn', 'M4', 'arabic dot [12,1]'],
    ['3.2.1. Namn', 'M4', 'arabic dot [3,2,1]'],
    ['1.2.3.4 Namn', 'M4', 'arabic dot [1,2,3,4]'],
    ['1. Namn', 'M1', 'arabic dot [1]'],
    ['199. Namn', 'M1', 'arabic dot [199]'],
    ['1) Namn', 'M2', 'arabic paren [1]'],
    ['３） Namn', 'M2', 'arabic paren [3]'], // full width, folded by NFKC
    ['1: Namn', 'M3', 'arabic colon [1]'],
    ['(1) Namn', 'M5', 'arabic enclosed [1]'],
    ['(c) Namn', 'M5', 'alpha-lower enclosed [3]'],
    ['(iv) Namn', 'M5', 'roman-lower enclosed [4]'],
    ['ii. Namn', 'M7', 'roman-lower dot [2]'],
    ['XIV) Namn', 'M7', 'roman-upper paren [14]'],
    ['xxxviii. Namn', 'M7', 'roman-lower dot [38]'], // seven letters: the longest numeral 1–39
    ['c) Namn', 'M6', 'alpha-lower paren [3]'],
    ['B. Namn', 'M6', 'alpha-upper dot [2]'],
  ])('%s is %s, %s', (line, production, reading) => {
    const match = read(line);
    expect(match?.production).toBe(production);
    expect(match?.readings).toEqual([reading]);
  });

  it('reads the marker verbatim, two words for the spaced styles', () => {
    expect(read('３） Namn')?.raw).toBe('３）');
    expect(read('1 . Namn')).toMatchObject({ raw: '1 .', wordCount: 2 });
    expect(read('1. Namn')).toMatchObject({ raw: '1.', wordCount: 1 });
  });

  it.each([
    ['1.Namn', 'glued: the whole first word must be the marker'],
    ['1000. Namn', 'four digits'],
    ['12.100 Namn', 'a sub-component of three digits'],
    ['1.2.3.4.5 Namn', 'five components'],
    ['§ 4.2', 'the first word is §'],
    ['no. 12.1', 'the first word is no.'],
    ['version 2.0', 'the first word is version'],
    ['1st place', 'an ordinal'],
    ['3:e plats', 'a Swedish ordinal'],
    ['(the form)', 'the first word is (the'],
    ['(3 500 kr)', 'the first word is (3'],
    ['“1.” citat', 'a quoted number is not a production'],
    ['iiii. Namn', 'not canonical'],
    ['xl. Namn', 'forty is out of range, and l is not a roman letter here'],
    ['(xxxx) Namn', 'not canonical'],
    ['Ab. Namn', 'two letters that are not a numeral'],
    ['1 Namn', 'a bare number'],
    ['1 , Namn', 'M8 takes only a lone dot or dash'],
  ])('%s does not match (%s)', (line) => {
    expect(read(line)).toBeNull();
  });

  it('matches a marker that is the whole line: whether it has a label is P4, not the grammar', () => {
    expect(read('1.')?.production).toBe('M1');
    expect(read('1 .')).toMatchObject({ production: 'M8', wordCount: 2 });
  });

  it('matches nothing on an empty line', () => {
    expect(grammar([])).toBeNull();
  });
});

describe('R10 — a lone i, v or x has two readings', () => {
  it.each([
    ['i. Namn', ['roman-lower dot [1]', 'alpha-lower dot [9]'], 'roman-lower [1]'],
    ['I) Namn', ['roman-upper paren [1]', 'alpha-upper paren [9]'], 'roman-upper [1]'],
    ['v. Namn', ['roman-lower dot [5]', 'alpha-lower dot [22]'], 'alpha-lower [22]'],
    ['X. Namn', ['roman-upper dot [10]', 'alpha-upper dot [24]'], 'alpha-upper [24]'],
    ['(x) Namn', ['roman-lower enclosed [10]', 'alpha-lower enclosed [24]'], 'alpha-lower [24]'],
  ])('%s', (line, readings, preferred) => {
    expect(read(line)).toMatchObject({ readings, preferred });
  });

  it('gives every other letter its alpha reading only', () => {
    expect(read('a) Namn')).toMatchObject({ readings: ['alpha-lower paren [1]'] });
  });
});

describe('roman numerals', () => {
  it('are exactly the canonical forms 1–39', () => {
    const values = ['i', 'iv', 'ix', 'xiv', 'xix', 'xxiv', 'xxxviii', 'xxxix'].map(romanValue);
    expect(values).toEqual([1, 4, 9, 14, 19, 24, 38, 39]);
    expect(romanValue('XXXIX')).toBe(ROMAN_MAX);
    for (const bad of ['iiii', 'vv', 'ic', 'xl', 'xxxx', 'iix', 'vx', '']) {
      expect(romanValue(bad), bad).toBeNull();
    }
  });
});

describe('probe', () => {
  it('folds full width, quotes, dashes and fixed spaces, and nothing else', () => {
    expect(probe('３）')).toBe('3)');
    expect(probe('‘x’ “y” ‚z‛ ′')).toBe(`'x' "y" 'z' '`);
    expect(probe('a‐b–c—d−e')).toBe('a-b-c-d-e');
    expect(probe('1\u00A02\u20073\u202F4')).toBe('1 2 3 4');
    expect(probe('Åsa år')).toBe('Åsa år');
  });
});

import { describe, expect, it } from 'vitest';
import {
  blocks,
  checkAddresses,
  editDistance,
  suggestDomain,
  tokensOf,
} from './address-hygiene.js';

describe('suggestDomain', () => {
  it.each([
    ['gmial.com', 'gmail.com'],
    ['gmal.com', 'gmail.com'],
    ['gnail.com', 'gmail.com'],
    ['gmail.con', 'gmail.com'],
    ['hotnail.com', 'hotmail.com'],
    ['hotmial.com', 'hotmail.com'],
    ['outlok.com', 'outlook.com'],
    ['yahho.com', 'yahoo.com'],
    ['iclould.com', 'icloud.com'],
    ['icloud.co', 'icloud.com'],
    ['GMIAL.COM', 'gmail.com'],
  ])('%s -> %s', (domain, expected) => {
    expect(suggestDomain(domain)).toBe(expected);
  });

  it('suggests nothing for a right domain, an unrelated one or a very short one', () => {
    expect(suggestDomain('gmail.com')).toBeNull();
    expect(suggestDomain('example.org')).toBeNull();
    expect(suggestDomain('ex.com')).toBeNull();
    expect(suggestDomain('hotmail.fr')).toBeNull();
  });
});

describe('editDistance', () => {
  it('counts a swap of neighbours as one', () => {
    expect(editDistance('gmial', 'gmail')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('checkAddresses', () => {
  it('names each kind, by position', () => {
    const issues = checkAddresses([
      'asa@example.com',
      'not an address',
      'ASA@example.com',
      'bo@gmial.com',
      'info@example.com',
      'noreply+x@example.com',
      '',
    ]);
    expect(issues).toEqual([
      { kind: 'syntax', index: 1 },
      { kind: 'duplicate', index: 2, of: 0 },
      { kind: 'typo', index: 3, suggestion: 'bo@gmail.com' },
      { kind: 'role', index: 4 },
      { kind: 'role', index: 5 },
      { kind: 'syntax', index: 6 },
    ]);
  });

  it('is case-insensitive about duplicates and keeps the first as the original', () => {
    const issues = checkAddresses(['A@x.se', 'a@X.se', 'a@x.se']);
    expect(issues).toEqual([
      { kind: 'duplicate', index: 1, of: 0 },
      { kind: 'duplicate', index: 2, of: 0 },
    ]);
  });

  it('can leave duplicates alone, and ignores skipped rows', () => {
    expect(checkAddresses(['a@x.se', 'a@x.se'], { duplicates: false })).toEqual([]);
    expect(checkAddresses(['a@x.se', null, 'a@x.se'])).toEqual([
      { kind: 'duplicate', index: 2, of: 0 },
    ]);
    expect(checkAddresses([null, 'a@x.se'])).toEqual([]);
  });

  it('only a bad address blocks', () => {
    const issues = checkAddresses(['x', 'info@gmial.com', 'info@gmial.com']);
    expect(issues.filter(blocks)).toEqual([{ kind: 'syntax', index: 0 }]);
  });
});

describe('tokensOf', () => {
  it('splits on lines, commas, semicolons and spaces, keeping repeats', () => {
    expect(tokensOf('a@x.se, b@x.se;\nA@x.se  ')).toEqual(['a@x.se', 'b@x.se', 'A@x.se']);
    expect(tokensOf('')).toEqual([]);
  });
});

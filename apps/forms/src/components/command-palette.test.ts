import { describe, expect, it } from 'vitest';
import { matches } from './CommandPalette.js';

/**
 * Subsequence, not substring.
 *
 * "fr" should find "Forms" and "rsp" should find "Responses". A substring match finds neither, and
 * an operator who tries a shorthand once and gets nothing does not try again.
 */
describe('palette filtering', () => {
  it('matches a shorthand made of letters in order', () => {
    expect(matches('fr', 'Forms')).toBe(true);
    expect(matches('rsp', 'Responses')).toBe(true);
    expect(matches('brand', 'Brand')).toBe(true);
  });

  it('refuses letters that are out of order', () => {
    // Otherwise every query matches everything containing the same letters, and the ranking is a
    // lie: "smrof" is not a way anybody spells Forms.
    expect(matches('sf', 'Forms')).toBe(false);
  });

  it('shows everything for an empty query', () => {
    expect(matches('', 'Forms')).toBe(true);
    expect(matches('   ', 'Forms')).toBe(false);
  });

  it('ignores case', () => {
    expect(matches('FORMS', 'forms')).toBe(true);
  });

  /**
   * The interface is in twelve languages, so the labels being searched are Swedish, Russian and
   * Japanese as often as English. Typing "sprak" has to find "Språk", or the palette works in the
   * English build only.
   */
  it('ignores diacritics, because the labels are not English', () => {
    expect(matches('sprak', 'Språk')).toBe(true);
    expect(matches('handelser', 'Händelser')).toBe(true);
    expect(matches('evenement', 'Évènement')).toBe(true);
  });

  it('does not fold away a non-Latin script', () => {
    // Folding must normalise accents without flattening Cyrillic or kana into nothing.
    expect(matches('отв', 'Ответы')).toBe(true);
    expect(matches('xyz', 'Ответы')).toBe(false);
  });
});

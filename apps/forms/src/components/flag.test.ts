import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { FLAG_LOCALES } from './Flag.js';

/**
 * Every language the product offers has a flag beside it in the picker.
 *
 * The component used to hedge instead: it looked the locale up, then tried again on the region
 * code, then fell back to a grey rectangle. The second lookup could never match — every key in the
 * table is a full locale like `sv-SE`, and it was being asked for `SE` — so the real behaviour was
 * "a flag, or a grey box", and the grey box was one forgotten entry away at any time.
 *
 * Comparing the two lists is both cheaper and stronger than the fallback was. A thirteenth
 * language fails here rather than shipping a blank square in a dropdown.
 */
describe('the flag table', () => {
  it('covers every locale in the registry', () => {
    const missing = LOCALE_CODES.filter((code) => !FLAG_LOCALES.includes(code));
    expect(missing, `no flag for: ${missing.join(', ')}`).toEqual([]);
  });

  it('draws nothing the registry does not offer', () => {
    // The other direction. A flag for a language nobody can choose is dead weight, and more often
    // it is a typo in a locale code that would have shown as a missing flag at the other end.
    const extra = FLAG_LOCALES.filter((code) => !LOCALE_CODES.includes(code));
    expect(extra, `flag for unknown locale: ${extra.join(', ')}`).toEqual([]);
  });
});

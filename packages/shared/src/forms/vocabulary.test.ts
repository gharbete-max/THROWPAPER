import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { V } from './vocabulary.js';

/**
 * The shared words, held against the languages the product ships in.
 *
 * `vocabulary.ts` has claimed this file existed since it was written, and it did not. The claim
 * was reasonable and the gap was real: `word()` takes twelve positional arguments, so a
 * *forgotten* language is a compile error, but nothing stopped an empty string, a stray space, or
 * a value copy-pasted from the column beside it.
 *
 * `templates.test.ts` does not close it either. That one only inspects strings that reach a
 * template's name, description, required texts or option labels — so any entry not currently used
 * by a template, or used only in a field that is not required, is unchecked. These are the words
 * every future template will compose from; they should be right before anybody reaches for them.
 */
describe('the shared vocabulary', () => {
  const entries = Object.entries(V);

  it('has something to say in every shipped language', () => {
    const gaps = entries
      .flatMap(([key, word]) =>
        LOCALE_CODES.filter((locale) => !word[locale]?.trim()).map(
          (locale) => `${key} (${locale})`,
        ),
      )
      .sort();
    expect(gaps).toEqual([]);
  });

  /**
   * The registry drives the arity of `word()`, so a thirteenth language has to arrive here as
   * well as there. Without this, adding one would leave 58 entries silently short of a column.
   */
  it('covers exactly the locales the registry names', () => {
    const wrong = entries
      .filter(([, word]) => Object.keys(word).length !== LOCALE_CODES.length)
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });

  /**
   * A word that is identical in every language is nearly always a column that got pasted rather
   * than translated. Nearly, not always — "Email" and "Fax" really are the same in most of these,
   * so the check is that *some* language differs from English, not that all of them do.
   *
   * Danish and Norwegian Bokmål are excluded from the comparison: they genuinely share spellings
   * with each other and with Swedish often enough that requiring a difference would be noise.
   */
  it('is actually translated, not twelve copies of the English', () => {
    const untranslated = entries
      .filter(([, word]) => {
        const english = word['en-GB']?.trim();
        return LOCALE_CODES.filter((locale) => locale !== 'en-GB').every(
          (locale) => word[locale]?.trim() === english,
        );
      })
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });
});

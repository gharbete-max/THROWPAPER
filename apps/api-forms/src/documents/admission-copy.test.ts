import { describe, expect, it } from 'vitest';
import { LOCALE_CODES } from '@tp/i18n';
import { ADMISSION_LOCALES, admissionStrings } from './admission.js';

/**
 * An admission card is a piece of paper somebody carries to a door.
 *
 * The copy table held Swedish and English and fell back to Swedish, so a French attendee who
 * filled in a French form was handed a Swedish card to print and present. Of all the places to get
 * the language wrong this is close to the worst: they cannot re-read it in another one, and
 * neither can the person checking them in.
 *
 * The same defect was in the transactional email copy, and the fix is the same — hold the table
 * against the locale registry so a thirteenth language fails the build rather than silently
 * printing Swedish.
 */
describe('admission card copy', () => {
  it('covers every language the product ships in', () => {
    const missing = LOCALE_CODES.filter((code) => !ADMISSION_LOCALES.includes(code));
    expect(missing, `no admission copy for: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries no language the registry does not offer', () => {
    const extra = ADMISSION_LOCALES.filter((code) => !LOCALE_CODES.includes(code));
    expect(extra, `admission copy for unknown locale: ${extra.join(', ')}`).toEqual([]);
  });

  it.each(LOCALE_CODES)('is actually filled in for %s', (locale) => {
    const strings = admissionStrings(locale);
    const blank = Object.entries(strings)
      .filter(([, value]) => !value.trim())
      .map(([key]) => key);
    expect(blank, `empty on the card: ${blank.join(', ')}`).toEqual([]);
  });

  /**
   * The fallback is English, and it is reached by an unknown locale rather than by a near miss.
   *
   * There used to be a second lookup on the language subtag — `sv` from `sv-SE` — against a table
   * keyed entirely by full locales. It could never match, so it was dead code standing where a
   * reader would reasonably assume a fallback existed.
   */
  it('falls back to English for a locale it does not ship', () => {
    expect(admissionStrings('pt-BR').title).toBe(admissionStrings('en-GB').title);
    expect(admissionStrings('').title).toBe(admissionStrings('en-GB').title);
  });

  it('gives each language its own wording rather than one language twice', () => {
    // A copy-paste that left two locales identical would otherwise pass every check above.
    const titles = LOCALE_CODES.map((locale) => admissionStrings(locale).title);
    // Danish and Norwegian genuinely share "Adgangskort", so a few collisions are expected —
    // what would be wrong is most of them agreeing.
    expect(new Set(titles).size).toBeGreaterThanOrEqual(LOCALE_CODES.length - 2);
  });
});

import { describe, expect, it } from 'vitest';
import type { LocaleConfig } from '@tp/i18n';
import { LOCALE_CODES } from '@tp/i18n';
import { authoringLocale } from './session.js';

/**
 * What the builder writes content in is not what the operator reads the buttons in.
 *
 * The two lists were split so an operator could read the app in any of the twelve regardless of
 * what their organisation publishes. That is right for the interface and wrong for content: the
 * builder seeds a new field's label in the session's locale, and once that could be any of the
 * twelve, a German-reading operator at a Swedish association created fields labelled `de-DE`.
 *
 * Nothing failed loudly. The translation editor lists the organisation's locales, so the box was
 * never shown; the completeness report counts the organisation's locales, so it was never
 * counted; and `pickText` falls through to "any content at all", so a Swedish respondent was
 * shown the German. A label nobody could see, edit, or be warned about.
 */
describe('the language content is authored in', () => {
  const swedish: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

  it('is the interface language when the organisation publishes in it', () => {
    expect(authoringLocale('en-GB', swedish)).toBe('en-GB');
    expect(authoringLocale('sv-SE', swedish)).toBe('sv-SE');
  });

  it('falls back to the organisation default when it does not', () => {
    expect(authoringLocale('de-DE', swedish)).toBe('sv-SE');
    expect(authoringLocale('ja-JP', swedish)).toBe('sv-SE');
  });

  /**
   * The property, over every language the app ships in: whatever an operator sets the interface
   * to, the language they end up writing content in is one the organisation actually publishes.
   * A list rather than a case, so a thirteenth language cannot quietly slip past it.
   */
  it.each([
    [['sv-SE', 'en-GB'], 'sv-SE'],
    [['en-GB'], 'en-GB'],
    [['fi-FI', 'sv-SE'], 'fi-FI'],
    [LOCALE_CODES, 'en-GB'],
  ])('never leaves %s', (supported, fallback) => {
    const organisation: LocaleConfig = { supported, default: fallback };
    for (const chosen of LOCALE_CODES) {
      expect(organisation.supported).toContain(authoringLocale(chosen, organisation));
    }
  });
});

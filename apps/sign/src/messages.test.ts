import { describe, expect, it } from 'vitest';
import { messages, SIGN_LOCALES, translatorFor } from './messages.js';

describe("Sign's strings", () => {
  it('has every message in every language the page offers', () => {
    for (const [key, text] of Object.entries(messages)) {
      for (const locale of SIGN_LOCALES.supported)
        expect(text[locale], `${key} ${locale}`).toBeTruthy();
    }
  });

  it("opens in the party's language, and a Norwegian falls back to Swedish, not English", () => {
    expect(translatorFor(['sv-SE']).lang).toBe('sv-SE');
    expect(translatorFor(['nb-NO']).lang).toBe('sv-SE');
    expect(translatorFor(['ja-JP']).lang).toBe('en-GB');
    expect(translatorFor(['sv-SE']).t('sign.for', { name: 'Åsa' })).toBe('För Åsa');
  });
});

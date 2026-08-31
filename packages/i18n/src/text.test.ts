import { describe, expect, it } from 'vitest';
import { missingLocales, pickText, type LocaleConfig } from './index.js';

const config: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };
const text = { 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' };

describe('pickText', () => {
  it('returns the requested locale when it has content', () => {
    expect(pickText(config, text, 'en-GB')).toEqual({
      value: 'Spring meeting',
      locale: 'en-GB',
      fallback: false,
    });
  });

  it('walks the fallback chain and says it did', () => {
    const partial = { 'sv-SE': 'Vårmötet' };
    const picked = pickText(config, partial, 'en-GB');
    expect(picked.value).toBe('Vårmötet');
    expect(picked.locale).toBe('sv-SE');
    expect(picked.fallback).toBe(true);
  });

  it('treats whitespace as missing', () => {
    expect(pickText(config, { 'sv-SE': '   ', 'en-GB': 'Spring' }, 'sv-SE').value).toBe('Spring');
  });

  it('falls back to any content before giving up', () => {
    expect(pickText(config, { 'de-DE': 'Frühjahrstagung' }, 'en-GB').value).toBe('Frühjahrstagung');
  });

  it('returns empty rather than throwing when there is nothing at all', () => {
    expect(pickText(config, {}, 'sv-SE')).toEqual({ value: '', locale: 'sv-SE', fallback: true });
  });
});

describe('missingLocales', () => {
  it('lists supported locales with no content', () => {
    expect(missingLocales(config, { 'sv-SE': 'Vårmötet' })).toEqual(['en-GB']);
    expect(missingLocales(config, text)).toEqual([]);
  });
});

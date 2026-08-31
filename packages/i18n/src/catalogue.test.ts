import { describe, expect, it } from 'vitest';
import { createTranslator, type Catalogue, type LocaleConfig } from './index.js';

const config: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };
const catalogue: Catalogue = {
  'events.title': { 'sv-SE': 'Evenemang', 'en-GB': 'Events' },
  'events.count': { 'sv-SE': '{n} evenemang', 'en-GB': '{n} events' },
  'only.swedish': { 'sv-SE': 'Bara svenska' },
};

describe('createTranslator', () => {
  it('translates into the requested locale', () => {
    expect(createTranslator(config, catalogue, 'en-GB')('events.title')).toBe('Events');
    expect(createTranslator(config, catalogue, 'sv-SE')('events.title')).toBe('Evenemang');
  });

  it('interpolates variables', () => {
    expect(createTranslator(config, catalogue, 'en-GB')('events.count', { n: 3 })).toBe('3 events');
  });

  it('falls back down the locale chain', () => {
    expect(createTranslator(config, catalogue, 'en-GB')('only.swedish')).toBe('Bara svenska');
  });

  it('shows the key for a missing message rather than an empty string', () => {
    expect(createTranslator(config, catalogue, 'sv-SE')('nope')).toBe('nope');
  });

  it('leaves an unknown placeholder alone', () => {
    expect(createTranslator(config, catalogue, 'en-GB')('events.count', {})).toBe('{n} events');
  });
});

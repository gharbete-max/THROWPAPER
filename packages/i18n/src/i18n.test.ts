import { describe, expect, it } from 'vitest';
import {
  compareText,
  createTranslator,
  completenessFor,
  resolveChain,
  resolveLocale,
  type LocaleConfig,
} from './index.js';

const config: LocaleConfig = { supported: ['sv-SE', 'en-GB'], default: 'sv-SE' };

describe('locale resolution', () => {
  it('prefers the requested locale when supported', () => {
    expect(resolveLocale(config, 'en-GB')).toBe('en-GB');
  });

  it('falls back to a regional variant of the same language', () => {
    expect(resolveChain(config, 'en-US')).toEqual(['en-GB', 'sv-SE']);
  });

  it('falls back to the org default for an unsupported language', () => {
    expect(resolveLocale(config, 'de-DE')).toBe('sv-SE');
  });

  it('never returns an unsupported locale', () => {
    expect(resolveChain(config, 'fr-FR').every((l) => config.supported.includes(l))).toBe(true);
  });
});

describe('completeness', () => {
  it('reports missing required keys and blocks completeness', () => {
    const report = completenessFor('en-GB', ['title', 'help'], { title: 'Register', help: '  ' });
    expect(report.missing).toEqual(['help']);
    expect(report.complete).toBe(false);
  });
});

describe('collation', () => {
  it('sorts å ä ö after z in Swedish', () => {
    expect(['ö', 'z', 'å'].sort((a, b) => compareText('sv-SE', a, b))).toEqual(['z', 'å', 'ö']);
  });

  it('does not sort them after z in English', () => {
    expect(compareText('en-GB', 'å', 'z')).toBeLessThan(0);
  });
});

describe('plurals', () => {
  const catalogue = {
    'forms.count': {
      'sv-SE': 'plural:one {count} formulär | other {count} formulär',
      'en-GB': 'plural:one {count} form | other {count} forms',
    },
    plain: { 'sv-SE': '{count} svar', 'en-GB': '{count} responses' },
    /** An ordinary sentence that happens to contain a pipe. It must survive intact. */
    piped: { 'sv-SE': 'A | B', 'en-GB': 'A | B' },
    /** A language with one plural category declares one form — and still needs the marker. */
    single: { 'sv-SE': 'plural:other {count} st', 'en-GB': 'plural:other {count} items' },
  };
  const t = (locale: string) => createTranslator(config, catalogue, locale);

  it('picks the singular for one and the plural for the rest', () => {
    expect(t('en-GB')('forms.count', { count: 1 })).toBe('1 form');
    expect(t('en-GB')('forms.count', { count: 0 })).toBe('0 forms');
    expect(t('en-GB')('forms.count', { count: 7 })).toBe('7 forms');
  });

  /**
   * Selection comes from `Intl.PluralRules`, not from `count === 1`. Swedish agrees with English
   * here; most of the languages this product will meet later do not, and hard-coding the English
   * rule is the mistake this is guarding against.
   */
  it('asks the locale rather than assuming the English rule', () => {
    expect(new Intl.PluralRules('sv-SE').select(1)).toBe('one');
    expect(t('sv-SE')('forms.count', { count: 1 })).toBe('1 formulär');
    expect(t('sv-SE')('forms.count', { count: 3 })).toBe('3 formulär');
  });

  it('leaves a message with no plural forms alone', () => {
    expect(t('en-GB')('plain', { count: 2 })).toBe('2 responses');
  });

  /**
   * Chinese and Japanese have a single category, so their messages carry no pipe at all. Before
   * the marker existed there was nothing to detect, and the word "other" reached the reader.
   */
  it('handles a language with only one plural form', () => {
    expect(t('en-GB')('single', { count: 1 })).toBe('1 items');
    expect(t('en-GB')('single', { count: 9 })).toBe('9 items');
  });

  /** A pipe is a character people write. Only category names turn one into a plural form. */
  it('does not cut an ordinary sentence in half at a pipe', () => {
    expect(t('en-GB')('piped', { count: 1 })).toBe('A | B');
    expect(t('en-GB')('piped')).toBe('A | B');
  });

  it('falls back to the plural form when the count is not a number', () => {
    expect(t('en-GB')('forms.count', { count: 'many' })).toBe('many forms');
  });
});

import { describe, expect, it } from 'vitest';
import {
  compareText,
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

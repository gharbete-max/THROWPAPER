import { describe, expect, it } from 'vitest';
import { DEFAULT_MARGIN } from '@tp/tokens/pdf';
import { renderRequestAllowed, toInches } from './pdf.js';

describe('the Electron renderer margins', () => {
  it('converts the print margins to the inches printToPDF takes', () => {
    expect(toInches('25.4mm')).toBe(1);
    expect(toInches('2.54cm')).toBeCloseTo(1);
    expect(toInches('0.5in')).toBe(0.5);
  });

  it('understands every default margin, so a token change cannot break it silently', () => {
    for (const value of Object.values(DEFAULT_MARGIN)) {
      expect(toInches(value)).toBeGreaterThan(0);
    }
  });

  it('refuses a unit it does not know rather than guessing', () => {
    expect(() => toInches('12px')).toThrow(/unsupported margin/);
  });
});

describe('what the print window may load', () => {
  const page = 'file:///C:/Users/a/AppData/Roaming/Loppa/workspace/tmp/render-1.html';
  const pages = new Set([page]);

  it('the page being printed, and inline data', () => {
    expect(renderRequestAllowed(page, pages)).toBe(true);
    expect(renderRequestAllowed('data:font/woff2;base64,AAAA', pages)).toBe(true);
  });

  it('nothing else: no other file in the workspace, no network', () => {
    expect(
      renderRequestAllowed(
        'file:///C:/Users/a/AppData/Roaming/Loppa/workspace/secrets.json',
        pages,
      ),
    ).toBe(false);
    expect(renderRequestAllowed('https://evil.example/?d=x', pages)).toBe(false);
    expect(renderRequestAllowed('http://169.254.169.254/latest/meta-data', pages)).toBe(false);
    expect(renderRequestAllowed('http://127.0.0.1:47017/v1/forms', pages)).toBe(false);
  });
});

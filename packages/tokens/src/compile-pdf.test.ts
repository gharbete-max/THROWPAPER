import { describe, expect, it } from 'vitest';
import { defaultTokens } from './index.js';
import { fontFaceCss, primaryFamily, toPdfFooterTemplate, toPrintCss } from './pdf.js';

const css = toPrintCss(defaultTokens, { header: 'Demo AB', footer: 'Anmälan' });

describe('print stylesheet', () => {
  it('sets the page size and margins', () => {
    expect(css).toContain('size: A4;');
    expect(css).toContain('margin: 18mm 16mm 20mm 16mm;');
  });

  it('numbers pages', () => {
    expect(css).toContain('content: counter(page) " / " counter(pages);');
  });

  it('puts the running header in the top margin box', () => {
    expect(css).toContain('content: "Demo AB";');
  });

  it('carries token colours through as literals', () => {
    expect(css).toContain(defaultTokens.colour.primary);
    expect(css).not.toContain('var(');
  });

  it('keeps backgrounds when printing', () => {
    expect(css).toContain('print-color-adjust: exact;');
  });

  it('accepts a different page size', () => {
    expect(toPrintCss(defaultTokens, { pageSize: 'Letter' })).toContain('size: Letter;');
  });
});

describe('embedded fonts', () => {
  it('inlines the font bytes rather than referencing a family by name', () => {
    expect(css).toContain('@font-face');
    expect(css).toContain('src: url(data:font/woff2;charset=utf-8;base64,');
  });

  it('embeds both the regular and bold weights', () => {
    expect(css).toContain('font-weight: 400;');
    expect(css).toContain('font-weight: 600;');
  });

  it('takes the first family off the stack', () => {
    expect(primaryFamily('Inter, system-ui, sans-serif')).toBe('Inter');
    expect(primaryFamily("'Source Sans 3', sans-serif")).toBe('Source Sans 3');
  });

  it('degrades to the stack fallbacks for a family we ship no files for', () => {
    expect(fontFaceCss(['Helvetica, sans-serif'], [400])).toBe('');
  });
});

describe('Chromium header and footer templates', () => {
  it('numbers pages through the classes Chromium substitutes into', () => {
    const footer = toPdfFooterTemplate(defaultTokens, { footer: 'Demo AB' });
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('escapes footer text', () => {
    expect(toPdfFooterTemplate(defaultTokens, { footer: '<script>' })).toContain('&lt;script&gt;');
  });
});

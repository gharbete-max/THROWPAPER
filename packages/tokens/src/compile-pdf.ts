/**
 * PDF target — SPEC-shared.md §packages/tokens: page size, margins, running header/footer, page
 * numbers, and embedded fonts that render Nordic characters correctly.
 *
 * NODE ONLY (fonts.ts reads from disk). Import via `@tp/tokens/pdf`.
 *
 * A note on running headers: the `@page` margin boxes below (`@top-center`, `@bottom-right`) are
 * the standards-compliant way to do this, and paged engines honour them. Chromium does not — it
 * takes header and footer markup through the print API instead. Both are emitted from the same
 * tokens so whichever engine renders, the result matches.
 */
import type { TokenSet } from './types.js';
import { fontFaceCss } from './fonts.js';
import { pxValue, px, spacing, typeScale } from './units.js';

export type PageSize = 'A4' | 'Letter';

export interface PrintOptions {
  pageSize?: PageSize;
  margin?: { top: string; right: string; bottom: string; left: string };
  /** Running header text. Empty means no header. */
  header?: string;
  /** Running footer text, shown left of the page number. */
  footer?: string;
}

export const DEFAULT_MARGIN = { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' };

export function printMargins(options: PrintOptions = {}) {
  return options.margin ?? DEFAULT_MARGIN;
}

export function toPrintCss(tokens: TokenSet, options: PrintOptions = {}): string {
  const { colour, typography } = tokens;
  const unit = tokens.spacingUnit;
  const pageSize = options.pageSize ?? 'A4';
  const margin = printMargins(options);
  const fonts = fontFaceCss(
    [typography.headingFont, typography.bodyFont],
    [typography.weightRegular, typography.weightBold],
  );

  return `${fonts}

@page {
  size: ${pageSize};
  margin: ${margin.top} ${margin.right} ${margin.bottom} ${margin.left};

  @top-center {
    content: ${cssString(options.header ?? '')};
    font-family: ${typography.bodyFont};
    font-size: ${px(pxValue(typography.baseSize) * 0.75)};
    color: ${colour.muted};
  }

  @bottom-right {
    content: counter(page) " / " counter(pages);
    font-family: ${typography.bodyFont};
    font-size: ${px(pxValue(typography.baseSize) * 0.75)};
    color: ${colour.muted};
  }
}

html {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  margin: 0;
  background: ${colour.background};
  color: ${colour.text};
  font-family: ${typography.bodyFont};
  font-size: ${typography.baseSize};
  line-height: ${typography.lineHeight};
}

h1, h2, h3 {
  font-family: ${typography.headingFont};
  font-weight: ${typography.weightBold};
  color: ${colour.primary};
  margin: 0 0 ${spacing(unit, 1)} 0;
  break-after: avoid;
}

h1 { font-size: ${typeScale(typography.baseSize, typography.scaleRatio, 3)}; }
h2 { font-size: ${typeScale(typography.baseSize, typography.scaleRatio, 2)}; }
h3 { font-size: ${typeScale(typography.baseSize, typography.scaleRatio, 1)}; }

p { margin: 0 0 ${spacing(unit, 2)} 0; }

.tp-card {
  background: ${colour.background};
  border: ${tokens.borderWidth} solid ${colour.border};
  border-radius: ${tokens.radius};
  padding: ${spacing(unit, 3)};
  break-inside: avoid;
}

.tp-muted { color: ${colour.muted}; }

.tp-button {
  display: inline-block;
  padding: ${spacing(unit, 1.5)} ${spacing(unit, 3)};
  border-radius: ${tokens.radius};
  background: ${colour.primary};
  color: ${colour.background};
  border: ${tokens.borderWidth} solid ${colour.primary};
  font-weight: ${typography.weightBold};
  text-decoration: none;
}

table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: ${tokens.borderWidth} solid ${colour.border}; padding: ${spacing(unit, 1)}; text-align: left; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
`;
}

/**
 * Chromium's `headerTemplate`. It renders in an isolated document at a default 10px, ignores the
 * page stylesheet, and only substitutes inside .pageNumber / .totalPages / .title / .date / .url,
 * so everything it needs is inlined here.
 */
export function toPdfHeaderTemplate(tokens: TokenSet, options: PrintOptions = {}): string {
  const header = options.header ?? '';
  if (!header) return '<span></span>';
  return templateChrome(
    tokens,
    `<span style="text-align:center;width:100%">${escapeHtml(header)}</span>`,
  );
}

/** Chromium's `footerTemplate`: optional footer text on the left, "page / total" on the right. */
export function toPdfFooterTemplate(tokens: TokenSet, options: PrintOptions = {}): string {
  const footer = options.footer ?? '';
  return templateChrome(
    tokens,
    `<span>${escapeHtml(footer)}</span>` +
      '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>',
  );
}

function templateChrome(tokens: TokenSet, inner: string): string {
  const margin = DEFAULT_MARGIN;
  const size = px(pxValue(tokens.typography.baseSize) * 0.6875);
  return (
    `<div style="width:100%;box-sizing:border-box;` +
    `padding:0 ${margin.right} 0 ${margin.left};` +
    `display:flex;justify-content:space-between;` +
    `font-family:${tokens.typography.bodyFont};font-size:${size};` +
    `color:${tokens.colour.muted};">${inner}</div>`
  );
}

function cssString(value: string): string {
  const escaped = value.replace(/["\\]/g, (match) => `\\${match}`);
  return `"${escaped}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

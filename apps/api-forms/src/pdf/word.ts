import type { api } from '@tp/shared';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { toPrintCss } from '@tp/tokens/pdf';
import type { PdfRenderer } from '../documents/render.js';

/**
 * A Word document, roughly, as a PDF (Phase 1c). The browser read the `.docx` and sent blocks
 * (`@tp/shared/api` `word-pdf.ts`); this lays them out as HTML in the house print stylesheet and
 * hands that to the renderer every other PDF here uses (Playwright on a server, the desktop's
 * Chromium). Layout is Chromium's, not Word's: fonts, line breaks and page breaks differ, and the
 * screen says so.
 *
 * Fonts: the stylesheet embeds Inter (Latin, Latin Extended). Cyrillic, Greek, Chinese and
 * Japanese text is drawn with whatever the host's Chromium has — fine on the Playwright image and
 * on Windows, a blank box where a host has no such font. `lang` is set so Chromium picks the
 * Japanese or Chinese letter forms; it does not add a font.
 *
 * Everything that came from the file is escaped, and the renderer runs no script and fetches
 * nothing (`documents/render.ts`).
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function runsHtml(runs: readonly api.WordRun[]): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}

const number = (value: number) =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

function blockHtml(block: api.WordBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${runsHtml(block.runs)}</h${block.level}>`;
    case 'paragraph': {
      if (block.marker === undefined) return `<p>${runsHtml(block.runs)}</p>`;
      const indent = number(((block.depth ?? 0) + 1) * 1.5);
      return `<p class="li" style="margin-left:${indent}em"><span class="mk">${escapeHtml(block.marker)}</span><span>${runsHtml(block.runs)}</span></p>`;
    }
    case 'table': {
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell) =>
                  `<td colspan="${cell.colSpan}">${cell.paragraphs.map((p) => `<p>${runsHtml(p)}</p>`).join('')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('');
      return `<table><tbody>${rows}</tbody></table>`;
    }
    case 'image': {
      const width = block.widthPt === undefined ? '' : ` style="width:${number(block.widthPt)}pt"`;
      return `<p class="pic"><img src="data:${block.mime};base64,${escapeHtml(block.data)}" alt=""${width}></p>`;
    }
    case 'pageBreak':
      return '<div class="pb"></div>';
  }
}

export function wordHtml(request: api.WordPdfRequest, tokens: TokenSet = defaultTokens): string {
  const lang = request.lang ?? 'en';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8" />
<style>
${toPrintCss(tokens, { header: '', footer: '' })}
p { white-space: pre-wrap; overflow-wrap: anywhere; }
h4, h5, h6 { font-family: ${tokens.typography.headingFont}; margin: 0 0 0.5em 0; break-after: avoid; }
.li { display: flex; gap: 0.5em; }
.mk { flex: none; }
table { margin: 0 0 1em 0; table-layout: auto; }
td { vertical-align: top; border: ${tokens.borderWidth} solid ${tokens.colour.border}; }
td p { margin: 0 0 0.25em 0; }
.pic { white-space: normal; }
img { max-width: 100%; max-height: 240mm; object-fit: contain; }
.pb { break-after: page; height: 0; }
</style>
</head>
<body>${request.blocks.map(blockHtml).join('')}</body>
</html>`;
}

export async function wordToPdf(
  renderer: PdfRenderer,
  request: api.WordPdfRequest,
  tokens: TokenSet = defaultTokens,
): Promise<Buffer> {
  return renderer.render(wordHtml(request, tokens), { header: '', footer: '' });
}

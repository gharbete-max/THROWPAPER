import { chromium, type Browser } from 'playwright';
import type { TokenSet } from '@tp/tokens';
import { printMargins, toPdfFooterTemplate, toPdfHeaderTemplate, toPrintCss } from '@tp/tokens/pdf';
import { proofCard, NORDIC_PROBE, type ProofCard } from './card.js';

const HEADER = 'Demo AB';
const FOOTER = 'Vårmötet 2026';

export function printHtml(tokens: TokenSet, card: ProofCard = proofCard): string {
  const options = { header: HEADER, footer: FOOTER } as const;
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<title>PDF target</title>
<style>
${toPrintCss(tokens, options)}
</style>
</head>
<body>
<div class="tp-card">
  <p class="tp-muted">${card.eyebrow}</p>
  <h1>${card.title}</h1>
  <p>${card.body}</p>
  <p class="tp-muted">${card.meta}</p>
  <p><a class="tp-button" href="${card.buttonHref}">${card.buttonLabel}</a></p>
  <p class="tp-muted">${card.footer} · ${NORDIC_PROBE}</p>
</div>
</body>
</html>
`;
}

export interface PdfResult {
  html: string;
  pdf: Buffer;
  /** Colour Chromium actually computed for the heading, e.g. "rgb(255, 0, 0)". */
  headingColour: string;
}

/**
 * Chromium ignores the `@page` margin boxes that toPrintCss emits, so the running header, footer
 * and page numbers come through headerTemplate/footerTemplate instead. Both are generated from
 * the same tokens, which is what keeps the two routes in step.
 */
export async function renderPdf(tokens: TokenSet, card: ProofCard = proofCard): Promise<PdfResult> {
  const html = printHtml(tokens, card);
  const options = { header: HEADER, footer: FOOTER } as const;
  const margin = printMargins(options);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);

    const headingColour = await page.evaluate(() => {
      const heading = document.querySelector('h1');
      return heading ? getComputedStyle(heading).color : '';
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: toPdfHeaderTemplate(tokens, options),
      footerTemplate: toPdfFooterTemplate(tokens, options),
      margin,
    });

    return { html, pdf, headingColour };
  } finally {
    await browser?.close();
  }
}

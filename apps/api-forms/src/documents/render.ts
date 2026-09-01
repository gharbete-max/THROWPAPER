import { chromium, type Browser } from 'playwright';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { printMargins, toPdfFooterTemplate, toPdfHeaderTemplate } from '@tp/tokens/pdf';

/**
 * HTML to PDF, on the engine phase 1 proved.
 *
 * The browser is expensive to start (~1s) and cheap to reuse, so bulk generation of 200 documents
 * launches it once rather than 200 times. It is kept alive between renders and closed on shutdown.
 */
export interface PdfRenderer {
  render(html: string, options?: { header?: string; footer?: string }): Promise<Buffer>;
  close(): Promise<void>;
}

export function createPdfRenderer(tokens: TokenSet = defaultTokens): PdfRenderer {
  let browser: Browser | null = null;

  async function ensureBrowser(): Promise<Browser> {
    if (!browser || !browser.isConnected()) browser = await chromium.launch();
    return browser;
  }

  return {
    async render(html, options = {}) {
      const page = await (await ensureBrowser()).newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await page.emulateMedia({ media: 'print' });
        // Without this the embedded font may not have applied yet and å ä ö fall back to a
        // system face — the exact failure phase 1 exists to prevent.
        // Runs inside the page, not in Node — hence the cast rather than pulling the DOM lib
        // into a server tsconfig.
        await page.evaluate(
          '(async () => { await document.fonts.ready; })()' as unknown as () => Promise<void>,
        );

        return await page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: toPdfHeaderTemplate(tokens, options),
          footerTemplate: toPdfFooterTemplate(tokens, options),
          margin: printMargins(),
        });
      } finally {
        await page.close();
      }
    },

    async close() {
      await browser?.close();
      browser = null;
    },
  };
}

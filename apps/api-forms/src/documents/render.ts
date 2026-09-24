import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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
  /**
   * The document exactly as its own CSS lays it out: `@page` sizes honoured, no margins, no
   * running header or footer. For pages that must match another document point for point —
   * the answers drawn back onto somebody's paper — rather than for a branded A4 document.
   */
  renderPages(html: string): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Which Chromium to render with. Omitted, Playwright's own download — what the Docker image ships.
 *
 * The desktop edition (ADR 0016) cannot assume that download: it would be a second 150 MB browser
 * inside an installer that already carries one. Every supported Windows has Microsoft Edge, which
 * is Chromium, so the desktop asks for the `msedge` channel first and an explicit path after that.
 */
export interface BrowserChoice {
  executablePath?: string;
  channel?: 'msedge' | 'chrome';
}

export function createPdfRenderer(
  tokens: TokenSet = defaultTokens,
  choice: BrowserChoice = {},
): PdfRenderer {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  async function ensureBrowser(): Promise<Browser> {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch(choice);
      context = null;
    }
    return browser;
  }

  /**
   * Every page renders with **no JavaScript and no network**.
   *
   * The HTML is ours, and every value in it is escaped — but it carries what strangers typed, and
   * one missed escape would otherwise be a script running inside the server, or an
   * `<iframe src="http://169.254.169.254/…">` drawn into somebody's PDF. Nothing a document needs
   * is fetched: fonts, logos, signatures and QR codes are all inline. So the context allows none of
   * it, and a mistake becomes a blank box instead of a breach.
   */
  async function newPage(): Promise<Page> {
    const running = await ensureBrowser();
    if (!context) {
      context = await running.newContext({ javaScriptEnabled: false });
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
    }
    return context.newPage();
  }

  return {
    async render(html, options = {}) {
      const page = await newPage();
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

    async renderPages(html) {
      const page = await newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(
          '(async () => { await document.fonts.ready; })()' as unknown as () => Promise<void>,
        );
        return await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: {} });
      } finally {
        await page.close();
      }
    },

    async close() {
      await browser?.close();
      browser = null;
      context = null;
    },
  };
}

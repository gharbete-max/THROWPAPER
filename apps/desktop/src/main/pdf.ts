import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow as ElectronBrowserWindow, Session } from 'electron';
import { defaultTokens, type TokenSet } from '@tp/tokens';
import { printMargins, toPdfFooterTemplate, toPdfHeaderTemplate } from '@tp/tokens/pdf';
import type { PdfRenderer } from '@tp/api-forms/desktop';
import { createLimit } from './lifecycle.js';

/**
 * PDFs from the Chromium that Electron already is (ADR 0016).
 *
 * The server's renderer drives a separate Chromium through Playwright — the container ships one,
 * and on Windows Edge stands in. A Mac usually has neither Edge nor Chrome, and a second 150 MB
 * browser inside an app that is already a browser would be absurd. So the desktop renders in a
 * hidden window of its own, with the same page size, margins, header and footer templates as
 * `documents/render.ts`, which is what keeps a desktop admission card the same document as a
 * hosted one.
 *
 * The page is written to a file in the workspace and loaded from there, rather than through a
 * data: URL, because a document with its fonts inlined is megabytes; the file is deleted as soon
 * as the PDF exists, since it carries the attendee's name.
 */
export interface ElectronPdfDeps {
  BrowserWindow: typeof ElectronBrowserWindow;
  /** Inside the workspace, so nothing personal lands in the system temp folder. */
  scratchDir: string;
  tokens?: TokenSet;
  /**
   * A session of the renderer's own (`session.fromPartition`), whose every request but the page
   * being printed is cancelled — see `renderRequestAllowed`. Absent only in tests.
   */
  session?: Session;
  /** Hidden windows at once; each is a browser page of tens of megabytes. Default 2. */
  parallel?: number;
  /** A page that has not loaded and printed by then is given up on and its window destroyed. Default 60 s. */
  timeoutMs?: number;
}

/**
 * Whether the hidden print window may load this URL: the one page file being printed, and inline
 * `data:` (fonts, signatures, QR codes are all inline). Nothing else — no network, and no other
 * `file://`: the page carries what strangers typed, and one missed escape must not be able to read
 * the workspace (`secrets.json` sits beside it) or send anything anywhere.
 */
export function renderRequestAllowed(url: string, pages: ReadonlySet<string>): boolean {
  return url.startsWith('data:') || pages.has(url);
}

const MM_PER_INCH = 25.4;

/** "18mm" → 0.708…; printToPDF takes inches. Only the units `printMargins` uses. */
export function toInches(css: string): number {
  const match = /^([\d.]+)(mm|cm|in)$/.exec(css.trim());
  if (!match) throw new Error(`unsupported margin ${css}`);
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'in') return value;
  return (unit === 'cm' ? value * 10 : value) / MM_PER_INCH;
}

export function createElectronPdfRenderer(deps: ElectronPdfDeps): PdfRenderer {
  const tokens = deps.tokens ?? defaultTokens;
  /** The page files currently being printed, as URLs — the only files the window may load. */
  const pages = new Set<string>();
  const limited = createLimit(deps.parallel ?? 2);
  deps.session?.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !renderRequestAllowed(details.url, pages) });
  });

  /**
   * One page, printed in a hidden window. At most `parallel` windows at once (a batch of two
   * hundred admission cards must not open two hundred browsers), and a page that does not finish in
   * `timeoutMs` is given up on, so a script that never ends cannot hold a window, and the request
   * that waits on it, for ever. Whatever happens the window is destroyed and the file removed.
   */
  function withPage<T>(
    html: string,
    use: (window: ElectronBrowserWindow) => Promise<T>,
  ): Promise<T> {
    return limited(async () => {
      await mkdir(deps.scratchDir, { recursive: true });
      const file = join(deps.scratchDir, `render-${randomUUID()}.html`);
      await writeFile(file, html, { encoding: 'utf8', mode: 0o600 });
      const page = pathToFileURL(file).href;
      pages.add(page);
      let window: ElectronBrowserWindow | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const opened = new deps.BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            ...(deps.session ? { session: deps.session } : {}),
          },
        });
        window = opened;
        const work = (async () => {
          await opened.loadFile(file);
          // The same wait `render.ts` makes: without it the embedded font may not have applied yet
          // and å ä ö fall back to a system face.
          await opened.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
          return use(opened);
        })();
        // After a timeout the destroyed window fails the work: that is not news.
        work.catch(() => undefined);
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('the page took too long to print')),
            deps.timeoutMs ?? 60_000,
          );
        });
        return await Promise.race([work, timeout]);
      } finally {
        clearTimeout(timer);
        window?.destroy();
        pages.delete(page);
        await rm(file, { force: true });
      }
    });
  }

  return {
    render(html, options = {}) {
      return withPage(html, async (window) => {
        const margin = printMargins();
        return window.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: toPdfHeaderTemplate(tokens, options),
          footerTemplate: toPdfFooterTemplate(tokens, options),
          margins: {
            top: toInches(margin.top),
            right: toInches(margin.right),
            bottom: toInches(margin.bottom),
            left: toInches(margin.left),
          },
        });
      });
    },

    renderPages(html) {
      return withPage(html, (window) =>
        window.webContents.printToPDF({
          preferCSSPageSize: true,
          printBackground: true,
          margins: { top: 0, right: 0, bottom: 0, left: 0 },
        }),
      );
    },

    // Every render closes its own window; there is nothing held open between them.
    async close() {},
  };
}

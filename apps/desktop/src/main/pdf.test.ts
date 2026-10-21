import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MARGIN } from '@tp/tokens/pdf';
import { createLimit } from './lifecycle.js';
import { createElectronPdfRenderer, renderRequestAllowed, toInches } from './pdf.js';

describe('the hidden print windows', () => {
  /** A stand-in for Electron's BrowserWindow: counts how many are open at once. */
  function fakeWindows(behaviour: { load?: () => Promise<void> } = {}) {
    const stats = { open: 0, maxOpen: 0, created: 0, destroyed: 0 };
    class FakeWindow {
      webContents = {
        executeJavaScript: () => Promise.resolve(true),
        printToPDF: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Buffer.from('%PDF');
        },
      };
      constructor() {
        stats.created += 1;
        stats.open += 1;
        stats.maxOpen = Math.max(stats.maxOpen, stats.open);
      }
      loadFile() {
        return behaviour.load ? behaviour.load() : Promise.resolve();
      }
      destroy() {
        stats.destroyed += 1;
        stats.open -= 1;
      }
    }
    return { stats, BrowserWindow: FakeWindow as never };
  }

  const scratch = async () => mkdtemp(join(tmpdir(), 'loppa-pdf-'));

  it('never has more than two open at once, however many are asked for, and removes each page file', async () => {
    const { stats, BrowserWindow } = fakeWindows();
    const dir = await scratch();
    const renderer = createElectronPdfRenderer({ BrowserWindow, scratchDir: dir });
    const out = await Promise.all(
      Array.from({ length: 9 }, () => renderer.renderPages('<p>x</p>')),
    );
    expect(out).toHaveLength(9);
    expect(stats.created).toBe(9);
    expect(stats.maxOpen).toBe(2);
    expect(stats.destroyed).toBe(9);
    expect(await readdir(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('gives up on a page that never loads: the request fails, the window is destroyed, the file removed, the next one prints', async () => {
    let first = true;
    const { stats, BrowserWindow } = fakeWindows({
      load: () => {
        if (!first) return Promise.resolve();
        first = false;
        return new Promise(() => undefined); // a script that never ends
      },
    });
    const dir = await scratch();
    const renderer = createElectronPdfRenderer({ BrowserWindow, scratchDir: dir, timeoutMs: 80 });
    await expect(renderer.renderPages('<script>for(;;);</script>')).rejects.toThrow(/too long/);
    expect(stats.destroyed).toBe(1);
    expect(await readdir(dir)).toEqual([]);
    await expect(renderer.renderPages('<p>fine</p>')).resolves.toBeInstanceOf(Buffer);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('the limiter', () => {
  it('keeps to its count when one job ends as another is let in', async () => {
    const limit = createLimit(2);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limit(async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    expect(max).toBe(2);
  });
});

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

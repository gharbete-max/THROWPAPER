import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { startDesktopServer } from '../desktop/start.js';
import type { PdfRenderer } from '../documents/render.js';
import { pdfFields } from '../pdf/fill.js';
import { demoArrangedPdf, demoFormPdf, demoToSend, FILLED_FORM } from './documents.js';
import { DEMO_DOCUMENT_FORMS } from './dataset.js';

const scratch = await mkdtemp(join(tmpdir(), 'loppa-demo-docs-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('the demo documents', () => {
  it('has a blank form with its own fields and the same form filled', async () => {
    const blank = await pdfFields(await demoFormPdf(false));
    expect(blank.map((field) => field.name)).toEqual(['name', 'address', 'email', 'newsletter']);
    expect(blank.every((field) => field.value === '' || field.value === false)).toBe(true);
    const filled = await pdfFields(await demoFormPdf(true));
    expect(filled.find((field) => field.name === 'name')?.value).toBe(FILLED_FORM.name);
    expect(filled.find((field) => field.name === 'newsletter')?.value).toBe(true);
  });

  it('has an unordered PDF of more than one page, and the files on disk match', async () => {
    const arranged = await PDFDocument.load(await demoArrangedPdf());
    expect(arranged.getPageCount()).toBe(3);
    const onDisk = await readFile(
      join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'demo', 'arrange-me.pdf'),
    );
    expect((await PDFDocument.load(onDisk)).getPageCount()).toBe(3);
  });

  it('leaves a message with the filled PDF waiting, and two forms standing for imports', async () => {
    const mail = await demoToSend();
    expect(mail.to).toMatch(/@example\.com$/);
    expect(mail.attachments?.[0]?.contentType).toBe('application/pdf');
    expect(DEMO_DOCUMENT_FORMS.map((form) => form.slug)).toEqual([
      'medlemsansokan-pdf',
      'besiktning-word',
    ]);
  });
});

/** No Chromium in a unit test. */
const fakeRenderer: PdfRenderer = {
  render: async () => Buffer.from('%PDF-fake'),
  renderPages: async () => Buffer.from('%PDF-fake'),
  close: async () => {},
};

describe('the desktop demo', { timeout: 60_000 }, () => {
  it('puts one message in To send, and only on an empty workspace', async () => {
    const webDir = join(scratch, 'web');
    await mkdir(webDir, { recursive: true });
    await writeFile(join(webDir, 'index.html'), '<!doctype html><div id="root"></div>');
    const dataDir = join(scratch, 'data');
    const server = await startDesktopServer({
      dataDir,
      webDir,
      migrationsFolder: join(import.meta.dirname, '..', '..', 'drizzle'),
      port: 0,
      renderer: fakeRenderer,
    });
    try {
      expect(await server.loadDemo()).toBe(true);
      expect(await readdir(join(dataDir, 'to-send'))).toHaveLength(1);
      expect(await server.loadDemo()).toBe(false);
      expect(await readdir(join(dataDir, 'to-send'))).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

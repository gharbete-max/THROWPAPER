import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, plantLoginToken, scanStep } from './support.js';
import { linesPdf } from './pdf.js';

/**
 * Edit text and redact — phase 1b of `docs/plan/NEXT.md`.
 *
 * Two one-page PDFs with distinct words. On the first the person adds text (Cyrillic, so an
 * embedded font is used), covers a patch, and downloads; then redacts the line that carries the
 * secret. The file that comes down is opened with pdf-lib and every stream is read: the redacted
 * word is nowhere, the other page's words and the added text are. (The unit tests read the same
 * output with pdf.js; `apps/api-forms/src/pdf/edit.test.ts`.)
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

interface Reader {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{
      getPageCount(): number;
      context: { enumerateIndirectObjects(): Array<[unknown, unknown]> };
    }>;
  };
  PDFRawStream: new (...args: never[]) => unknown;
  decodePDFRawStream(stream: unknown): { decode(): Uint8Array };
}
const pdfLib = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Reader;

/** Everything the file says, raw and with each stream inflated; hex strings shown as (text). */
async function everything(path: string): Promise<{ all: string; pages: number }> {
  const bytes = await readFile(path);
  const doc = await pdfLib.PDFDocument.load(bytes);
  let all = '';
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof pdfLib.PDFRawStream) {
      all += Buffer.from(pdfLib.decodePDFRawStream(object).decode())
        .toString('latin1')
        .replace(
          /<([0-9A-Fa-f]{2,})>/g,
          (_, hex: string) => `(${Buffer.from(hex, 'hex').toString('latin1')})`,
        );
    }
  }
  return { all, pages: doc.getPageCount() };
}

async function openEditor(page: Page, position: number) {
  await page
    .locator('.scan__page')
    .nth(position)
    .getByRole('button', { name: 'Edit text or redact' })
    .click();
  await expect(page.getByRole('heading', { name: `Edit page ${position + 1}` })).toBeVisible();
  // The page is drawn before anything is placed on it.
  await expect
    .poll(() =>
      page.locator('.scan-edit__canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width > 0),
    )
    .toBe(true);
}

test('edit: text is added and covered, a line is redacted, and the download has no trace of it', async ({
  page,
}) => {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible();
  await page.goto('/scan');

  await page.getByTestId('scan-files').setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: linesPdf(['SECRETWORD first page']) },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: linesPdf(['KEEPWORD second page']) },
  ]);
  await expect(page.getByText('2 pages')).toBeVisible();

  // Add text (Cyrillic needs the embedded font) and a cover, by typing their places.
  await openEditor(page, 0);
  await page.getByLabel('Text', { exact: true }).fill('Привет мир');
  await page.getByLabel('From the left (points)').fill('72');
  await page.getByLabel('From the top (points)').fill('200');
  await page.getByRole('button', { name: 'Add to the page' }).click();
  await page.getByLabel('Cover', { exact: true }).check();
  await page.getByLabel('From the left (points)').fill('300');
  await page.getByLabel('From the top (points)').fill('300');
  await page.getByRole('button', { name: 'Add to the page' }).click();
  await expect(page.getByText('Text: Привет мир')).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'Edit page 1' })).toHaveCount(0);
  await expect(page.getByText('2 pages')).toBeVisible();

  // Redact the line that holds the secret: a box over the first line (about 62 pt from the top).
  await openEditor(page, 0);
  await page.getByLabel('Redact', { exact: true }).check();
  await expect(page.getByText(/no longer be searched/)).toBeVisible();
  await page.getByLabel('From the left (points)').fill('60');
  await page.getByLabel('From the top (points)').fill('40');
  await page.getByLabel('Width (points)').fill('300');
  await page.getByLabel('Height (points)').fill('40');
  await page.getByRole('button', { name: 'Add to the page' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Redact' }).click();
  await expect(page.getByRole('heading', { name: 'Edit page 1' })).toHaveCount(0);
  await expect(page.getByText('2 pages')).toBeVisible();

  const download = page.waitForEvent('download');
  await scanStep(page, 'keep');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  const { all, pages } = await everything(await (await download).path());
  expect(pages).toBe(2);
  expect(all).not.toContain('SECRETWORD');
  expect(all).toContain('KEEPWORD second page');
});

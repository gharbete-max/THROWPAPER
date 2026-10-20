import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { db, plantLoginToken } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * Arrange pages — phase 1a of `docs/plan/NEXT.md`.
 *
 * Three one-page PDFs are told apart by the turn each already has (0, 90, 180), because a turn is
 * readable from the output without extracting any text. The person puts the last one first, turns
 * the old first one, and takes the middle one out; the PDF that comes down must be exactly that.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

// pdf-lib is the API's dependency, not the root's, so it is loaded from there and typed by hand.
interface Reader {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{ getPages(): Array<{ getRotation(): { angle: number } }> }>;
  };
}
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Reader;

test('arrange: pages from three PDFs are reordered, turned and removed into one download @smoke', async ({
  page,
}) => {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();

  await page.goto('/scan');
  await expect(page.getByRole('heading', { name: 'Arrange pages' })).toBeVisible();

  await page.getByTestId('scan-files').setInputFiles(
    [0, 90, 180].map((rotate, index) => ({
      name: `${'abc'[index]}.pdf`,
      mimeType: 'application/pdf',
      buffer: tinyPdf('x', rotate),
    })),
  );
  await expect(page.getByText('3 pages')).toBeVisible();
  const cards = page.locator('.scan__page');
  await expect(cards).toHaveCount(3);
  // Each page is drawn: the first canvas has something other than white paper on it (the page's
  // one small letter, at thumbnail size).
  await expect
    .poll(async () =>
      page
        .locator('.scan__canvas')
        .first()
        .evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < data.length; i += 4) if (data[i]! < 235) return true;
          return false;
        }),
    )
    .toBe(true);

  // C, A, B: the last page moved earlier twice.
  await cards.nth(2).getByRole('button', { name: 'Move earlier' }).click();
  await cards.nth(1).getByRole('button', { name: 'Move earlier' }).click();
  // The old first page is now second: turn it a quarter. Then take the old middle page out.
  await cards.nth(1).getByRole('button', { name: 'Turn' }).click();
  await cards.nth(2).getByRole('button', { name: 'Remove page' }).click();
  await expect(page.getByText('2 pages')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  const saved = await (await download).path();
  const out = await PDFDocument.load(await readFile(saved));
  expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 90]);
});

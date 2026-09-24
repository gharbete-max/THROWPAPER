import { expect, test } from '@playwright/test';
import { db, plantLoginToken } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * "From paper" draws the PDF it was given.
 *
 * It had no end-to-end test, and it broke without anybody seeing: pdf.js 6's default build calls
 * `Map.prototype.getOrInsertComputed` while drawing a page, which browsers only gained in 2026, so
 * the import threw in any browser a few versions old. The app now loads the legacy build. This
 * spec draws a page in whatever Chromium runs the suite — including older ones — and checks there
 * is ink on the canvas, not merely that a canvas exists.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await sql`delete from forms where id = ${id}`;
  // And anything an interrupted run left behind.
  await sql`delete from forms where slug like 'papper-%' and published_version_id is null`;
  await sql.end();
});

test('a PDF imported from paper is drawn on the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'sv-SE'));
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('heading', { name: 'Evenemang' })).toBeVisible();

  await page.goto('/forms');
  await page.getByRole('button', { name: 'Nytt formulär' }).first().click();
  await page.getByRole('button', { name: /Bygga själv/ }).click();
  // A blank form, named, then opened in the editor from its card.
  const stamp = Date.now();
  await page.getByLabel('Titel', { exact: true }).fill(`Blankett från papper ${stamp}`);
  await page.getByLabel('Länkadress').fill(`papper-${stamp}`);
  await page.getByRole('button', { name: 'Skapa' }).click();
  await page
    .locator('.card', { hasText: `Blankett från papper ${stamp}` })
    .getByRole('link', { name: 'Redigera formulär' })
    .click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  created.push(page.url().split('/').pop()!);

  await page.getByRole('button', { name: 'Från papper' }).click();
  await page.getByLabel('PDF eller fotografier').setInputFiles({
    name: 'blankett.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Ansokan om medlemskap'),
  });
  await expect(page.getByText('1 sida')).toBeVisible();
  await expect(page.getByText('Filen gick inte att läsa.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ersätt formuläret' }).click();

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  // Ink: some pixel on the page is dark. A canvas that failed to draw is all one colour.
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const c = element as HTMLCanvasElement;
          const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! < 100 && data[i + 1]! < 100 && data[i + 2]! < 100 && data[i + 3]! > 0) {
              dark += 1;
            }
          }
          return dark;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(50);

  expect(errors.filter((message) => /getOrInsertComputed|is not a function/.test(message))).toEqual(
    [],
  );
});

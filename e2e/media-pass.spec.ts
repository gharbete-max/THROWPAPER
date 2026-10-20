import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * The second media pass (`docs/brand/MEDIA.md`): the photographs on the heads of screens are
 * sized, lazy and described, the pair follows the theme, and a decorative repeat has no alt text.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

test('page photographs: sized, lazy, described, and the pair follows the theme', async ({
  page,
}) => {
  await page.addInitScript(fakeBridge);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  await page.goto('/send');
  const fortune = page.getByRole('img', { name: 'A folded paper fortune teller' });
  await expect(fortune).toBeVisible();
  await expect(fortune).toHaveAttribute('width', '1600');
  await expect(fortune).toHaveAttribute('height', '600');
  await expect(fortune).toHaveAttribute('loading', 'lazy');
  await expect(fortune).toHaveAttribute('decoding', 'async');

  // The summary header is two files and only the one for the theme is shown (a hidden lazy image
  // is never fetched).
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/summary');
  const liquid = page.getByRole('img', { name: 'Liquid metal in ripples' });
  await expect(liquid).toHaveCount(1);
  await expect(liquid).toHaveAttribute('src', '/media/summary-light.webp');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(liquid).toHaveAttribute('src', '/media/summary-dark.webp');

  // The gold strips (on the set-up page): the model card's is decoration, the AI models card's is described.
  await page.goto('/ai-setup');
  await expect(page.locator('[data-model]').first().locator('img.banner')).toHaveAttribute(
    'alt',
    '',
  );
  await expect(page.getByRole('img', { name: 'Streaks of golden light' })).toBeVisible();

  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.locator('.doors__myself button').click();
  await expect(page.getByRole('img', { name: 'Crumpled gold foil' })).toBeVisible();

  await page.goto('/signing');
  await page.locator('main header .button:not(.button--quiet)').first().click();
  await expect(
    page.getByRole('img', { name: 'A hand signing a sheet of paper at a desk' }),
  ).toBeVisible();
});

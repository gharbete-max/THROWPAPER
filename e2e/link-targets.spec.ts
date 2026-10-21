import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * The two links that stand on their own line in Set up AI and Summary were 20 px high at a phone's
 * width, under WCAG 2.5.8's 24 px: the forms-UI review's L6.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

test('the link between Set up AI and Summary is a 24 px target at 360 px wide', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(fakeBridge);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  await page.goto('/summary');
  const toSetup = page.getByRole('link', { name: 'Set up AI' });
  await expect(toSetup).toBeVisible();
  expect((await toSetup.boundingBox())!.height).toBeGreaterThanOrEqual(24);

  await toSetup.click();
  await expect(page.getByRole('heading', { name: 'Set up AI', level: 1 })).toBeVisible();
  const toSummary = page.getByRole('main').getByRole('link', { name: 'Summary and translation' });
  await expect(toSummary).toBeVisible();
  expect((await toSummary.boundingBox())!.height).toBeGreaterThanOrEqual(24);
});

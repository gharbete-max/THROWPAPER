import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * Pages opened the plain way: no desktop bridge (`window.loppaAi`, `loppaModel`), no file handed
 * over. A previous session reported that `/ai-setup` and a filled `/send` took headless Chromium
 * down; neither reproduces, and this keeps it so. Each page must render a calm answer and stay
 * responsive (a round trip into the page well under a second), even when the server's `/health`
 * cannot be reached, which used to leave `/ai-setup` on "Loading…" for good.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

/** The page's main thread answers quickly: nothing is looping behind the rendered screen. */
async function expectResponsive(page: Page) {
  // Watch the main thread for a second: a timer that keeps firing every 50 ms means nothing is looping.
  const worstGap = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const begin = performance.now();
        let last = begin;
        let worst = 0;
        const timer = setInterval(() => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          if (now - begin >= 1000) {
            clearInterval(timer);
            resolve(worst);
          }
        }, 50);
      }),
  );
  expect(worstGap).toBeLessThan(1000);
}

test('AI setup without the bridge says it is a desktop feature @smoke', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/ai-setup');
  await expect(page.getByRole('heading', { name: 'Set up AI' })).toBeVisible();
  await expect(page.getByText('AI setup is available in the desktop app.')).toBeVisible();
  await expectResponsive(page);
});

test('AI setup still answers when the server cannot be asked what edition it is', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.route('**/health', (route) => route.abort());
  await page.goto('/ai-setup');
  await expect(page.getByText('AI setup is available in the desktop app.')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await expectResponsive(page);
});

test('Send filled in with no file asks for a file and stays responsive', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/send');
  await page.getByLabel('To', { exact: true }).fill('a@example.com');
  await page.getByLabel('Subject').fill('Hello');
  await page.getByRole('button', { name: 'Review before sending' }).click();
  await expect(page.getByText('Choose a file first.')).toBeVisible();
  await expectResponsive(page);
});

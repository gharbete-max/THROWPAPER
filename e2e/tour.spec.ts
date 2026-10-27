import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/** The first-run tour (`docs/plan/EASY.md`, E2): once, skippable, replayable, by keyboard. */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

test('a fresh profile gets the tour once; Escape ends it; More replays it @smoke', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  // Registered after signInAs, so it runs after the flag it set: this profile is a fresh one.
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('tour-test')) {
      window.sessionStorage.setItem('tour-test', '1');
      window.localStorage.removeItem('tp.tour.seen');
    }
  });
  await page.goto('/room');
  const bubble = page.getByRole('dialog', { name: 'A quick tour' });
  await expect(bubble).toBeVisible({ timeout: 20_000 });
  await expect(bubble).toContainText('1 / 5');
  await expect(bubble.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bubble).toContainText('Got a paper?');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);

  // A second start gets none.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(bubble).toHaveCount(0);

  // Replay from More, through to the end.
  await page.getByText('More', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Show me around' }).click();
  await expect(bubble).toContainText('1 / 5');
  for (let i = 0; i < 4; i++) await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('5 / 5');
  await bubble.getByRole('button', { name: 'Got it' }).click();
  await expect(bubble).toHaveCount(0);
});

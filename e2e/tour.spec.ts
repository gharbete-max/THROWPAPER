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
  // The tour is told on the opened catcher, one bubble on each real part.
  await page.getByRole('link', { name: 'Documents' }).click();
  const bubble = page.getByRole('dialog', { name: 'A quick tour' });
  await expect(bubble).toBeVisible({ timeout: 20_000 });
  await expect(bubble).toContainText('1 / 3');
  await expect(bubble.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bubble).toContainText('Got a paper?');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);

  // A second start gets none.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Documents' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(bubble).toHaveCount(0);

  // Replay from More (in the rail of any part), through to the end.
  await page.goto('/forms');
  await page.getByText('More', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Show me around' }).click();
  // It takes us to the room itself; the tour is told once the catcher is opened.
  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(bubble).toContainText('1 / 3');
  for (let i = 0; i < 2; i++) await bubble.getByRole('button', { name: 'Next' }).click();
  await expect(bubble).toContainText('3 / 3');
  await bubble.getByRole('button', { name: 'Got it' }).click();
  await expect(bubble).toHaveCount(0);
});

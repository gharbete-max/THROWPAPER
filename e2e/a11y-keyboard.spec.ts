import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * Keyboard and landmark basics found by the 2026-10 forms UI review (`docs/reviews/2026-10-forms-ui.md`):
 * the app shell had no skip link and left focus on the rail after a navigation, the radio groups
 * ignored the arrow keys their role promises, the builder's divider was a separator without a
 * value, and To send asked a server for a list only the desktop has.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

test.beforeEach(async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
});

test('the first Tab is a skip link, and a new screen takes focus at its top @smoke', async ({
  page,
}) => {
  await page.goto('/scan');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  // Pressing a rail link moves focus into the new screen instead of leaving it on the rail.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Send' })
    .click();
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.locator('main#main')).toBeFocused();
});

test('the arrow keys move between the ways to send @smoke', async ({ page }) => {
  await page.goto('/send');
  const one = page.getByRole('radio', { name: 'One document' });
  await one.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'One each, from a list' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'One each, from a list' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(one).toBeChecked();
});

test('the builder opens on its tray, and To send on a server is empty, not an error', async ({
  page,
}) => {
  const [draft] = await sql`select id from forms where published_version_id is null limit 1`;
  await page.goto(`/forms/${String(draft!['id'])}`);
  await expect(page.locator('.eb__tray')).toBeVisible();

  const failures: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/outgoing');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Nothing is waiting to be sent')).toBeVisible();
  expect(failures).toEqual([]);
});

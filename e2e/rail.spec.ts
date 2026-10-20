import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The rail follows the room (`docs/plan/SIMPLIFY.md`, proposal 3): the four parts first, and the
 * first product's screens (events, responses, invoices, users, brand) folded under one
 * "Earlier features" disclosure. Nothing is removed: every route still works and the command
 * palette still finds it.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

test('the rail lists the four parts; the earlier features fold, remember and stay reachable @smoke', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  const rail = page.getByRole('navigation', { name: 'Sections' });
  for (const name of ['Forms', 'Scan', 'Sign', 'Send']) {
    await expect(rail.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(rail.getByRole('link', { name: 'Back to the room', exact: false })).toBeVisible();

  // Closed to start with; the keyboard opens it and the choice is remembered.
  const earlier = rail.getByText('Earlier features');
  await expect(rail.getByRole('link', { name: 'Events' })).toBeHidden();
  await rail.locator('summary').focus();
  await page.keyboard.press('Enter');
  for (const name of ['Events', 'Responses', 'Invoices', 'Users', 'Brand']) {
    await expect(rail.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(rail.getByRole('link', { name: 'Events', exact: true })).toBeVisible();

  // Closed again, then a screen inside the group opens it so the current row is not hidden.
  await earlier.click();
  await expect(rail.getByRole('link', { name: 'Events' })).toBeHidden();
  await page.goto('/invoices');
  await expect(rail.getByRole('link', { name: 'Invoices', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // The palette finds a route that is folded away.
  await page.goto('/forms');
  await expect(rail.getByRole('link', { name: 'Forms', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('brand');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/brand$/);
});

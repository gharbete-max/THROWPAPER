import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The form creator as a blank page (`docs/plan/EASY.md`, E3): a first-timer adds three pieces,
 * by dragging, pressing and the keyboard, names one in its quick bubble and reaches Share, without
 * opening More. The full panel is one press from the bubble.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) {
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

test('three pieces, a name, and Share, without opening More @smoke', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms?new=manual');
  const stamp = Date.now().toString(36);
  await page.getByLabel('Title', { exact: true }).fill(`Easy ${stamp}`);
  await page.getByLabel('Link address').fill(`easy-${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  created.push(page.url().split('/').pop()!);

  // A blank page: no rail, a tray, nothing open.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  await expect(page.getByText('Drag a piece here')).toBeVisible();
  const tray = page.getByRole('group', { name: 'Add to the page' });
  await expect(tray.getByRole('button')).toHaveCount(9);

  // Dragged onto the page, pressed, and pressed again.
  await tray.getByRole('button', { name: 'Short text' }).dragTo(page.locator('.eb__page'));
  await expect(page.locator('.builder__list > li')).toHaveCount(1);
  await tray.getByRole('button', { name: 'Date' }).click();
  await tray.getByRole('button', { name: 'Signature' }).click();
  await expect(page.locator('.builder__list > li')).toHaveCount(3);

  // The bubble beside a piece: its words and "required", with the full panel behind a press.
  await page.locator('.builder__itemBody').first().click();
  await page.getByLabel('Label').first().fill('Your name');
  await page.getByLabel('Required').check();
  await expect(page.getByLabel('Placeholder')).toHaveCount(0);
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByLabel('Placeholder')).toBeVisible();

  // Share holds the four things a document is for, and Publish.
  await page.locator('.eb__share summary').click();
  for (const name of ['Download PDF', 'Share to collect'])
    await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fill in' })).toBeVisible();
  await expect(page.locator('.eb__more')).not.toHaveAttribute('open', '');

  if (process.env['EB_SHOTS'])
    await page.screenshot({ path: `${process.env['EB_SHOTS']}/builder.png` });
});

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * Spreadsheets, the Library (ADR 0027): the pack's script and its twelve commands, to copy or save.
 *
 * The suite runs the server edition, so the desktop's own room is made by telling `/health` what the
 * packaged app would say. The server edition is checked too: it has no Spreadsheets catcher to open.
 */
const sql = db();
const script = await readFile(
  new URL('../packs/spreadsheets/Loppa-Sheets.ps1', import.meta.url),
  'utf8',
);

test.afterAll(async () => {
  await sql.end();
});

async function asDesktop(page: Page) {
  await page.route('**/health', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), edition: 'desktop' } });
  });
}

test('the room opens Spreadsheets into its Library, where the script is copied and saved', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');

  await page.getByRole('link', { name: 'Spreadsheets' }).click();
  await expect(page).toHaveURL(/\/sheets$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Library');
  // The way back is the room, and a bare page has no Documents rail.
  await expect(page.getByRole('link', { name: 'Scan' })).toHaveCount(0);

  // Twelve commands, each with a line to adapt.
  await expect(page.locator('[data-command]')).toHaveCount(12);
  await expect(page.locator('[data-command="compare"] code')).toHaveText(
    '.\\Loppa-Sheets.ps1 compare -A old.csv -B new.csv -Key Id',
  );

  // The whole script is what lands on the clipboard, byte for byte.
  await page.getByRole('button', { name: 'Copy the script' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(script);

  // One command's example, not the script.
  await page
    .locator('[data-command="lookup"]')
    .getByRole('button', { name: 'Copy example' })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '.\\Loppa-Sheets.ps1 lookup -File orders.csv -Key CustomerId -From customers.csv -Take Name,City',
  );

  // Saved as a .ps1 with a byte-order mark, so Windows PowerShell 5.1 reads å ä ö as UTF-8.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .ps1' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Loppa-Sheets.ps1');
  const bytes = await readFile((await saved.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString('utf8')).toBe(script);

  // Search narrows the list, and says so when nothing matches.
  await page.getByRole('searchbox', { name: 'Search the commands' }).fill('vlookup');
  await expect(page.locator('[data-command]')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search the commands' }).fill('zzzz');
  await expect(page.getByText('No command matches that.')).toBeVisible();

  await page.getByRole('link', { name: 'Back to the room' }).click();
  await expect(page).toHaveURL(/\/room$/);
});

test('a command without its own words shows the English and says so', async ({ page }) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'de-DE');
  await page.goto('/sheets');
  const card = page.locator('[data-command="split"]');
  await expect(card.getByRole('heading')).toHaveText('Split a file by a column');
  await expect(card).toContainText('Auf Englisch');
  await expect(card.getByRole('heading')).toHaveAttribute('lang', 'en');
});

test('Swedish has its own words for the commands', async ({ page }) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'sv-SE');
  await page.goto('/sheets');
  await expect(page.locator('[data-command="split"]').getByRole('heading')).toHaveText(
    'Dela en fil efter en kolumn',
  );
});

test('the server edition has no Library to open', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets');
  await expect(page.getByText('This is in the desktop app.')).toBeVisible();
  await expect(page.locator('[data-command]')).toHaveCount(0);
});

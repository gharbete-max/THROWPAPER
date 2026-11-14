import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * Spreadsheets, Convert (ADR 0027): a Swedish CSV, read for what it is and saved the way this
 * computer's Excel wants it. The suite runs the server edition, so the desktop is made by telling
 * `/health` what the packaged app would say. The browser here reports an English locale, so the
 * defaults are a comma between fields and a decimal point.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

async function asDesktop(page: Page) {
  await page.route('**/health', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), edition: 'desktop' } });
  });
}

/** Windows-1252 for these letters is the same bytes as Latin-1. */
const swedish = Buffer.from(
  'Namn;Belopp;Ort\r\nÅsa Öberg;1 234,50;Malmö\r\nBo;99,5;Lund\r\n',
  'latin1',
);

test('a Swedish CSV is read for what it is and saved for an English Excel', async ({ page }) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets');
  await page.getByRole('link', { name: 'Convert' }).click();
  await expect(page).toHaveURL(/\/sheets\/convert$/);

  await page.getByTestId('sheets-file').setInputFiles({
    name: 'kunder.csv',
    mimeType: 'text/csv',
    buffer: swedish,
  });

  // What was found, said plainly and changeable.
  const found = page.getByRole('region', { name: /What was found in the file/ });
  await expect(found.getByLabel('Separator')).toHaveValue(';');
  await expect(found.getByLabel(/Letters/)).toHaveValue('windows-1252');
  await expect(found.getByText('Comma, as in 1,5')).toBeVisible();
  await expect(found.locator('dd').first()).toHaveText('3');
  await expect(found.getByRole('cell', { name: 'Åsa Öberg' })).toBeVisible();

  // Saved for this computer: comma between fields, a decimal point, UTF-8 with a mark.
  const out = page.getByRole('region', { name: 'Save as' });
  await expect(out.getByLabel('Separator')).toHaveValue(',');
  await expect(out.getByLabel('Decimal mark')).toHaveValue('.');
  const download = page.waitForEvent('download');
  await out.getByRole('button', { name: 'Save the converted file' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('kunder-converted.csv');
  const bytes = await readFile((await saved.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString('utf8')).toBe(
    'Namn,Belopp,Ort\r\nÅsa Öberg,1234.50,Malmö\r\nBo,99.5,Lund\r\n',
  );
  await expect(out.getByRole('status')).toContainText('Saved as kunder-converted.csv');
  await expect(out.getByRole('status')).toContainText('2 numbers changed');
});

test('the choices can be changed: keep the numbers, semicolons, Windows-1252', async ({ page }) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets/convert');
  await page.getByTestId('sheets-file').setInputFiles({
    name: 'a.csv',
    mimeType: 'text/csv',
    buffer: swedish,
  });
  const out = page.getByRole('region', { name: 'Save as' });
  await out.getByLabel('Separator').selectOption(';');
  await out.getByLabel('Decimal mark').selectOption('keep');
  await out.getByLabel(/Letters/).selectOption('windows-1252');
  const download = page.waitForEvent('download');
  await out.getByRole('button', { name: 'Save the converted file' }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.equals(swedish)).toBe(true);
});

test('an Excel workbook is read sheet by sheet and saved as CSV or as a new workbook', async ({
  page,
}) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets/convert');
  await page.getByTestId('sheets-file').setInputFiles('fixtures/xlsx/people.xlsx');

  const found = page.getByRole('region', { name: /What was found in the file/ });
  await expect(found.getByRole('cell', { name: 'Åsa Öberg' })).toBeVisible();
  await expect(found.getByRole('cell', { name: '2024-03-05' })).toBeVisible();
  await found.getByLabel('Sheet').selectOption({ label: 'Second' });
  await expect(found.getByRole('columnheader', { name: 'y' })).toBeVisible();
  await found.getByLabel('Sheet').selectOption({ label: 'People' });

  const out = page.getByRole('region', { name: 'Save as' });
  const csv = page.waitForEvent('download');
  await out.getByRole('button', { name: 'Save the converted file' }).click();
  const csvName = (await csv).suggestedFilename();
  expect(csvName).toBe('people-converted.csv');

  await out.getByLabel('File type').selectOption('xlsx');
  const xlsx = page.waitForEvent('download');
  await out.getByRole('button', { name: 'Save the converted file' }).click();
  const saved = await xlsx;
  expect(saved.suggestedFilename()).toBe('people-converted.xlsx');
  const bytes = await readFile((await saved.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('00123'))).toBe(true);
});

test('an empty file is refused plainly, and the server edition has nothing to convert with', async ({
  page,
}) => {
  await asDesktop(page);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets/convert');
  await page.getByTestId('sheets-file').setInputFiles({
    name: 'empty.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(0),
  });
  await expect(page.getByRole('alert')).toHaveText('That file is empty.');
});

test('the server edition has no Convert to use', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/sheets/convert');
  await expect(page.getByText('This is in the desktop app.')).toBeVisible();
  await expect(page.getByTestId('sheets-file')).toHaveCount(0);
});

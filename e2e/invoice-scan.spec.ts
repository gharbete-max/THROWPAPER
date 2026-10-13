import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import {
  daStandard,
  deStandard,
  enStandard,
  invoiceHtml,
  invoicePdf,
  PAGE_PX,
  svStandard,
  svWrongReference,
  type InvoiceFixture,
} from '../fixtures/invoices/invoices.js';

/**
 * Reading a supplier invoice — Documents, "Invoice scan" (`docs/HANDOVER.md` decision 5).
 *
 * Each synthetic invoice (`fixtures/invoices/invoices.ts`, written for this repository) is drawn to
 * a picture by the browser itself, handed to the screen as a photograph, and read by the real
 * Tesseract in its own worker, from this origin. Then the rules pick out the fields. The test
 * proves each field is found where the invoice puts it, that the page shows where, that nothing is
 * kept until it is confirmed, and that a wrong payment reference is caught by its check digit.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

// Tesseract's language data and its first page take seconds, not milliseconds.
test.setTimeout(180_000);
const READ = { timeout: 120_000 };

/** The invoice as a picture, drawn by the browser: no image library and no stored picture. */
async function picture(page: Page, fixture: InvoiceFixture): Promise<Buffer> {
  const sheet = await page.context().newPage();
  await sheet.setViewportSize(PAGE_PX);
  await sheet.setContent(invoiceHtml(fixture));
  const png = await sheet.screenshot({ type: 'png' });
  await sheet.close();
  return png;
}

async function open(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/scan');
  await page.getByTestId('scan-invoice-open').click();
  await expect(page.getByTestId('invoice-scan')).toBeVisible();
}

const card = (page: Page, key: string) => page.locator(`fieldset[data-field="${key}"]`);

/** What each card should hold, in the form the cards publish. */
function expectedValues(f: InvoiceFixture) {
  const { expected } = f;
  return {
    total: expected.total,
    currency: expected.currency,
    dueDate: expected.dueDate,
    bank: `${expected.bank.method}:${expected.bank.account}`,
    reference: `${expected.reference.kind}:${expected.reference.value}`,
    vat: expected.vat!,
  };
}

async function readPicture(page: Page, fixture: InvoiceFixture) {
  await open(page);
  await page.getByLabel('Language of the invoice').selectOption(fixture.locale);
  await page.getByTestId('invoice-scan-file').setInputFiles({
    name: `${fixture.name}.png`,
    mimeType: 'image/png',
    buffer: await picture(page, fixture),
  });
  await expect(page.getByTestId('invoice-scan-progress')).toBeVisible();
  await expect(card(page, 'total')).toBeVisible(READ);
}

/** The person goes down the page and confirms each field as it stands. */
async function confirmAll(page: Page) {
  for (const key of ['total', 'currency', 'dueDate', 'bank', 'reference', 'vat']) {
    await card(page, key).getByLabel('I have compared this with the page').check();
  }
}

for (const fixture of [svStandard, daStandard, deStandard, enStandard]) {
  test(`a photographed ${fixture.locale} invoice: every field found, shown where, kept only when confirmed`, async ({
    page,
  }) => {
    await readPicture(page, fixture);
    const want = expectedValues(fixture);

    // Each field is found, with its check digit where it has one.
    for (const [key, value] of Object.entries(want)) {
      await expect(card(page, key), key).toHaveAttribute('data-value', value);
    }
    await expect(card(page, 'bank')).toHaveAttribute('data-check', 'passed');
    await expect(card(page, 'reference')).toHaveAttribute('data-check', 'passed');
    await expect(page.getByTestId('inv-bank-status')).toContainText('Check digit holds');
    await expect(page.getByTestId('inv-reference-status')).toContainText('Check digit holds');

    // The page shows where the amount was found: the outline sits on the figure in the picture.
    await card(page, 'total').getByRole('button', { name: 'Show on page' }).click();
    const mark = page.getByTestId('invoice-scan-mark');
    await expect(mark).toHaveAttribute('data-field', 'total');
    const sheet = (await page.getByTestId('invoice-scan-sheet').boundingBox())!;
    const box = (await mark.boundingBox())!;
    const figure = fixture.items.find(
      (i) => i.text.replace(/[^\d]/g, '').length > 0 && i.x === 0.8 && i.size === 0.018,
    )!;
    const centreX = (box.x + box.width / 2 - sheet.x) / sheet.width;
    const centreY = (box.y + box.height / 2 - sheet.y) / sheet.height;
    expect(centreX).toBeGreaterThan(figure.x);
    expect(centreX).toBeLessThan(figure.x + 0.2);
    expect(Math.abs(centreY - (figure.y + 0.009))).toBeLessThan(0.02);

    // Nothing is kept until every field is confirmed.
    const keep = page.getByTestId('invoice-scan-keep');
    await expect(keep).toBeDisabled();
    await confirmAll(page);
    await expect(keep).toBeEnabled();
    await keep.click();

    const kept = page.getByTestId('invoice-scan-kept');
    await expect(kept).toBeVisible();
    await expect(page.getByTestId('invoice-scan-note')).toContainText(fixture.expected.currency);
    await expect(page.getByTestId('invoice-scan-note')).toContainText(
      fixture.expected.bank.account,
    );

    // The record that comes down is the one reviewed, in exact minor units.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download JSON' }).click(),
    ]);
    const record = JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      version: 1,
      total: fixture.expected.total,
      currency: fixture.expected.currency,
      dueDate: fixture.expected.dueDate,
      bank: fixture.expected.bank,
      reference: { kind: fixture.expected.reference.kind, value: fixture.expected.reference.value },
      vat: fixture.expected.vat,
      keptDespiteFailedCheck: [],
    });
  });
}

test('a wrong payment reference is flagged, cannot be kept by confirming, and is put right by the person', async ({
  page,
}) => {
  await readPicture(page, svWrongReference);

  // The check digit of 202611498 does not hold; the screen says so in words and in the card.
  await expect(card(page, 'reference')).toHaveAttribute('data-check', 'failed');
  await expect(card(page, 'reference')).toHaveAttribute('data-value', 'ocr:202611498');
  await expect(page.getByTestId('inv-reference-status')).toContainText('Check digit does not hold');

  // Every other field is right, and confirmed; the reference is confirmed too — and still blocks.
  await confirmAll(page);
  await expect(card(page, 'reference')).toHaveAttribute('data-ready', 'no');
  await expect(page.getByTestId('invoice-scan-keep')).toBeDisabled();
  await expect(page.getByTestId('invoice-scan-blocked')).toContainText('1');

  // The person types the number as the paper prints it: the check digit holds, and it can be kept.
  const reference = card(page, 'reference');
  await reference.getByLabel('Value as it should read').fill('2026 1149 7');
  await expect(reference).toHaveAttribute('data-check', 'passed');
  await expect(reference).toHaveAttribute('data-ready', 'no'); // an edit takes the confirmation back
  await reference.getByLabel('I have compared this with the page').check();
  await expect(page.getByTestId('invoice-scan-keep')).toBeEnabled();
});

test('a failed check digit can be kept only by a separate decision, which the record admits', async ({
  page,
}) => {
  await readPicture(page, svWrongReference);
  await confirmAll(page);
  await expect(page.getByTestId('invoice-scan-keep')).toBeDisabled();
  await card(page, 'reference')
    .getByLabel('Keep it although its check digit does not hold')
    .check();
  await page.getByTestId('invoice-scan-keep').click();
  await expect(page.getByTestId('invoice-scan-kept')).toContainText(
    'Kept although the check digit failed: Payment reference',
  );
});

test('a PDF with a text layer is read without optical reading, field for field', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('invoice-scan-file').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(invoicePdf(svStandard), 'latin1'),
  });
  await expect(card(page, 'total')).toBeVisible(READ);
  for (const [key, value] of Object.entries(expectedValues(svStandard))) {
    await expect(card(page, key), key).toHaveAttribute('data-value', value);
  }
});

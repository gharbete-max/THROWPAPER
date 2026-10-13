import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * Send — phase "Send" of `docs/plan/DOCUMENTS.md`. Any part's PDF, or a Word file as it was
 * brought in, goes through a confirmation and only then into the mail queue; nothing is queued by
 * looking, going back, or pressing nothing. The e2e server mails through the console provider, so
 * what it reports is a test: written, not delivered. Counted in the `jobs` table, which is where a
 * queued message lives until the worker hands it to the provider.
 */
const sql = db();
const TAG = `e2e-${Date.now()}`;

test.afterAll(async () => {
  await sql`delete from jobs where kind = 'send.document' and payload->>'subject' like ${`%${TAG}%`}`;
  await sql.end();
});

const jobs = (tag: string) =>
  sql`select status, payload, result from jobs
      where kind = 'send.document' and payload->>'subject' like ${`%${tag}%`}
      order by created_at`;

async function signedIn(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
}

test('a PDF arranged in Scan is sent: confirmation first, nothing queued before the press', async ({
  page,
}) => {
  const tag = `${TAG}-scan`;
  const subject = `Arranged ${tag}`;
  await signedIn(page);
  await page.goto('/scan');
  await page.getByTestId('scan-files').setInputFiles({
    name: 'one.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Scan page'),
  });
  await expect(page.getByRole('list', { name: 'Arrange pages' }).getByRole('listitem')).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: 'Send this PDF' }).click();

  // Arrived with the file in route state, not in the address.
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.getByTestId('send-file-name')).toContainText('loppa.pdf');
  await expect(page.getByTestId('send-mode')).toHaveAttribute('data-mode', 'test');

  await page.getByLabel('To', { exact: true }).fill('bo@example.com, asa@example.com');
  await page.getByLabel('Subject').fill(subject);
  await page.getByLabel('Short message').fill('Here it is.');
  await page.getByRole('button', { name: 'Review before sending' }).click();

  // The confirmation shows exactly what will go, and to whom.
  const confirm = page.getByTestId('send-confirm');
  await expect(confirm.getByRole('heading', { name: 'Send this to 2 people?' })).toBeVisible();
  await expect(page.getByTestId('send-confirm-to')).toHaveText('bo@example.com, asa@example.com');
  await expect(page.getByTestId('send-confirm-subject')).toHaveText(subject);
  await expect(page.getByTestId('send-confirm-file')).toContainText('loppa.pdf');
  await expect(page.getByTestId('send-mode')).toContainText('Test mode');
  expect(await jobs(tag)).toHaveLength(0);

  // Going back and forward again does not send either.
  await page.getByRole('button', { name: 'Back and change' }).click();
  await page.getByRole('button', { name: 'Review before sending' }).click();
  expect(await jobs(tag)).toHaveLength(0);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  const table = page.getByTestId('send-status');
  await expect(table.getByRole('row', { name: /bo@example.com/ })).toContainText(
    'Written to the test place',
  );
  await expect(table.getByRole('row', { name: /asa@example.com/ })).toContainText(
    'Written to the test place',
  );

  const sent = await jobs(tag);
  expect(sent).toHaveLength(2);
  for (const job of sent) {
    expect(job['status']).toBe('done');
    expect(job['result']).toMatchObject({ provider: 'console', filename: 'loppa.pdf' });
    expect(Number(job['result']['bytes'])).toBeGreaterThan(100);
  }
});

test('a Word file is sent as it was brought in, and a test goes only to me', async ({ page }) => {
  const tag = `${TAG}-word`;
  const subject = `Word ${tag}`;
  const docx = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(300, 7)]);
  await signedIn(page);
  await page.goto('/send');
  await page.getByTestId('send-file').setInputFiles({
    name: 'Offert.docx',
    mimeType: 'application/octet-stream',
    buffer: docx,
  });
  await expect(page.getByText('A Word file is sent as it was brought in.')).toBeVisible();
  await page.getByLabel('To', { exact: true }).fill('kund@example.com');
  await expect(page.getByLabel('Subject')).toHaveValue('Offert');
  await page.getByLabel('Subject').fill(subject);
  await page.getByRole('button', { name: 'Review before sending' }).click();
  await expect(page.getByTestId('send-confirm-file')).toContainText('Offert.docx');

  await page.getByLabel(/Send as a test to me/).check();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('send-status').getByRole('row', { name: /@/ })).toContainText(
    'Written to the test place',
  );

  const [job] = await jobs(tag);
  expect(job!['payload']['subject']).toBe(`[TEST] ${subject}`);
  expect(job!['payload']['to']).toBe('admin@example.com');
  expect(job!['result']).toMatchObject({ filename: 'Offert.docx', bytes: docx.length });
});

test('a list of three becomes three previewed, confirmed and queued PDFs', async ({ page }) => {
  const tag = `${TAG}-rent`;
  const subject = `Rent ${tag} {{name}}`;
  await signedIn(page);
  await page.goto('/send');
  await page.getByRole('radio', { name: 'One each, from a list' }).click();

  await page
    .getByTestId('batch-text')
    .fill(
      [
        'Namn;E-post;Hyra;OCR',
        'Åsa Ek;asa@example.com;"1 234,50";1001',
        'Bo Berg;bo@example.com;999;1002',
        'Cia Ceder;cia@example.com;0,10;1003',
      ].join('\n'),
    );
  await expect(page.getByTestId('batch-count')).toHaveText('3 rows');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Heading').fill('Rent for {{name}}');
  await page.getByLabel('Description line').fill('Rent, reference {{reference}}');
  // A rate nobody typed is not assumed: the way on is closed until it is.
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByLabel('Subject').fill(subject);
  await expect(page.getByTestId('batch-problems')).toContainText('Type a VAT rate');
  await page.getByLabel('VAT rate (%)').fill('25');
  await page.getByRole('button', { name: 'Next' }).click();

  // Each recipient's own PDF, drawn in the page.
  const preview = page.getByTestId('batch-preview');
  for (const name of ['Åsa Ek', 'Bo Berg', 'Cia Ceder']) {
    await preview
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('button')
      .click();
    await expect(page.getByTestId('batch-frame')).toHaveAttribute(
      'aria-label',
      `Preview of the PDF for ${name}`,
    );
    await expect(page.getByTestId('batch-frame').locator('canvas').first()).toBeVisible();
  }
  await expect(page.getByTestId('batch-seen')).toHaveText('Previewed 3 of 3');

  // Sorted by amount it is a number order, 0,10 before 999 before 1 234,50.
  await preview.getByRole('button', { name: 'Amount' }).click();
  await expect(preview.locator('tbody tr td:nth-child(1)')).toHaveText([
    'Cia Ceder',
    'Bo Berg',
    'Åsa Ek',
  ]);

  await page.getByRole('button', { name: 'Continue to confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Send 3 documents?' })).toBeVisible();
  expect(await jobs(tag)).toHaveLength(0);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  const table = page.getByTestId('send-status');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table.getByText('Written to the test place')).toHaveCount(3);

  const sent = await jobs(tag);
  expect(sent).toHaveLength(3);
  expect(sent.map((job) => job['status'])).toEqual(['done', 'done', 'done']);
  expect(sent.map((job) => job['payload']['to'])).toEqual([
    'asa@example.com',
    'bo@example.com',
    'cia@example.com',
  ]);
  expect(sent.map((job) => job['result']['filename'])).toEqual([
    'Rent for Åsa Ek.pdf',
    'Rent for Bo Berg.pdf',
    'Rent for Cia Ceder.pdf',
  ]);
});

test('a list over the cap is refused on the screen', async ({ page }) => {
  await signedIn(page);
  await page.goto('/send');
  await page.getByRole('radio', { name: 'One each, from a list' }).click();
  const header = 'name,email,amount,ref';
  const rows = Array.from({ length: 201 }, (_, i) => `P${i},p${i}@example.com,100,${i}`);
  await page.getByTestId('batch-text').fill([header, ...rows].join('\n'));
  await expect(page.getByTestId('batch-count')).toHaveText('201 rows');
  await expect(page.getByRole('alert')).toContainText('at most 200 documents');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
});

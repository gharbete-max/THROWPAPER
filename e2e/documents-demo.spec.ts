import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { fakeBridge } from './fake-model.js';
import { svStandard } from '../fixtures/invoices/invoices.js';

/**
 * The Documents demo — phase 9 of `docs/plan/DOCUMENTS.md`: a person who collects nothing can
 * scan, arrange, fill, sign, send and summarise by clicking alone. The built web app against the
 * real servers, Chromium's fake camera standing in for paper.
 *
 * What the web build cannot do, and this spec therefore does as far as it goes:
 *
 * - **Scan to Fill is not a hand-off.** Fill reads a Loppa form or a PDF's own fields; the PDF
 *   made in Scan goes to Sign or Send. So Fill is clicked in from Forms, on the seeded form.
 * - **To send is the desktop's.** This server mails through the console, so Send ends at "Written
 *   to the test place" (a `send.document` job), and the signed copy at a `signing.copy` job.
 * - **The summary is the desktop's.** `window.loppaModel` is the fake from `fake-model.ts`, and
 *   `/health` is told the edition is the desktop, as the packaged app would say, so the room offers
 *   the centre. No weights are involved; the text it returns is the fake's.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env['E2E_CHROMIUM'] ? { executablePath: process.env['E2E_CHROMIUM'] } : {}),
  },
});

const APP_ORIGIN = 'http://localhost:4173';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const file = (name: string) => fileURLToPath(new URL('../fixtures/demo/' + name, import.meta.url));
const TAG = `e2e-demo-${Date.now()}`;

const sql = db();
test.afterAll(async () => {
  await sql`delete from jobs where kind = 'send.document' and payload->>'subject' like ${`%${TAG}%`}`;
  await sql.end();
});

// pdf-lib is the API's dependency, not the root's.
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{
      getForm(): { getTextField(name: string): { getText(): string | undefined } };
    }>;
  };
};

async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
  }
  return text;
}

async function signInWithSign(page: Page): Promise<void> {
  const [organisation] = await sql`select organisation_id from users
    where email = 'admin@example.com' limit 1`;
  const sign = postgres(signDatabaseUrl(DATABASE_URL), { max: 1, onnotice: () => {} });
  try {
    await sign`insert into service_tokens (organisation_id, name, token_sha256, allowed_origins)
      values (${String(organisation!['organisation_id'])}, 'forms-e2e',
              ${createHash('sha256').update(E2E_SIGN_SERVICE_TOKEN).digest('hex')},
              array[${APP_ORIGIN}]::text[])
      on conflict (token_sha256) do nothing`;
  } finally {
    await sign.end();
  }
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
}

test('scan, arrange, sign, fill, send and summarise, by clicking alone', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await signInWithSign(page);

  // The room: Documents opens into its parts, and Scan is one of them.
  await page.goto('/room');
  await page.getByRole('link', { name: 'Documents' }).click();
  await page.getByRole('link', { name: 'Scan' }).click();
  await expect(page.getByRole('heading', { name: 'Arrange pages' })).toBeVisible();

  // Scan: two pages with the camera, then arranged.
  await page.getByRole('button', { name: 'Take photos' }).click();
  const scanner = page.getByTestId('camera-scan');
  await expect(scanner.getByRole('button', { name: 'Take page' })).toBeEnabled();
  await scanner.getByRole('button', { name: 'Take page' }).click();
  await scanner.getByRole('button', { name: 'Take page' }).click();
  await scanner.getByRole('button', { name: /^Done \(2\)$/ }).click();
  await expect(page.locator('.scan__page')).toHaveCount(2);
  await page.locator('.scan__page').nth(1).getByRole('button', { name: 'Move earlier' }).click();

  // Sign: the PDF arrives chosen; the signer signs; the signed copy is queued after a question.
  await page.getByRole('button', { name: 'Sign this PDF' }).click();
  await expect(page).toHaveURL(/\/signing$/);
  await expect(page.getByTestId('signing-handoff')).toHaveText('PDF ready: loppa.pdf');
  const documentName = `Demo ${TAG}`;
  await page.getByLabel('Document name').fill(documentName);
  await page.getByLabel('Name', { exact: true }).fill('Maja Strand');
  await page.getByLabel('Email (optional)').fill('maja.strand@example.com');
  await page.getByRole('button', { name: 'Send for signing' }).click();
  const row = page.getByTestId('signing-row').filter({ hasText: documentName });
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');

  const signer = await context.newPage();
  await signer.goto(
    (await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href'))!,
  );
  await signer.getByLabel('Your name').fill('Maja Strand');
  await signer.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByTestId('outcome')).toHaveText('Everyone has signed.');
  await signer.close();
  await row.getByRole('button', { name: 'Refresh' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Signed by everyone');
  await row.getByRole('button', { name: 'Send the signed copy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send the signed copy' }).click();
  await expect(row.getByTestId('signing-copy-queued')).toHaveText('Signed copy queued');

  // Fill: the seeded form that stands for an imported PDF, filled in and handed to Send.
  await page.getByRole('link', { name: 'Forms', exact: true }).first().click();
  await page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: /Membership application/ }) })
    .getByRole('link', { name: 'Edit form' })
    .click();
  await page.getByRole('link', { name: 'Fill in', exact: true }).click();
  await expect(page.getByText(/Fill the form in here/)).toBeVisible();
  await page.getByRole('textbox').first().fill('Maja Strand');
  await page.getByRole('button', { name: 'Send this PDF' }).click();

  // Send: reviewed, confirmed, and only then written to the test place.
  await expect(page).toHaveURL(/\/send$/);
  const subject = `Filled ${TAG}`;
  await page.getByLabel('To', { exact: true }).fill('maja.strand@example.com');
  await page.getByLabel('Subject').fill(subject);
  await page.getByRole('button', { name: 'Review before sending' }).click();
  expect(await sql`select 1 from jobs where payload->>'subject' = ${subject}`).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('send-status')).toContainText('Written to the test place');
  expect(await sql`select 1 from jobs where payload->>'subject' = ${subject}`).toHaveLength(1);

  // Summarise: back in the room, the centre opens, a sample document is read and summarised.
  await page.route('**/health', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), edition: 'desktop' },
    });
  });
  await page.addInitScript(fakeBridge);
  await page.goto('/room/documents');
  await page.getByRole('link', { name: /Summary and translation/ }).click();
  await page.getByRole('link', { name: 'Set up AI' }).click();
  await page.getByRole('button', { name: /Open a file( or an AI pack.*)? from disk/ }).click();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Summary and translation' }).click();
  await page.getByLabel('A PDF or text file').check();
  await page.getByTestId('summary-file').setInputFiles(file('summary-en.txt'));
  await page.getByRole('button', { name: 'Start' }).click();
  const result = page.getByTestId('summary-result');
  await expect(
    result.getByRole('heading', { name: 'Summary — generated on this computer' }),
  ).toBeVisible();
  await expect(result).toContainText('It is not saved');
});

test('the demo fixtures do what the demo says they do', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  // A three-page PDF saved out of order is put in order in Scan.
  await page.goto('/scan');
  await page.getByTestId('scan-files').setInputFiles(file('arrange-me.pdf'));
  await expect(page.locator('.scan__page')).toHaveCount(3);
  await page.locator('.scan__page').nth(0).getByRole('button', { name: 'Move later' }).click();
  await page.locator('.scan__page').nth(1).getByRole('button', { name: 'Move later' }).click();
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  const arranged = await pdfText(await readFile(await (await saving).path()));
  expect(arranged.indexOf('Sida 1')).toBeGreaterThanOrEqual(0);
  expect(arranged.indexOf('Sida 1')).toBeLessThan(arranged.indexOf('Sida 2'));
  expect(arranged.indexOf('Sida 2')).toBeLessThan(arranged.indexOf('Sida 3'));

  // A PDF with fields of its own is filled in and kept as a PDF.
  await page.goto('/forms/pdf');
  await page.getByTestId('fill-pdf-file').setInputFiles(file('form-to-fill.pdf'));
  await page.getByRole('textbox').first().fill('Ida Test');
  const keeping = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Keep as PDF' }).click();
  const filled = await readFile(await (await keeping).path());
  const reopened = await PDFDocument.load(filled);
  expect(reopened.getForm().getTextField('name').getText()).toBe('Ida Test');

  // The invoice picture is read by the invoice scan, as the invoice it is drawn from.
  await page.goto('/scan');
  await page.getByTestId('scan-invoice-open').click();
  await page.getByLabel('Language of the invoice').selectOption('sv-SE');
  await page.getByTestId('invoice-scan-file').setInputFiles(file('invoice-sample.png'));
  const total = page.locator('fieldset[data-field="total"]');
  await expect(total).toHaveAttribute('data-value', svStandard.expected.total, {
    timeout: 120_000,
  });

  // The list for Send/batch is read: four invented people, none of them a problem.
  await page.goto('/send');
  await page.getByRole('radio', { name: 'One each, from a list' }).click();
  await page.getByTestId('batch-text').fill((await readFile(file('batch.csv'), 'utf8')).trim());
  await expect(page.getByTestId('batch-count')).toHaveText('4 rows');
});

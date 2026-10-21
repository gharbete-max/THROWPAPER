import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { expect, test, type Page } from '@playwright/test';
import { db, scanStep, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { tinyPdf } from './pdf.js';

/**
 * DOCUMENTS phase 6: a PDF made in Arrange pages is handed to Signing already chosen, signed, and
 * its sealed copy queued to the signer; and a request is cancelled after a confirmation, after
 * which its link refuses. Forms and Sign are separate servers, talking only CONTRACT §5.
 */
const APP_ORIGIN = 'http://localhost:4173';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

async function connectAndSignIn(page: Page): Promise<void> {
  const sql = db();
  try {
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
  } finally {
    await sql.end();
  }
}

/** Arrange pages → "Sign this PDF" → the request for one signer, sent. Returns its row. */
async function sendFromScan(page: Page, signer: string, email: string) {
  await page.goto('/scan');
  await page.getByTestId('scan-files').setInputFiles({
    name: 'a.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Handed over'),
  });
  await expect(page.getByText('1 pages')).toBeVisible();
  await scanStep(page, 'keep');
  await page.getByRole('button', { name: 'Sign this PDF' }).click();

  // Signing opens with the PDF already chosen, and the form already open.
  await expect(page).toHaveURL(/\/signing$/);
  await expect(page.getByTestId('signing-handoff')).toHaveText('PDF ready: loppa.pdf');
  const documentName = `Handoff ${Date.now()}`;
  await page.getByLabel('Document name').fill(documentName);
  await page.getByLabel('Name', { exact: true }).fill(signer);
  await page.getByLabel('Email (optional)').fill(email);
  await page.getByRole('button', { name: 'Send for signing' }).click();

  const row = page.getByTestId('signing-row').filter({ hasText: documentName });
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  return row;
}

test('a PDF from Arrange pages is signed, and its sealed copy is queued to the signer', async ({
  page,
  context,
}) => {
  await connectAndSignIn(page);
  const row = await sendFromScan(page, 'Åsa Öberg', 'asa@example.com');

  const signer = await context.newPage();
  await signer.goto(
    (await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href'))!,
  );
  await signer.getByLabel('Your name').fill('Åsa Öberg');
  await signer.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByTestId('outcome')).toHaveText('Everyone has signed.');
  await signer.close();

  await row.getByRole('button', { name: 'Refresh' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Signed by everyone');
  await expect(row.getByTestId('signing-copy-queued')).toHaveCount(0);

  // Nothing is queued by the first press: it asks, and declining changes nothing.
  await row.getByRole('button', { name: 'Send the signed copy' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 signers');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row.getByTestId('signing-copy-queued')).toHaveCount(0);

  await row.getByRole('button', { name: 'Send the signed copy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send the signed copy' }).click();
  await expect(row.getByTestId('signing-copy-queued')).toHaveText('Signed copy queued');

  // The worker handed it to the configured provider (the console, here), sealed PDF attached.
  const sql = db();
  try {
    await expect
      .poll(
        async () =>
          (
            await sql`select status from jobs where kind = 'signing.copy'
              order by created_at desc limit 1`
          )[0]?.['status'],
        { timeout: 20_000 },
      )
      .toBe('done');
  } finally {
    await sql.end();
  }
});

test('a cancelled request refuses its signer and shows as cancelled', async ({ page, context }) => {
  await connectAndSignIn(page);
  const row = await sendFromScan(page, 'Per Ärlig', 'per@example.com');
  const link = (await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href'))!;

  // Asked first; declining leaves it waiting.
  await row.getByRole('button', { name: 'Cancel request' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Nobody will be able to sign it any more');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');

  await row.getByRole('button', { name: 'Cancel request' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Cancelled');
  await expect(row.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Open signing page' })).toHaveCount(0);

  // The link the signer already has no longer signs.
  const signer = await context.newPage();
  await signer.goto(link);
  await expect(signer.getByTestId('outcome')).toHaveText('The sender has cancelled this.');
  await expect(signer.getByRole('button', { name: 'Sign', exact: true })).toHaveCount(0);
});

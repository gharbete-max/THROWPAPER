import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { tinyPdf } from './pdf.js';

/**
 * Signing as a three-step road (`docs/plan/EASY.md`, E6): the paper, who signs, then send. Two
 * people, no panel opened; the settings stay behind "More options"; a request is a status card.
 */
const APP_ORIGIN = 'http://localhost:4173';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

test('two people sign a paper in three steps, and the request is a status card @smoke', async ({
  page,
}) => {
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

  const documentName = `Easy ${Date.now()}`;
  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();

  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeDisabled();
  await page.getByLabel('PDF file').setInputFiles({
    name: `${documentName}.pdf`,
    mimeType: 'application/pdf',
    buffer: tinyPdf('Easy'),
  });
  await next.click();

  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('Anna');
  await page.getByRole('button', { name: 'Add signer' }).click();
  await page.getByLabel('Name', { exact: true }).nth(1).fill('Bo');
  await next.click();

  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  // Routing, declaration and mode are behind "More options", closed.
  await expect(page.getByRole('combobox', { name: 'Declaration', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await next.click();
  await page.getByRole('button', { name: 'Send for signing' }).click();

  const card = page.getByTestId('signing-row').filter({ hasText: documentName });
  await expect(card.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  await expect(card).toContainText('Waiting for Anna');
});

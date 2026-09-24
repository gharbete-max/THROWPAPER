import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { tinyPdf } from './pdf.js';
import { extractSeal, opensslVerify } from '../apps/api-sign/src/sealing/openssl-validator.js';

/**
 * P1c-3 through the Forms app: an operator uploads a PDF on the Signing screen, the signer opens
 * their link, signs, and the operator downloads a sealed file an independent validator accepts.
 * Forms and Sign are separate servers here, talking only CONTRACT §5.
 */
const APP_ORIGIN = 'http://localhost:4173';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

test('an operator sends a PDF for signing and downloads it sealed', async ({ page, context }) => {
  const sql = db();
  try {
    // Register Forms' token with Sign, for the seeded organisation, allowed to call back to Forms.
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

  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Lease e2e.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Lease from Forms'),
  });
  await expect(page.getByLabel('Document name')).toHaveValue('Lease e2e');
  await page.getByLabel('Name', { exact: true }).fill('Åsa Öberg');
  await page.getByRole('button', { name: 'Send for signing' }).click();

  const row = page.getByTestId('signing-row').filter({ hasText: 'Lease e2e' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  const signUrl = await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href');
  expect(signUrl).toMatch(/\/s\//);

  // The signer, in a tab of their own.
  const signer = await context.newPage();
  await signer.goto(signUrl!);
  await signer.getByLabel('Your name').fill('Åsa Öberg');
  await signer.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByTestId('outcome')).toHaveText('Everyone has signed.');
  await signer.close();

  // Sign's hook already told Forms; Refresh asks §5.2 again either way.
  await row.getByRole('button', { name: 'Refresh' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Signed by everyone');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download signed PDF' }).click(),
  ]);
  const bytes = new Uint8Array(await readFile((await download.path())!));
  const seal = extractSeal(bytes);
  expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);
});

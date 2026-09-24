import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, test, type Page } from '@playwright/test';
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

async function connectAndSignIn(page: Page): Promise<void> {
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
}

test('an operator sends a PDF for signing and downloads it sealed', async ({ page, context }) => {
  await connectAndSignIn(page);

  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Lease e2e.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Lease from Forms'),
  });
  await expect(page.getByLabel('Document name')).toHaveValue('Lease e2e');
  await page.getByLabel('Name', { exact: true }).fill('Åsa Öberg');
  await page.getByLabel('Email (optional)').fill('asa@example.com');
  // P1c-4b: the invitation goes by email too — after a second, worded confirmation (rule 7).
  await page.getByRole('checkbox', { name: /Email each signer their link/ }).check();
  await page.getByRole('button', { name: 'Send for signing' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 signers');
  await dialog.getByRole('button', { name: 'Send and email' }).click();

  const row = page.getByTestId('signing-row').filter({ hasText: 'Lease e2e' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  await expect(row.getByTestId('signing-emailed')).toHaveText('Emailed');
  // The worker sent it through the configured provider (the console, here).
  const mail = db();
  try {
    await expect
      .poll(
        async () =>
          (
            await mail`select status from jobs where kind = 'signing.invite'
              order by created_at desc limit 1`
          )[0]?.['status'],
        { timeout: 20_000 },
      )
      .toBe('done');
  } finally {
    await mail.end();
  }
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

test("an admin writes the organisation's own declaration and sends a real signing on it", async ({
  page,
  context,
}) => {
  await connectAndSignIn(page);
  // Placeholder words typed by the test, standing in for what a person in the organisation writes.
  const words = `[e2e words ${Date.now()}]`;

  await page.goto('/signing');
  await page.getByRole('button', { name: 'Declarations' }).click();
  await page.getByRole('button', { name: 'New declaration' }).click();
  const editor = page.getByRole('form', { name: 'Write a declaration' });
  await editor.getByLabel('Short name').fill('e2e-terms');
  for (const box of await editor.locator('textarea').all()) await box.fill(words);
  await editor.getByRole('button', { name: 'Save' }).click();
  // Nothing is stored before the second press (rule 7).
  await editor.getByRole('button', { name: 'Yes, save this version' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('e2e-terms', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Real e2e.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('A real one'),
  });
  await page.getByLabel('Name', { exact: true }).fill('Per Ärlig');
  await page.getByRole('combobox', { name: 'Declaration', exact: true }).selectOption('e2e-terms');
  await page.getByRole('combobox', { name: 'Mode' }).selectOption('production');
  const send = page.getByRole('button', { name: 'Send for signing' });
  await expect(send).toBeDisabled();
  await page.getByRole('checkbox', { name: /this is a real signing/ }).check();
  await send.click();

  const row = page.getByTestId('signing-row').filter({ hasText: 'Real e2e' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  await expect(row.getByText('Test mode')).toHaveCount(0);

  const signer = await context.newPage();
  await signer.goto(
    (await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href'))!,
  );
  await expect(signer.getByText(words)).toBeVisible();
});

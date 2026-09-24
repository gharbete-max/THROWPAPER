import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { extractSeal, opensslVerify } from '../apps/api-sign/src/sealing/openssl-validator.js';

/**
 * Paper → camera → signed PDF. Chromium's fake camera stands in for a webcam or a phone's back
 * camera: the live preview starts, two pages are taken, the corners are left where they are, the
 * scan goes to Sign as a PDF, the signer signs, and the sealed file verifies.
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

test('a paper document scanned with the camera is sent, signed and sealed', async ({
  page,
  context,
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

  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page.getByRole('radio', { name: 'Camera' }).click();

  const scanner = page.getByTestId('camera-scan');
  const shutter = scanner.getByRole('button', { name: 'Take page' });
  await expect(shutter).toBeVisible();
  // The fake camera's frames have arrived when the preview has a size.
  await expect
    .poll(() => scanner.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await shutter.click();
  await shutter.click();
  await expect(scanner.getByRole('img', { name: /^Page \d$/ })).toHaveCount(2);
  await scanner.getByRole('button', { name: 'Done (2)' }).click();

  await page.getByLabel('Document name').fill('Scanned lease');
  await page.getByLabel('Name', { exact: true }).fill('Jon Smith');
  await page.getByRole('button', { name: 'Send for signing' }).click();

  const row = page.getByTestId('signing-row').filter({ hasText: 'Scanned lease' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  const signUrl = await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href');

  const signer = await context.newPage();
  await signer.goto(signUrl!);
  await signer.getByLabel('Your name').fill('Jon Smith');
  await signer.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByTestId('outcome')).toHaveText('Everyone has signed.');
  await signer.close();

  await row.getByRole('button', { name: 'Refresh' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Signed by everyone');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download signed PDF' }).click(),
  ]);
  const bytes = new Uint8Array(await readFile((await download.path())!));
  const seal = extractSeal(bytes);
  expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);
  // Two scanned pages and the audit page.
  const pageObjects =
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type\s*\/Page(?!s)/g) ?? [];
  expect(pageObjects.length).toBeGreaterThanOrEqual(3);
});

test("pages from a flatbed scanner's own software are sent as a scan", async ({ page }) => {
  const sql = db();
  try {
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
  } finally {
    await sql.end();
  }
  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();

  // What a scanner saves: a JPEG per page. Drawn in the browser: a light page, a little
  // tilted, on a dark lid — so the corner guess has something to find.
  const jpeg = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(420, 600);
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(40,40,40)';
    context.fillRect(0, 0, 420, 600);
    context.fillStyle = 'rgb(240,240,235)';
    context.beginPath();
    context.moveTo(70, 50);
    context.lineTo(360, 70);
    context.lineTo(340, 550);
    context.lineTo(50, 530);
    context.closePath();
    context.fill();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const buffer = Buffer.from(jpeg, 'base64');
  await page.getByLabel('PDF file').setInputFiles([
    { name: 'Lease p1.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'Lease p2.jpg', mimeType: 'image/jpeg', buffer },
  ]);

  // They become scanned pages, straightened like a camera's.
  await expect(page.getByRole('radio', { name: 'Camera' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Document name')).toHaveValue('Lease p1');
  await page.getByLabel('Name', { exact: true }).fill('Flatbed Fredrik');
  await page.getByRole('button', { name: 'Send for signing' }).click();
  const row = page.getByTestId('signing-row').filter({ hasText: 'Lease p1' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
});

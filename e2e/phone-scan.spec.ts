import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';

/**
 * Scanning with a phone for a computer. The computer (signed in) shows a QR code; the phone — a
 * second browser signed in to nothing, phone-sized — opens the link, photographs two pages with
 * its camera and sends them; the computer collects them into the document it is sending for
 * signing. Chromium's fake camera stands in for both cameras.
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

test('pages photographed on a phone arrive on the computer and are sent for signing', async ({
  page,
  browser,
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
  await page.getByTestId('camera-scan').getByRole('button', { name: 'Use a phone' }).click();

  const panel = page.getByTestId('phone-scan');
  await expect(
    panel.getByRole('img', { name: 'QR code with the link for your phone' }),
  ).toBeVisible();
  const link = (await panel.locator('.phone-scan__link').textContent())!.trim();
  expect(link).toMatch(/\/phone-scan\/[A-Za-z0-9_-]{43}$/);
  await expect(panel.getByTestId('phone-scan-count')).toHaveText('Pages received: 0');

  // The phone: its own browser, no session, a phone's screen.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-GB',
  });
  try {
    const phone = await phoneContext.newPage();
    await phone.goto(link);
    await expect(phone.getByRole('heading', { name: 'Scan for your computer' })).toBeVisible();
    const scanner = phone.getByTestId('camera-scan');
    // The phone's page does not offer a phone.
    await expect(scanner.getByRole('button', { name: 'Use a phone' })).toHaveCount(0);
    const shutter = scanner.getByRole('button', { name: 'Take page' });
    await expect(shutter).toBeVisible();
    await expect
      .poll(() => scanner.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBeGreaterThan(0);
    await shutter.click();
    await shutter.click();
    await scanner.getByRole('button', { name: 'Done (2)' }).click();
    await expect(phone.getByTestId('phone-sent')).toContainText('The computer has 2 pages');
  } finally {
    await phoneContext.close();
  }

  await expect(panel.getByTestId('phone-scan-count')).toHaveText('Pages received: 2');
  await panel.getByRole('button', { name: 'Use the pages (2)' }).click();
  await expect(panel).toBeHidden();

  await page.getByLabel('Document name').fill('Scanned by phone');
  await page.getByLabel('Name', { exact: true }).fill('Mia Telefon');
  await page.getByRole('button', { name: 'Send for signing' }).click();
  const row = page.getByTestId('signing-row').filter({ hasText: 'Scanned by phone' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
});

test('a phone link that was never made, or has been closed, says so', async ({ page }) => {
  await page.goto(`/phone-scan/${'A'.repeat(43)}`);
  await expect(page.getByRole('alert')).toContainText('This link has expired or was closed');
});

import { expect, test } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * No live camera — here, a browser with no camera permission — must not be a dead end: the
 * scanner says why and offers the device's own camera app, through a file input with `capture`,
 * which needs neither a permission nor a secure context (a phone on a plain-HTTP address).
 */
test('without a live camera, the scanner says why and offers the device camera', async ({
  page,
}) => {
  const sql = db();
  try {
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
  } finally {
    await sql.end();
  }
  await page.goto('/signing');
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page.getByRole('radio', { name: 'Camera' }).click();

  const scanner = page.getByTestId('camera-scan');
  await expect(scanner.getByRole('status')).toContainText(/camera/i);
  const fallback = scanner.locator('input[type="file"][capture="environment"]');
  await expect(fallback).toHaveCount(1);
  await expect(scanner.getByText('Open the camera')).toBeVisible();
});

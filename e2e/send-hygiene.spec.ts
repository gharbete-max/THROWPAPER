import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * Send, looked over before it goes: a list with a mistyped domain, a repeated address and a row
 * that is no address at all is shown as a table of issues, fixed or skipped, and the confirmation
 * says how many will be sent and how many were left out. Recent recipients are offered as you
 * type, kept only in the browser; a large PDF is warned about and made smaller on request.
 */
const sql = db();
const TAG = `hyg-${Date.now()}`;
const address = (name: string, domain = 'example.com') => `${name}-${TAG}@${domain}`;
const FOOTER = 'Sender, a street. Stop: {{unsubscribe}}';

test.afterAll(async () => {
  await sql`delete from jobs where kind in ('send.campaign', 'send.document') and payload->>'subject' like ${`%${TAG}%`}`;
  await sql.end();
});

const jobs = (kind: string) =>
  sql`select payload from jobs where kind = ${kind} and payload->>'subject' like ${`%${TAG}%`}
      order by created_at`;

async function signedIn(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
}

test('a list with a typo, a repeat and a bad row: issues, fix, skip, then the counts', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/send');
  await page.getByRole('radio', { name: 'An email to a list' }).click();
  await page
    .getByTestId('batch-text')
    .fill(
      [
        'Namn;E-post',
        `Åsa Ek;${address('asa', 'gmial.com')}`,
        `Bo Berg;${address('bo')}`,
        `Bo Again;${address('bo').toUpperCase().replace('EXAMPLE.COM', 'example.com')}`,
        'Cia;not an address',
        `Dan Dal;${address('dan')}`,
        'Info;info@example.com',
      ].join('\n'),
    );
  await expect(page.getByTestId('batch-count')).toHaveText('6 rows');

  const issues = page.getByTestId('address-issues');
  await expect(issues.getByTestId('address-issue')).toHaveCount(4);
  await expect(issues.getByRole('row', { name: /not an email address/ })).toBeVisible();
  await expect(issues.getByRole('row', { name: /Same address as row 2/ })).toBeVisible();
  await expect(issues.getByRole('row', { name: /Did you mean/ })).toBeVisible();
  await expect(issues.getByRole('row', { name: /shared mailbox/ })).toBeVisible();

  // Only an address that is not one holds the list back; the rest is information or a suggestion.
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await issues
    .getByRole('row', { name: /not an email address/ })
    .getByRole('button', { name: 'Skip' })
    .click();
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  await expect(issues.getByTestId('address-issue')).toHaveCount(3);

  // The suggestion is applied only when asked for.
  await issues
    .getByRole('row', { name: /Did you mean/ })
    .getByRole('button', { name: `Change to ${address('asa', 'gmail.com')}` })
    .click();
  await expect(issues.getByTestId('address-issue')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Subject').fill(`Hello ${TAG}`);
  await page.getByLabel('Message', { exact: true }).fill('News: https://example.org/news, thanks.');
  await page.getByLabel('Footer (wording you provide)').fill(FOOTER);
  await page.getByRole('button', { name: 'Next' }).click();

  // The plain text view and the links in it, per recipient.
  await page
    .getByTestId('campaign-preview')
    .getByRole('row', { name: /Åsa Ek/ })
    .getByRole('button', { name: 'Preview' })
    .click();
  const plain = page.getByTestId('campaign-plain');
  await expect(plain.locator('pre')).toContainText('News: https://example.org/news, thanks.');
  await expect(page.getByTestId('campaign-links')).toHaveText('https://example.org/news');
  await expect(plain).toContainText('None of these links is tracked or rewritten');

  await page.getByRole('button', { name: 'Continue to confirm' }).click();
  await expect(page.getByTestId('campaign-confirm')).toBeVisible();
  // 6 rows: one skipped by hand, one repeat left out, four people (the shared mailbox included).
  await expect(page.getByTestId('campaign-counts')).toHaveText('4 will be sent, 2 skipped');
  await expect(page.getByTestId('campaign-confirm-to')).toContainText(address('asa', 'gmail.com'));
  await expect(page.getByTestId('campaign-confirm-to')).not.toContainText('gmial');
  await expect(page.getByTestId('campaign-test-first')).toBeVisible();

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('campaign-done')).toBeVisible();
  const sent = await jobs('send.campaign');
  expect(sent.map((job) => job['payload']['to']).sort()).toEqual(
    [address('asa', 'gmail.com'), address('bo'), address('dan'), 'info@example.com'].sort(),
  );
});

test('recent recipients are suggested as you type, and forgotten on request', async ({ page }) => {
  await signedIn(page);
  await page.goto('/send');
  await page.getByTestId('send-file').setInputFiles({
    name: 'one.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('One document'),
  });
  const to = page.getByLabel('To', { exact: true });
  await to.fill(`${address('ola')}, ${address('pia')}`);
  await page.getByLabel('Subject').fill(`Document ${TAG}`);
  await page.getByRole('button', { name: 'Review before sending' }).click();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('send-status')).toBeVisible();

  // A new visit: the book is in this browser, not on the server.
  await page.goto('/send');
  const box = page.getByLabel('To', { exact: true });
  await box.click();
  await box.pressSequentially(`ola-${TAG}`);
  await expect(page.getByRole('option')).toHaveText(address('ola'));
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue(`${address('ola')}, `);
  // The book never left the browser.
  const stored = await page.evaluate(() => localStorage.getItem('loppa.addressBook.v1'));
  expect(stored).toContain(address('ola'));

  const book = page.getByTestId('address-book');
  await book.locator('summary').click();
  await book.getByRole('button', { name: `Forget ${address('ola')}` }).click();
  await expect(book).toContainText(address('pia'));
  await expect(book).not.toContainText(address('ola'));

  await book.getByRole('button', { name: 'Forget all' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Forget all' }).click();
  await expect(book).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('loppa.addressBook.v1'))).toBeNull();
});

test('a PDF over 10 MB is warned about, and Make smaller shrinks it', async ({ page }) => {
  await signedIn(page);
  await page.goto('/send');
  await page.getByTestId('send-file').setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Big document', 0, 11 * 1024 * 1024),
  });
  await page.getByLabel('To', { exact: true }).fill(address('big'));
  await page.getByLabel('Subject').fill(`Big ${TAG}`);
  await page.getByRole('button', { name: 'Review before sending' }).click();

  const size = page.getByTestId('attachment-size');
  await expect(size).toContainText('This file is large (11.0 MB)');
  await page.getByRole('button', { name: 'Make smaller' }).click();
  await expect(page.getByTestId('attachment-shrunk')).toContainText(
    'Made smaller: 11.0 MB to 0.1 MB',
  );
  await expect(page.getByTestId('send-confirm-file')).toContainText('big.pdf · 0.1 MB');
  await expect(page.getByRole('button', { name: 'Make smaller' })).toHaveCount(0);
});

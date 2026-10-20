import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * Send — phase "Campaigns" of `docs/plan/DOCUMENTS.md`: one plain email to each person on a list.
 * A list of three is previewed per person, goes through a confirmation, and only then is queued;
 * an address on the suppression list is left out and said so; and a campaign unsubscribe leaves a
 * one-off document to the same address alone. The e2e server mails through the console provider,
 * so what it reports is a test: written, not delivered.
 */
const sql = db();
const TAG = `e2e-${Date.now()}`;
const address = (name: string) => `${name}-${TAG}@example.com`;
// Stand-ins for the sender's own words: the product writes none of them.
const FOOTER = 'Sender, a street. Stop: {{unsubscribe}}';

test.afterAll(async () => {
  await sql`delete from jobs where kind in ('send.campaign', 'send.document') and payload->>'subject' like ${`%${TAG}%`}`;
  await sql`delete from campaign_suppressions where email like ${`%-${TAG}@example.com`}`;
  await sql.end();
});

const jobs = (tag: string, kind = 'send.campaign') =>
  sql`select status, payload, result from jobs
      where kind = ${kind} and payload->>'subject' like ${`%${tag}%`}
      order by created_at`;

async function signedIn(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
}

async function organisationId(): Promise<string> {
  const [row] = await sql`select organisation_id from users where email = 'admin@example.com'`;
  return String(row!['organisation_id']);
}

/** The list step: a pasted CSV of three, one of them without a name. */
async function pasteList(page: Page) {
  await page.goto('/send');
  await page.getByRole('radio', { name: 'An email to a list' }).click();
  await page
    .getByTestId('batch-text')
    .fill(
      [
        'Namn;E-post',
        `Åsa Ek;${address('asa')}`,
        `Bo Berg;${address('bo')}`,
        `;${address('cia')}`,
      ].join('\n'),
    );
}

test('a list of three: refused without a footer, previewed per person, confirmed, then queued', async ({
  page,
}) => {
  const tag = `${TAG}-three`;
  await signedIn(page);
  await pasteList(page);
  await expect(page.getByTestId('batch-count')).toHaveText('3 rows');
  await expect(page.getByTestId('campaign-audience')).toHaveText('3 people will get this email');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Subject').fill(`Hello ${tag} {{name | friend}}`);
  await page
    .getByLabel('Message', { exact: true })
    .fill('Dear {{name | there}}, here is the news.');
  // The footer opens as a skeleton of [placeholders]: no way on until they are written over.
  await expect(page.getByLabel('Footer (wording you provide)')).toHaveValue(
    /\[Your postal address\]/,
  );
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByTestId('campaign-problems')).toContainText('[Your name or organisation]');
  // Emptied, it is refused too: the product writes none for you.
  await page.getByLabel('Footer (wording you provide)').fill('');
  await expect(page.getByTestId('campaign-problems')).toContainText('Write the footer.');
  // A footer without the unsubscribe link is not enough either.
  await page.getByLabel('Footer (wording you provide)').fill('Sender, a street.');
  await expect(page.getByTestId('campaign-problems')).toContainText('must contain {{unsubscribe}}');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByLabel('Footer (wording you provide)').fill(FOOTER);
  await page.getByRole('button', { name: 'Next' }).click();

  // Each person's own message, with the fields filled in and their fallback where the list is empty.
  const preview = page.getByTestId('campaign-preview');
  await preview
    .getByRole('row', { name: /Åsa Ek/ })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(page.getByTestId('campaign-message')).toContainText('Hello');
  await expect(page.getByTestId('campaign-message')).toContainText('Dear Åsa Ek,');
  await expect(page.getByTestId('campaign-message')).toContainText('unsubscribe link');
  await preview
    .getByRole('row', { name: /Bo Berg/ })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(page.getByTestId('campaign-message')).toContainText('Dear Bo Berg,');
  await preview
    .getByRole('row', { name: new RegExp(address('cia')) })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(page.getByTestId('campaign-message')).toContainText('Dear there,');
  await expect(page.getByTestId('campaign-message')).toContainText(`Hello ${tag} friend`);
  await expect(page.getByTestId('campaign-seen')).toHaveText('Previewed 3 of 3');

  // A test to myself: one message, to me, marked, with nothing else queued.
  await preview
    .getByRole('row', { name: /Åsa Ek/ })
    .getByRole('button', { name: 'Send me a test' })
    .click();
  await expect.poll(async () => (await jobs(tag)).length).toBe(1);
  const [test1] = await jobs(tag);
  expect(test1!['payload']['to']).toBe('admin@example.com');
  expect(test1!['payload']['subject']).toBe(`[TEST] Hello ${tag} Åsa Ek`);

  await page.getByRole('button', { name: 'Continue to confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Send to 3 people?' })).toBeVisible();
  await expect(page.getByTestId('campaign-confirm')).toContainText(FOOTER);
  await expect(page.getByTestId('send-mode')).toContainText('Test mode');
  expect(await jobs(tag)).toHaveLength(1);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  const table = page.getByTestId('send-status');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table.getByText('Written to the test place')).toHaveCount(3);

  const sent = (await jobs(tag)).filter(
    (job) => !String(job['payload']['subject']).startsWith('[TEST]'),
  );
  expect(sent).toHaveLength(3);
  expect(sent.map((job) => job['status'])).toEqual(['done', 'done', 'done']);
  expect(sent.map((job) => job['payload']['to'])).toEqual([
    address('asa'),
    address('bo'),
    address('cia'),
  ]);
  // Plain text, and the one link it adds is the person's own unsubscribe link.
  for (const job of sent) {
    expect(job['payload']['text']).toContain('/api/v1/unsubscribe?t=');
    expect(job['payload']).not.toHaveProperty('html');
  }
});

test('an address on the suppression list is left out; a one-off document to it still goes', async ({
  page,
}) => {
  const tag = `${TAG}-suppressed`;
  await sql`insert into campaign_suppressions (organisation_id, email, reason)
            values (${await organisationId()}, ${address('bo')}, 'bounced')
            on conflict do nothing`;
  await signedIn(page);
  await pasteList(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Subject').fill(`Hello ${tag}`);
  await page.getByLabel('Message', { exact: true }).fill('News for {{name | you}}.');
  await page.getByLabel('Footer (wording you provide)').fill(FOOTER);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Continue to confirm' }).click();

  await expect(page.getByRole('heading', { name: 'Send to 2 people?' })).toBeVisible();
  await expect(page.getByTestId('campaign-suppressed')).toContainText('1 address is left out');
  await expect(page.getByTestId('campaign-confirm-to')).not.toContainText(address('bo'));
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('campaign-left-out')).toContainText(address('bo'));
  await expect(page.getByTestId('send-status').locator('tbody tr')).toHaveCount(2);
  const sent = await jobs(tag);
  expect(sent.map((job) => job['payload']['to'])).toEqual([address('asa'), address('cia')]);

  // Unsubscribing from a campaign: the page asks, the button records it.
  await page.goto(
    String(sent[0]!['payload']['unsubscribe']).replace(
      /^https?:\/\/[^/]+\/api/,
      'http://localhost:4001',
    ),
  );
  await page.getByRole('button', { name: 'Avsluta prenumeration' }).click();
  await expect(page.getByText('får inga fler utskick')).toBeVisible();
  const [recorded] = await sql`select reason from campaign_suppressions
    where email = ${address('asa')}`;
  expect(recorded!['reason']).toBe('unsubscribed');

  // ...and a one-off document to the same address is not a campaign: it goes.
  const documentTag = `${tag}-document`;
  await page.goto('/send');
  await page.getByTestId('send-file').setInputFiles({
    name: 'one.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('One document'),
  });
  await page.getByLabel('To', { exact: true }).fill(`${address('asa')}, ${address('bo')}`);
  await page.getByLabel('Subject').fill(`Document ${documentTag}`);
  await page.getByRole('button', { name: 'Review before sending' }).click();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  const table = page.getByTestId('send-status');
  await expect(table.getByRole('row', { name: new RegExp(address('asa')) })).toContainText(
    'Written to the test place',
  );
  await expect(table.getByRole('row', { name: new RegExp(address('bo')) })).toContainText(
    'Written to the test place',
  );
  const documents = await jobs(documentTag, 'send.document');
  expect(documents.map((job) => job['status'])).toEqual(['done', 'done']);
});

test('a list over the cap is refused on the screen', async ({ page }) => {
  await signedIn(page);
  await page.goto('/send');
  await page.getByRole('radio', { name: 'An email to a list' }).click();
  const rows = Array.from({ length: 501 }, (_, i) => `P${i},p${i}@example.com`);
  await page.getByTestId('batch-text').fill(['name,email', ...rows].join('\n'));
  await expect(page.getByTestId('batch-count')).toHaveText('501 rows');
  await expect(page.getByRole('alert')).toContainText('at most 500 people');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
});

test('the do-not-email list: add an address, see it, the campaign leaves it out, remove it after a confirmation', async ({
  page,
}) => {
  const tag = `${TAG}-screen`;
  // A clean list: the test before this one left two of this run's addresses on it.
  await sql`delete from campaign_suppressions where email like ${`%-${TAG}@example.com`}`;
  await signedIn(page);
  await pasteList(page);
  await page.getByRole('button', { name: 'Do not email list' }).click();
  const screen = page.getByTestId('suppressions');
  await expect(screen).toContainText('only stops campaigns');
  await expect(screen).toContainText('one-off documents or signing invitations');

  // Refused without a valid address; then added by hand.
  await screen.getByLabel('Address to add').fill('not-an-address');
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(screen.getByRole('alert')).toContainText('not a valid email address');
  await screen.getByLabel('Address to add').fill(address('bo'));
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  const row = screen.getByRole('row', { name: new RegExp(address('bo')) });
  await expect(row).toContainText('Added by hand');

  // The campaign built from the same list leaves that address out.
  await screen.getByRole('button', { name: 'Back to the campaign' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Subject').fill(`Hello ${tag}`);
  await page.getByLabel('Message', { exact: true }).fill('News for {{name | you}}.');
  await page.getByLabel('Footer (wording you provide)').fill(FOOTER);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Continue to confirm' }).click();
  await expect(page.getByTestId('campaign-suppressed')).toContainText('1 address is left out');
  await expect(page.getByTestId('campaign-confirm-to')).not.toContainText(address('bo'));

  // Removing asks first: Cancel keeps it, the confirmation removes it.
  await page.getByRole('button', { name: 'Do not email list' }).click();
  const remove = screen.getByRole('button', { name: `Remove ${address('bo')}` });
  await remove.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await remove.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `Remove ${address('bo')}` })
    .click();
  await expect(row).toHaveCount(0);
  const left = await sql`select 1 from campaign_suppressions where email = ${address('bo')}`;
  expect(left).toHaveLength(0);
});

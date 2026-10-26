import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { fakeBridge } from './fake-model.js';

/**
 * The summary and translation centre (ADR 0023, `docs/plan/DOCUMENTS.md` section 4).
 *
 * The page is the real built Forms app. The desktop shell's `window.loppaModel` is a fake with the
 * same interface, installed before the page loads: no model, no 2.5 GB, but every screen and every
 * rule of the pane runs — the settings step, the confirmation before a download, streaming, cancel,
 * the digit warning, the language limits, and "quote, never reword" for a consent.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

async function signIn(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
}

/** Summary says the model is missing and links to Set up AI, where a file on disk is opened. */
async function setUp(page: Page) {
  await expect(page.getByText('The model is not on this computer.')).toBeVisible();
  await page.getByRole('link', { name: 'Set up AI' }).click();
  await expect(page.getByRole('heading', { name: 'Add-ons and updates', level: 1 })).toBeVisible();
  // Nothing is downloaded, and the download says why it is off.
  await expect(page.getByRole('button', { name: 'Download' })).toBeDisabled();
  await expect(page.getByText(/There is no download for this yet/)).toBeVisible();
  await page.getByRole('button', { name: /Open a file( or an AI pack.*)? from disk/ }).click();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Summary and translation' }).click();
  await expect(page.getByRole('heading', { name: 'What to read' })).toBeVisible();
  await expect(page.getByText('The model is ready.')).toBeVisible();
}

test('without the desktop bridge the centre says it is not in this edition', async ({ page }) => {
  await signIn(page);
  await page.goto('/summary');
  await expect(page.getByRole('heading', { name: 'Summary and translation' })).toBeVisible();
  await expect(page.getByText('Not in this edition')).toBeVisible();
});

test('set up from a file on disk, summarise, translate, cancel, and see the limits @smoke', async ({
  page,
}) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/summary');

  await setUp(page);
  // A summary of pasted text streams in, is labelled as generated, and warns about an invented year.
  await page
    .getByLabel('Paste the text here')
    .fill('The fee is 120 kronor.\n\nPayment is due 2026-04-18.');
  await page.getByRole('button', { name: 'Start' }).click();
  const result = page.getByTestId('summary-result');
  await expect(
    result.getByRole('heading', { name: 'Summary — generated on this computer' }),
  ).toBeVisible();
  await expect(result).toContainText('Second point 2027.');
  await expect(result).toContainText('Numbers in the result that are not in the original: 2027');
  await expect(result).toContainText('It is not saved');

  // Icelandic cannot be written, with a reason; translating is a draft.
  const language = page.getByLabel('Into');
  await expect(language.locator('option[value="is-IS"]')).toHaveAttribute('disabled', '');
  await page.getByLabel('Translate').check();
  await expect(language.locator('option[value="is-IS"]')).toHaveAttribute('disabled', '');
  await language.selectOption('sv-SE');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Machine translation — draft' })).toBeVisible();
  await expect(page.getByTestId('summary-result')).toContainText('[sv-SE] The fee is 120 kronor.');

  // Cancel in the middle.
  await page.getByLabel('Paste the text here').fill('slow');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();

  // Nothing was sent to the server: no request carried the text.
  const sent = await page.evaluate(
    () => (window as unknown as { __fake: { jobs: number } }).__fake.jobs,
  );
  expect(sent).toBe(3);
});

test('the model list shows the model, its files and the program that runs it @smoke', async ({
  page,
}) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/ai-setup');
  await expect(page.getByRole('heading', { name: 'AI models on this computer' })).toBeVisible();
  await expect(page.getByText('AI is optional.')).toBeVisible();
  await page.getByText('Advanced', { exact: true }).click();

  const model = page.locator('[data-model="qwen2.5-vl-7b-instruct-q4_k_m"]');
  await expect(page.locator('[data-model]')).toHaveCount(1);
  await expect(model).toContainText('Not installed');
  await expect(model).toContainText('qwen-vl.gguf: not found');
  await expect(model).toContainText('mmproj.gguf: not found');
  await expect(model).toContainText('Needs about 10.0 GB of memory');
  await expect(page.getByText('put them in this folder: ')).toContainText('AppData');
  await expect(page.getByText('AI is optional.')).toBeVisible();
  await expect(
    model.getByRole('button', { name: /Open a file( or an AI pack.*)? from disk/ }),
  ).toBeEnabled();

  const runtime = page.locator('[data-runtime]');
  await expect(runtime).toContainText('llama.cpp llama-server b11741');
  await expect(runtime).toContainText('found in the AI pack beside Loppa');
  await expect(runtime).toContainText('checked');
});

test('a consent is quoted, never summarised or translated', async ({ page }) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/summary');
  await setUp(page);

  const consent =
    'Consent: I consent to my personal data being processed.\n\nI can withdraw my consent at any time, by writing to the club within 30 days.\n\nThe club keeps nothing else.';
  await page.getByLabel('Paste the text here').fill(consent);
  await expect(page.getByText(/It is not summarised or translated/)).toBeVisible();
  await expect(page.getByLabel('Into')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pick out the passages to read first' }).click();

  const result = page.getByTestId('summary-result');
  await expect(result.getByRole('heading', { name: 'Passages to read first' })).toBeVisible();
  // Exactly the original words of passage 2, cut from the pasted text.
  await expect(result.locator('blockquote')).toHaveText(
    'I can withdraw my consent at any time, by writing to the club within 30 days.',
  );
  const requests = await page.evaluate(
    () => (window as unknown as { __fake: { requests: Array<{ kind: string }> } }).__fake.requests,
  );
  expect(requests.map((r) => r.kind)).toEqual(['select']);
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * Photographs and scans through the stages — slice S14, `docs/plan/SCANS.md`. A photograph of a
 * paper form, and a scanned PDF with no text in it, given to "Start from paper": read word by word
 * by the real Tesseract, in its own worker, from this origin, then by the stages like any other
 * document, and added. Swedish, as the author who has these papers works: the interface's language
 * is what Tesseract reads beside English (`tessLangs`). The pictures are the corpus's own scans
 * (`pnpm corpus:scan`), whose frozen readings `corpus.test.ts` holds exactly; here the browser
 * reads them itself, so this checks what is read, not every confidence.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) {
    await sql`delete from builder_sessions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

// Tesseract's language data and its first page take seconds, not milliseconds.
test.setTimeout(180_000);
const READ = { timeout: 120_000 };

const REVIEW = /\/forms\/([0-9a-f-]{36})\/import$/;
const SCANS = new URL('../fixtures/documents/scans/', import.meta.url);

async function startFromPaper(page: Page): Promise<string> {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'Nytt formulär' }).first().click();
  await page.getByRole('button', { name: /Börja från papper/ }).click();
  await expect(page).toHaveURL(REVIEW);
  const formId = REVIEW.exec(page.url())![1]!;
  created.push(formId);
  await expect(page.getByRole('heading', { level: 1, name: 'Börja från papper' })).toBeVisible();
  return formId;
}

async function give(page: Page, name: string, mimeType: string) {
  await page.getByLabel('PDF, Word-dokument eller fotografi', { exact: true }).setInputFiles({
    name,
    mimeType,
    buffer: readFileSync(new URL(name, SCANS)),
  });
  // Said while it reads, page by page: OCR is slow enough to need saying.
  await expect(page.getByText(/^Läser de tryckta orden på sida 1 av 1\./)).toBeVisible();
}

const summary = (page: Page) => page.getByRole('heading', { level: 1 });
const item = (page: Page, text: string) =>
  page.locator('.review-item').filter({ hasText: text }).first();

/** Everything settled by keys, top to bottom, as the author goes through it: Enter keeps each. */
async function settle(page: Page) {
  await expect(page.locator('.review-item').first()).toBeFocused();
  const count = await page.locator('.review-item').count();
  for (let at = 0; at < count; at += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
  }
  await expect(summary(page)).toContainText('Inget behöver ses över.');
}

type Field = {
  type: string;
  label?: Record<string, string>;
  appearance?: string;
  options?: { label: Record<string, string> }[];
};
type Draft = { fields: Field[]; paper?: { sources: unknown[] } };
async function draftOf(formId: string): Promise<Draft> {
  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  return row!['draft_definition'] as Draft;
}
const sv = (field: Field | undefined) => field?.label?.['sv-SE'];

test('a photograph of a form: read by OCR, its questions on the review screen, added', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'sv-SE');
  const formId = await startFromPaper(page);
  await give(page, 'medlemsansokan.png', 'image/png');
  await expect(summary(page)).toContainText(/^Jag läste \d+ frågor\./, READ);

  // The photograph is drawn where a PDF's page would be, its lines over it.
  await expect(page.locator('.review-page__image')).toBeVisible();
  for (const question of ['Namn', 'Personnummer', 'Telefon', 'E-post', 'Underskrift']) {
    await expect(item(page, question)).toBeVisible();
  }
  // The boxes on the paper, read by Tesseract as "[", are boxes again: a yes or no.
  const newsletter = item(page, 'Vill du ha föreningens nyhetsbrev?');
  await expect(newsletter).toBeVisible();
  await expect(newsletter).not.toContainText('[');
  // A line on the picture selects its question.
  await page.locator('[data-line]', { hasText: 'Telefon' }).click();
  await expect(item(page, 'Telefon')).toHaveAttribute('aria-current', 'true');

  await page.locator('.review-item').first().focus();
  await settle(page);
  await page.getByRole('button', { name: /^Lägg till \d+ frågor$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  const draft = await draftOf(formId);
  const types = draft.fields.map((field) => field.type);
  for (const type of ['phone', 'email', 'yes_no', 'signature']) expect(types).toContain(type);
  const yesNo = draft.fields.find((field) => field.type === 'yes_no');
  expect(sv(yesNo)).toBe('Vill du ha föreningens nyhetsbrev?');
  // A photograph is not kept as paper to write answers back on (`SCANS.md` §3).
  expect(draft.paper?.sources ?? []).toEqual([]);
});

test('a scanned PDF: its page has no text, so it is read by OCR; its consents are boxes to tick', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'sv-SE');
  const formId = await startFromPaper(page);
  await give(page, 'fotosamtycke.pdf', 'application/pdf');
  await expect(summary(page)).toContainText(/^Jag läste \d+ frågor\./, READ);
  await expect(page.locator('.review-page__image')).toBeVisible();
  const consents = page.locator('.review-item').filter({ hasText: /^.*Jag samtycker till att/ });
  await expect(consents).toHaveCount(2);

  await page.locator('.review-item').first().focus();
  await settle(page);
  await page.getByRole('button', { name: /^Lägg till \d+ frågor$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  const draft = await draftOf(formId);
  const boxes = draft.fields.filter((field) => field.appearance === 'checkbox');
  expect(boxes.map(sv)).toEqual([
    'Jag samtycker till att bilder där mitt barn syns publiceras på föreningens webbplats.',
    'Jag samtycker till att bilderna sparas i föreningens arkiv.',
  ]);
  // A PDF, scanned or not, is kept with the form for its paper twin.
  expect(draft.paper?.sources).toHaveLength(1);
});

import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { linesPdf } from './pdf.js';

/**
 * Importing the same form again — `docs/plan/CONVERGENCE.md`, S12c. A form made from a document,
 * changed by hand, is brought up to date with a new version of the document: what is new is
 * added; what the document removed or reworded is asked, one decision each; what the person did is
 * never touched. And the document the form was made from, read again unchanged, changes nothing.
 */
const sql = db();
const forms: string[] = [];

test.afterAll(async () => {
  for (const id of forms) {
    await sql`delete from builder_sessions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

type Drafted = {
  id: string;
  type: string;
  label?: Record<string, string>;
  content?: Record<string, string>;
};
async function draftOf(formId: string): Promise<{ fields: Drafted[] }> {
  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  return row!['draft_definition'] as { fields: Drafted[] };
}
const words = (field: Drafted) => Object.values(field.label ?? field.content ?? {})[0] ?? '';

async function startFromPaper(page: Page): Promise<string> {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/import$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);
  return formId;
}

async function paste(page: Page, text: string) {
  await page.getByRole('button', { name: 'Paste text instead' }).click();
  await page.getByLabel('Text from your document').fill(text);
  await page.getByRole('button', { name: 'Read the text' }).click();
}

/** From the editor, the way back into the review: "Update from a document". */
async function updateFromEditor(page: Page, formId: string) {
  await page.goto(`/forms/${formId}`);
  await page.getByRole('link', { name: 'Update from a document' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/import$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Update from a document' }),
  ).toBeVisible();
}

const FIRST = 'Anmälan\n1. Namn: ____\n2. Telefon: ____\n3. Vilken dag kommer du?';
const SECOND = 'Anmälan\n1. Namn: ____\n2. E-post: ____\n3. Vilken dag kommer ni?';

test('a new version of the document: added, asked, and the hand edit kept (S12c)', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await paste(page, FIRST);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^I read 3 questions\./);
  await page.getByRole('button', { name: 'Add 3 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  // The person renames "Namn" in the editor (written as the editor saves it).
  const made = await draftOf(formId);
  const namn = made.fields.find((field) => words(field) === 'Namn')!;
  const edited = made.fields.map((field) =>
    field.id === namn.id
      ? {
          ...field,
          label: Object.fromEntries(Object.keys(field.label!).map((k) => [k, 'Ditt namn'])),
        }
      : field,
  );
  await sql`
    update forms set draft_definition = jsonb_set(draft_definition, '{fields}', ${sql.json(edited)})
     where id = ${formId}
  `;

  // The new version: "Telefon" became "E-post", and the day question is worded for more than one.
  await updateFromEditor(page, formId);
  await paste(page, SECOND);
  const changes = page.getByRole('region', { name: 'Compared with your form' });
  await expect(changes).toBeVisible();
  await expect(changes).toContainText('New in the document — added when you update');
  await expect(changes).toContainText('E-post');
  await expect(changes).toContainText('Your form: Vilken dag kommer du?');
  await expect(changes).toContainText('The document: Vilken dag kommer ni?');
  await expect(changes).toContainText('No longer in the document');
  // The hand edit is not asked about: "Namn" is the document's, unchanged there.
  await expect(changes).not.toContainText('Ditt namn');

  // Take "Telefon" out; keep the form's own wording of the day question.
  const remove = changes.getByRole('button', { name: 'Remove it from the form' });
  await expect(remove).toHaveAttribute('aria-pressed', 'false');
  await remove.click();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Update the form' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  const after = await draftOf(formId);
  expect(after.fields.map(words)).toEqual([
    'Anmälan',
    'Ditt namn',
    'E-post',
    'Vilken dag kommer du?',
  ]);
  // The trail says what the step did.
  await expect(page.getByRole('navigation', { name: 'Your answers so far' })).toContainText(
    'Updated from your document',
  );
});

test('the document the form was made from, read again unchanged, changes nothing', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  const source = linesPdf(['Anmalan', '1. Namn: ______________________________']);
  const choose = () =>
    page.getByLabel('PDF or Word document').setInputFiles({
      name: 'anmalan.pdf',
      mimeType: 'application/pdf',
      buffer: source,
    });
  await choose();
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const before = await draftOf(formId);

  await updateFromEditor(page, formId);
  await choose();
  await expect(
    page.getByText('This is the document your form was made from, and it has not changed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update the form' })).toBeDisabled();
  expect(await draftOf(formId)).toEqual(before);
});

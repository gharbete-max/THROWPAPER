import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';

/**
 * The review screen — `docs/plan/IMPORT-PIPELINE.md` §8, slice S10 — pressed. "Start from paper" on
 * a new form, a document read on this device, "I read 14 questions. 3 need your eye.", the chips,
 * merge and Undo, and "Use these questions" adding exactly what was reviewed to the form, as one
 * step in its conversation. Acceptance S4 and S5 (`PREDICTIVE-BUILDER.md`) by pointer, and each
 * again by keyboard alone, from "New form" on.
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

const REVIEW = /\/forms\/([0-9a-f-]{36})\/import$/;
const CORPUS = new URL('../fixtures/documents/', import.meta.url);

async function startFromPaper(page: Page): Promise<string> {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(REVIEW);
  const formId = REVIEW.exec(page.url())![1]!;
  created.push(formId);
  await expect(page.getByRole('heading', { level: 1, name: 'Start from paper' })).toBeVisible();
  return formId;
}

async function paste(page: Page, text: string) {
  await page.getByRole('button', { name: 'Paste text instead' }).click();
  await page.getByLabel('Text from your document').fill(text);
  await page.getByRole('button', { name: 'Read the text' }).click();
}

const summary = (page: Page) => page.getByRole('heading', { level: 1 });
const item = (page: Page, text: string) =>
  page.locator('.review-item').filter({ hasText: text }).first();

type Draft = { fields: { type: string; label?: Record<string, string>; options?: unknown[] }[] };
async function draftOf(formId: string): Promise<Draft> {
  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  return row!['draft_definition'] as Draft;
}
async function sessionLog(formId: string): Promise<{ answer: { kind: string; count?: number } }[]> {
  const [row] = await sql`select session from builder_sessions where form_id = ${formId}`;
  return (row?.['session'] as { log: { answer: { kind: string; count?: number } }[] }).log;
}
const labels = (draft: Draft) => draft.fields.map((f) => f.label?.['en-GB'] ?? '');

/** Tab until `target` has focus: how a keyboard reaches it. */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 60; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('never reached by Tab');
}

test('acceptance S4: two numbered questions pasted, a guessed type changed, then added', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await paste(page, '1. Question one\n2. Question two');

  await expect(summary(page)).toHaveText('I read 2 questions. Nothing needs your eye.');
  const second = item(page, 'Question two');
  await expect(second.getByText('Check this')).toBeVisible();
  await expect(second.getByText('I guessed the answer type — tap to change')).toBeVisible();
  await second.getByRole('button', { name: /Long text/ }).click();
  await expect(second.getByRole('button', { name: /Long text/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(second.getByText('Settled')).toBeVisible();

  await page.getByRole('button', { name: 'Add 2 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const draft = await draftOf(formId);
  expect(draft.fields.map((f) => f.type)).toEqual(['short_text', 'long_text']);
  expect(labels(draft)).toEqual(['Question one', 'Question two']);
  // One step in the form's conversation: the guided flow carries on from it, and Back undoes it.
  expect((await sessionLog(formId)).map((entry) => entry.answer)).toEqual([
    { kind: 'import', count: 2 },
  ]);
});

/** "New form", then "Start from paper", each reached by Tab and pressed with Enter. */
async function startFromPaperByKeys(page: Page): Promise<string> {
  await page.goto('/forms');
  await tabTo(page, page.getByRole('button', { name: 'New form' }).first());
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: /Start from paper/ }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(REVIEW);
  const formId = REVIEW.exec(page.url())![1]!;
  created.push(formId);
  await expect(page.getByRole('heading', { level: 1, name: 'Start from paper' })).toBeVisible();
  return formId;
}

/** "Paste text instead", the lines typed with Enter between them, and "Read the text". */
async function pasteByKeys(page: Page, lines: readonly string[]) {
  await tabTo(page, page.getByRole('button', { name: 'Paste text instead' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Text from your document'));
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await tabTo(page, page.getByRole('button', { name: 'Read the text' }));
  await page.keyboard.press('Enter');
}

test('acceptance S4 by keyboard alone', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaperByKeys(page);
  await pasteByKeys(page, ['1. Question one', '2. Question two']);

  await expect(summary(page)).toHaveText('I read 2 questions. Nothing needs your eye.');
  // The first item is selected and focused; ↓ moves, 2 picks its second chip, ↑ and Enter accept.
  await expect(item(page, 'Question one')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Question two')).toBeFocused();
  await page.keyboard.press('2');
  await expect(
    item(page, 'Question two').getByRole('button', { name: /Long text/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(item(page, 'Question one').getByText('Settled')).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Add 2 questions' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  expect((await draftOf(formId)).fields.map((f) => f.type)).toEqual(['short_text', 'long_text']);
});

test('acceptance S5: "12.1" inside a question neither starts one nor splits one', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await paste(page, '1. A thing 12.1 mentions blabla\n2. Something else');
  await expect(summary(page)).toHaveText(/^I read 2 questions\./);
  await page.getByRole('button', { name: 'Add 2 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  expect(labels(await draftOf(formId))).toEqual(['A thing 12.1 mentions blabla', 'Something else']);
});

test('acceptance S5 by keyboard alone', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaperByKeys(page);
  await pasteByKeys(page, ['1. A thing 12.1 mentions blabla', '2. Something else']);

  await expect(summary(page)).toHaveText(/^I read 2 questions\./);
  // Two items and nothing between them: ↓ goes from the first, "12.1" inside it, to the second.
  await expect(page.locator('.review-item')).toHaveCount(2);
  const first = item(page, 'A thing 12.1 mentions blabla');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Something else')).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'Add 2 questions' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  expect(labels(await draftOf(formId))).toEqual(['A thing 12.1 mentions blabla', 'Something else']);
});

/**
 * Acceptance S6 — the two doors converge (`docs/plan/CONVERGENCE.md`, S12). S5's draft, added,
 * goes on in the conversation, which asks only what the document left open: whether each must be
 * answered, never its type; never in another order.
 */
const question = (page: Page, text: string) =>
  expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();

type Walked = { type: string; required: boolean; label?: Record<string, string> };
async function walkedDraft(formId: string): Promise<Walked[]> {
  return (await draftOf(formId)).fields as unknown as Walked[];
}

async function s5Added(page: Page): Promise<string> {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await paste(page, '1. A thing 12.1 mentions blabla\n2. Something else');
  await expect(summary(page)).toHaveText(/^I read 2 questions\./);
  return formId;
}

test('acceptance S6: the imported draft walked, asked only what the document left open', async ({
  page,
}) => {
  const formId = await s5Added(page);
  await page.getByRole('button', { name: 'Add 2 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  await question(page, 'Go through the questions from your document?');
  await page.getByRole('button', { name: /Yes, one at a time/ }).click();
  // The first question: its type was the document's, so only "required" is asked.
  await question(page, 'Must everyone answer this?');
  await page.getByRole('button', { name: /No, it's optional/ }).click();
  await question(page, "Here's how it looks.");
  await expect(page.locator('.conversation__preview')).toContainText(
    'A thing 12.1 mentions blabla',
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, 'Go on to the next one?');
  await page.getByRole('button', { name: /Yes, the next question/ }).click();
  await question(page, 'Must everyone answer this?');
  await page.getByRole('button', { name: /Yes, it's needed/ }).click();
  await question(page, "Here's how it looks.");
  await expect(page.locator('.conversation__preview')).toContainText('Something else');
  await page.getByRole('button', { name: 'Continue' }).click();
  // The walk's end: the brand, then only "Add another question?" — the form has its questions.
  await question(page, 'Should this look like your organisation?');
  await page.getByRole('button', { name: /Decide later/ }).click();
  await question(page, 'Add another question?');

  // Never asked about a type: those were passed by, saying why.
  await expect(page.getByRole('heading', { name: 'Do you want buttons?' })).toHaveCount(0);
  await expect
    .poll(async () =>
      (await walkedDraft(formId)).map((f) => [f.label?.['en-GB'], f.type, f.required]),
    )
    .toEqual([
      ['A thing 12.1 mentions blabla', 'short_text', false],
      ['Something else', 'short_text', true],
    ]);
});

test('acceptance S6 by keyboard alone', async ({ page }) => {
  const formId = await s5Added(page);
  await tabTo(page, page.getByRole('button', { name: 'Add 2 questions' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  await question(page, 'Go through the questions from your document?');
  await page.keyboard.press('1');
  await question(page, 'Must everyone answer this?');
  await page.keyboard.press('2');
  await question(page, "Here's how it looks.");
  await page.keyboard.press('Enter');
  await question(page, 'Go on to the next one?');
  await page.keyboard.press('1');
  await question(page, 'Must everyone answer this?');
  await page.keyboard.press('1');
  await question(page, "Here's how it looks.");
  await page.keyboard.press('Enter');
  await question(page, 'Should this look like your organisation?');
  await page.keyboard.press('2');
  await question(page, 'Add another question?');
  await expect
    .poll(async () => (await walkedDraft(formId)).map((f) => f.required))
    .toEqual([false, true]);
});

test('what needs your eye holds "Use these questions" until it is settled', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  // A list of one is not surely a list: the question needs a look.
  await paste(page, '1) Namn');
  await expect(summary(page)).toHaveText('I read 1 question. 1 needs your eye.');
  await expect(page.getByText('Settle what needs your eye first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 1 question' })).toBeDisabled();
  // Focused, so the screen's keys are listening: both are set up by the same render.
  await expect(item(page, 'Namn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(summary(page)).toHaveText('I read 1 question. Nothing needs your eye.');

  // Another document instead: two lines with no answer space are text to read, until they are
  // made questions — never a dead end.
  await page.getByRole('button', { name: 'Read another document' }).click();
  await paste(page, 'Namn\nAdress');
  await expect(summary(page)).toHaveText('I read 0 questions. Nothing needs your eye.');
  await expect(page.getByText('Nothing was read as a question.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 0 questions' })).toBeDisabled();
  await item(page, 'Adress').click();
  await page.keyboard.press('q');
  await expect(summary(page)).toHaveText('I read 1 question. Nothing needs your eye.');
  await expect(page.getByRole('button', { name: 'Add 1 question' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(summary(page)).toHaveText('I read 0 questions. Nothing needs your eye.');
  await page.getByRole('button', { name: 'Read another document' }).click();
  await paste(page, 'ANMÄLAN\n\nNamn:\nTack!');
  await item(page, 'Tack!').click();
  await page.keyboard.press('q');
  await expect(item(page, 'Tack!').getByText('Question', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(item(page, 'Tack!').getByText('Text to read', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 1 question' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  expect((await draftOf(formId)).fields.map((f) => f.type)).toEqual([
    'section_break',
    'short_text',
    'rich_text',
  ]);
});

test('saved in another tab meanwhile: said, and nothing is added twice', async ({ page }) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await paste(page, '1. Question one\n2. Question two');
  await expect(summary(page)).toHaveText('I read 2 questions. Nothing needs your eye.');
  // Another tab saves this form's conversation after this one read it.
  await sql`
    insert into builder_sessions (form_id, user_id, organisation_id, session, version)
    select f.id, u.id, f.organisation_id, '{}'::jsonb, 1
    from forms f, users u
    where f.id = ${formId} and u.email = 'admin@example.com'`;
  await page.getByRole('button', { name: 'Add 2 questions' }).click();
  await expect(page.getByText('This form was changed in another tab or window')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add 2 questions' })).toBeDisabled();
  await expect(page).toHaveURL(REVIEW);
  const [row] = await sql`select version from builder_sessions where form_id = ${formId}`;
  expect(row!['version']).toBe(1);
});

test('a PDF: its own page, each line linked to its question both ways, merged and undone', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await page.getByLabel('PDF or Word document').setInputFiles({
    name: 'medlemsansokan.pdf',
    mimeType: 'application/pdf',
    buffer: readFileSync(new URL('medlemsansokan.pdf', CORPUS)),
  });
  await expect(summary(page)).toHaveText('I read 7 questions. Nothing needs your eye.');
  await expect(page.locator('.review-page__image')).toBeVisible();

  // A line on the page selects its question; selecting a question marks its lines on the page.
  await page.locator('[data-line="p1-l10"]').click();
  await expect(item(page, 'Telefon')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'E-post')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-line="p1-l11"]')).toHaveClass(/review-line--selected/);

  // Merged into Telefon, then undone: seven again.
  await page.keyboard.press('m');
  await expect(summary(page)).toHaveText('I read 6 questions. Nothing needs your eye.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(summary(page)).toHaveText('I read 7 questions. Nothing needs your eye.');

  await page.getByRole('button', { name: 'Add 7 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const draft = await draftOf(formId);
  expect(draft.fields.map((f) => f.type)).toEqual([
    'section_break',
    'rich_text',
    'short_text',
    'short_text',
    'long_text',
    'section_break',
    'phone',
    'email',
    'yes_no',
    'signature',
    'rich_text',
  ]);
});

test('a Word file: a grid becomes one choice per row, under what the document printed', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const formId = await startFromPaper(page);
  await page.getByLabel('PDF or Word document').setInputFiles({
    name: 'enkat-rutnat.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: readFileSync(new URL('enkat-rutnat.docx', CORPUS)),
  });
  // Two numbered questions, and a grid of three rows: three questions in the form.
  await expect(summary(page)).toHaveText('I read 5 questions. Nothing needs your eye.');
  await page.getByRole('button', { name: 'Add 5 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const optionsOf = (f: Draft['fields'][number]) =>
    ((f.options ?? []) as { label: Record<string, string> }[]).map((o) => o.label['en-GB']);
  const rows = (await draftOf(formId)).fields.filter(
    (f) => f.type === 'single_select' && optionsOf(f).join('|') === 'Ja|Nej|Vet ej',
  );
  expect(rows.map((f) => f.label?.['en-GB'])).toEqual([
    'Mötena är lagom långa',
    'Informationen når fram',
    'Lokalerna fungerar bra',
  ]);
  // The step in the conversation counts what the button said.
  expect((await sessionLog(formId)).map((entry) => entry.answer)).toEqual([
    { kind: 'import', count: 5 },
  ]);
});

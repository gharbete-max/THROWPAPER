import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { db, deleteSubmission, signInAs } from './support.js';
import { linesPdf } from './pdf.js';
import { findAnswer, see } from './pdf-read.js';

/**
 * The paper twin from an import — `docs/plan/CONVERGENCE.md`, S12b. A PDF printed with blanks is
 * read on the review screen and its questions added; the form keeps the file, and each question
 * the box it was printed with. Published and filled in, the response comes back as that paper:
 * the page as it was, each answer written inside its question's box.
 */
const sql = db();
const forms: string[] = [];
const references: string[] = [];

test.afterAll(async () => {
  for (const reference of references) await deleteSubmission(sql, reference);
  for (const id of forms) {
    await sql`delete from builder_sessions where form_id = ${id}`;
    await sql`delete from form_uploads where form_id = ${id}`;
    await sql`update forms set published_version_id = null where id = ${id}`;
    await sql`delete from form_versions where form_id = ${id}`;
    await sql`delete from forms where id = ${id}`;
  }
  await sql.end();
});

const question = (page: Page, text: string) =>
  expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();

type Anchor = { page: number; x: number; y: number; w: number; h: number };
type Drafted = { type: string; label?: Record<string, string>; paper?: Anchor };

test.use({ viewport: { width: 1280, height: 1100 } });

test('a PDF read into questions comes back filled in, as that paper (S12b)', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  const source = linesPdf([
    'Anmalan',
    '1. Namn: ______________________________',
    '2. Telefon: ______________________________',
  ]);

  // ── Read, and add ─────────────────────────────────────────────────────────────────────────
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/import$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);
  await page.getByLabel('PDF or Word document').setInputFiles({
    name: 'anmalan.pdf',
    mimeType: 'application/pdf',
    buffer: source,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^I read 2 questions\./);
  await page.getByRole('button', { name: 'Add 2 questions' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));

  // The form keeps the file, and each question its box on the page.
  const [row] = await sql`select draft_definition from forms where id = ${formId}`;
  const draft = row!['draft_definition'] as {
    fields: Drafted[];
    paper?: { sources: { key: string; pages: number }[] };
  };
  expect(draft.paper?.sources).toHaveLength(1);
  expect(draft.paper!.sources[0]!.pages).toBe(1);
  const fieldAt = (label: string) =>
    draft.fields.find((field) => field.label?.['en-GB']?.startsWith(label));
  const namn = fieldAt('Namn');
  const telefon = fieldAt('Telefon');
  for (const field of [namn, telefon]) {
    expect(field?.paper ?? null, JSON.stringify(draft.fields)).toMatchObject({ page: 0 });
  }
  // The blanks are right of their labels, one under the other.
  expect(namn!.paper!.x).toBeGreaterThan(0.1);
  expect(telefon!.paper!.y).toBeGreaterThan(namn!.paper!.y);

  // ── Publish ───────────────────────────────────────────────────────────────────────────────
  await question(page, 'Go through the questions from your document?');
  await page.getByRole('button', { name: /No, they are right as they are/ }).click();
  await question(page, 'Should this look like your organisation?');
  await page.getByRole('button', { name: /Decide later/ }).click();
  await question(page, 'Add another question?');
  await page.getByRole('button', { name: /No, that's everything/ }).click();
  await question(page, 'Your form is ready.');
  await page.getByRole('button', { name: /Open it in the editor/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));
  await page.getByRole('button', { name: 'Publish' }).first().click();
  const anyway = page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true });
  const published = page.getByText(/Version 1/).first();
  await expect(anyway.or(published).first()).toBeVisible({ timeout: 15_000 });
  if (await anyway.isVisible()) await anyway.click();
  await expect(published).toBeVisible({ timeout: 15_000 });
  const [form] = await sql`select slug from forms where id = ${formId}`;

  // ── Fill in ───────────────────────────────────────────────────────────────────────────────
  const visitor = await browser.newPage();
  await visitor.goto(`/f/${form!['slug'] as string}`);
  const name = 'Åsa Öberg-Ærø';
  const phone = '070 123 45 67';
  await visitor.getByLabel(/Namn/).fill(name);
  await visitor.getByLabel(/Telefon/).fill(phone);
  await visitor.getByRole('button', { name: /Complete|Skicka/ }).click();
  await expect(visitor.getByText(/Your reference:|Din referens:/)).toBeVisible();
  const reference = (await visitor.getByText(/Your reference:|Din referens:/).textContent())?.match(
    /[0-9A-Z]{4}-[0-9A-Z]{4}/,
  )?.[0];
  if (!reference) throw new Error('no reference');
  references.push(reference);

  // ── The organisation downloads the paper ──────────────────────────────────────────────────
  await page.goto(`/forms/${formId}/submissions`);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: `${reference}-paper.pdf` }).click();
  const paper = await readFile((await (await downloading).path())!);
  expect(paper.subarray(0, 5).toString()).toBe('%PDF-');

  // ── Read it the way a person sees it: each answer inside its question's box ───────────────
  const seen = await see(visitor, paper, []);
  expect(findAnswer(seen.runs, 'Anmalan'), JSON.stringify(seen.runs)).toBeDefined();
  for (const [answer, field, label] of [
    [name, namn!, '1. Namn:'],
    [phone, telefon!, '2. Telefon:'],
  ] as const) {
    const box = field.paper!;
    const written = findAnswer(seen.runs, answer);
    expect(written, `${answer} ${JSON.stringify(seen.runs)}`).toBeDefined();
    // On the blank printed beside its own label: that label's line, to its right — not the
    // other's line, and not merely wherever the stored box happens to say.
    const printed = findAnswer(seen.runs, label)!;
    expect(Math.abs(written!.y - printed.y), JSON.stringify(seen.runs)).toBeLessThan(0.02);
    expect(written!.x).toBeGreaterThan(printed.x + 0.05);
    expect(written!.x).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(written!.x).toBeLessThan(box.x + box.w);
    expect(written!.y).toBeGreaterThanOrEqual(box.y - 0.01);
    expect(written!.y).toBeLessThanOrEqual(box.y + box.h + 0.01);
  }
  await visitor.close();
});

test('a PDF that cannot be kept adds nothing, says so, and is one press from trying again', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/import$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);
  await page.getByLabel('PDF or Word document').setInputFiles({
    name: 'anmalan.pdf',
    mimeType: 'application/pdf',
    buffer: linesPdf(['1. Namn: ______________________________']),
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^I read 1 question\./);

  // The server cannot keep the file.
  await page.route(`**/v1/forms/${formId}/paper`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, body: '{}' })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(
    page.getByText('The questions could not be added to your form. Try again.'),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/import$`));
  const [before] = await sql`select draft_definition from forms where id = ${formId}`;
  expect((before!['draft_definition'] as { fields: unknown[] }).fields).toEqual([]);

  // It can now: the same press adds the question, with its paper.
  await page.unroute(`**/v1/forms/${formId}/paper`);
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const [after] = await sql`select draft_definition from forms where id = ${formId}`;
  const draft = after!['draft_definition'] as {
    fields: Drafted[];
    paper?: { sources: unknown[] };
  };
  expect(draft.paper?.sources).toHaveLength(1);
  expect(draft.fields.filter((field) => field.paper)).toHaveLength(1);
});

test('a form already keeping all the documents it can adds the questions, and says their answers stay off this one', async ({
  page,
}) => {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/forms');
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByRole('button', { name: /Start from paper/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/import$/);
  const formId = page.url().split('/').at(-2)!;
  forms.push(formId);
  // Twenty documents kept already: the most a form can (`Paper`, `MAX_PAPER_PAGES`).
  const sources = Array.from({ length: 20 }, (_, i) => ({
    key: `${i.toString(16).padStart(64, '0')}.pdf`,
    pages: 1,
  }));
  await sql`
    update forms
       set draft_definition = jsonb_set(draft_definition, '{paper}', ${sql.json({ sources })})
     where id = ${formId}
  `;
  await page.reload();
  let uploads = 0;
  await page.route(`**/v1/forms/${formId}/paper`, (route) => {
    if (route.request().method() === 'POST') uploads += 1;
    return route.fallback();
  });
  await page.getByLabel('PDF or Word document').setInputFiles({
    name: 'anmalan.pdf',
    mimeType: 'application/pdf',
    buffer: linesPdf(['1. Namn: ______________________________']),
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^I read 1 question\./);
  // Said before the press, not after.
  await expect(page.getByText(/already keeps 20 documents, the most it can/)).toBeVisible();
  await page.getByRole('button', { name: 'Add 1 question' }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/guided$`));
  const [after] = await sql`select draft_definition from forms where id = ${formId}`;
  const draft = after!['draft_definition'] as {
    fields: Drafted[];
    paper?: { sources: unknown[] };
  };
  expect(draft.paper?.sources).toEqual(sources);
  expect(draft.fields.map((field) => field.label?.['en-GB'])).toEqual(['Namn']);
  expect(draft.fields.every((field) => field.paper === undefined)).toBe(true);
  expect(uploads).toBe(0);
});

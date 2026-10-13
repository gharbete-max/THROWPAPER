import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db, signInAs } from './support.js';

/**
 * Forms, for a person who collects nothing — phase 3 of `docs/plan/DOCUMENTS.md`.
 *
 * A form is built Akinator-style and another by hand; each is downloaded as a PDF blank, then
 * filled in and kept as a PDF; and an existing PDF's own fields are filled in and kept. None of it
 * publishes a version or makes a submission, and the database is asked.
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

// pdf-lib is the API's dependency, not the root's, so it is loaded from there and typed by hand.
interface Lib {
  PDFDocument: {
    create(): Promise<{
      addPage(size: [number, number]): unknown;
      getForm(): {
        createTextField(name: string): { addToPage(page: unknown, box: object): void };
        createCheckBox(name: string): { addToPage(page: unknown, box: object): void };
      };
      save(): Promise<Uint8Array>;
    }>;
    load(bytes: Uint8Array): Promise<{
      getForm(): {
        getTextField(name: string): { getText(): string | undefined };
        getCheckBox(name: string): { isChecked(): boolean };
      };
    }>;
  };
}
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Lib;

async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  return text.replace(/\s+/g, '');
}

/** Presses `name` and returns the file the browser was handed. */
async function downloaded(page: Page, name: string | RegExp): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  return readFile(await (await download).path());
}

/** What collecting would have left behind: submissions, and forms with a published version. */
async function traces() {
  const [row] = await sql`
    select
      (select count(*) from submissions)::int as submissions,
      (select count(*) from form_versions)::int as versions,
      (select count(*) from forms where published_version_id is not null)::int as published
  `;
  return { ...row };
}

/** One form's own rows: it has no submission and no published version. */
async function expectUncollected(formId: string) {
  const [form] =
    await sql`select published_version_id, published_version from forms where id = ${formId}`;
  expect(form).toMatchObject({ published_version_id: null, published_version: null });
  expect(await sql`select 1 from submissions where form_id = ${formId}`).toHaveLength(0);
  expect(await sql`select 1 from form_versions where form_id = ${formId}`).toHaveLength(0);
}

/** Download, Fill in and Sign come before Share to collect, which is the quiet one. */
async function expectDemotedPublish(page: Page) {
  const order = await page.evaluate(() => {
    const at = (text: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('header .button')).find(
        (el) => el.textContent?.trim() === text,
      )!;
    const [download, fill, sign, share] = [
      'Download PDF',
      'Fill in',
      'Sign',
      'Share to collect',
    ].map(at);
    const before = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      ordered: before(download!, fill!) && before(fill!, sign!) && before(sign!, share!),
      shareIsQuiet: share!.classList.contains('button--quiet'),
      downloadIsPrimary: !download!.classList.contains('button--quiet'),
      signGoes: sign!.getAttribute('href'),
    };
  });
  expect(order).toEqual({
    ordered: true,
    shareIsQuiet: true,
    downloadIsPrimary: true,
    signGoes: '/signing',
  });
}

test('a form built Akinator-style is downloaded blank, filled in and kept, with nothing collected', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await traces();
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  // The door has an address: it arrives with the Akinator door under focus.
  await page.goto('/forms?new=questions');
  await expect(page.getByRole('button', { name: /Start from questions/ })).toBeFocused();
  await page.getByRole('button', { name: /Start from questions/ }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}\/guided$/);
  const formId = page.url().split('/').at(-2)!;
  created.push(formId);

  const heading = (text: string) => expect(page.getByRole('heading', { level: 1, name: text }));
  await page.getByRole('button', { name: /Signing people up/ }).click();
  for (const ask of ['Is it for something on a set date?', 'Will people learn something there?']) {
    await heading(ask).toBeVisible();
    await page.getByRole('button', { name: 'Not sure', exact: true }).click();
  }
  await heading('What is your form called?').toBeVisible();
  await page.getByRole('button', { name: 'Summer party', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Decide later/ }).click();
  await heading('What do you want to ask?').toBeVisible();
  await page.getByRole('button', { name: 'Which day suits you?' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Yes, it's needed/ }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: /One answer only/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // the number of options, as offered
  await page.getByRole('button', { name: 'Pill', exact: true }).click();
  await page.getByRole('button', { name: /Under the question, full width/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /No, that's everything/ }).click();
  await heading('Your form is ready.').toBeVisible();
  await page.getByRole('button', { name: /Open it in the editor/ }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));
  // The editor has loaded and has nothing left to save.
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();

  await expectDemotedPublish(page);

  // Blank: the form to write on.
  const blank = await pdfText(await downloaded(page, 'Download PDF'));
  expect(blank).toContain('Whichdaysuitsyou?');
  await expectUncollected(formId);

  // Filled in here, and kept.
  await page.getByRole('link', { name: 'Fill in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}/fill$`));
  // The screen is the lazy one, not still the editor, whose own preview has a textbox.
  await expect(page.getByText(/Fill the form in here/)).toBeVisible();
  await page.getByRole('textbox').first().fill('Åsa Öberg');
  const filled = await pdfText(await downloaded(page, 'Keep as PDF'));
  expect(filled).toContain('ÅsaÖberg');
  expect(filled).toContain('Whichdaysuitsyou?');

  await expectUncollected(formId);
  expect(await traces()).toEqual(before);
});

test('a form built by hand opens in the editor, and is downloaded blank, filled in and kept', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await traces();
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  await page.goto('/forms?new=manual');
  const stamp = Date.now().toString(36);
  await page.getByLabel('Title', { exact: true }).fill(`By hand ${stamp}`);
  await page.getByLabel('Link address').fill(`by-hand-${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  // Straight into the editor, not back to the list.
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  const formId = page.url().split('/').pop()!;
  created.push(formId);

  await page.getByRole('button', { name: 'Short text' }).first().click();
  // Download waits for the autosave, so enabled again means the field is in the draft.
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();

  const blank = await pdfText(await downloaded(page, 'Download PDF'));
  expect(blank).toContain(`Byhand${stamp}`);
  await expectUncollected(formId);

  await page.getByRole('link', { name: 'Fill in', exact: true }).click();
  // The screen is the lazy one, not still the editor, whose own preview has a textbox.
  await expect(page.getByText(/Fill the form in here/)).toBeVisible();
  await page.getByRole('textbox').first().fill('Sjöström');
  const filled = await pdfText(await downloaded(page, 'Keep as PDF'));
  expect(filled).toContain('Sjöström');

  await expectUncollected(formId);
  expect(await traces()).toEqual(before);
});

test('a PDF’s own fields are filled in and the PDF kept, with nothing collected', async ({
  page,
}) => {
  const before = await traces();
  await signInAs(page, sql, 'admin@example.com', 'en-GB');

  const doc = await PDFDocument.create();
  const sheet = doc.addPage([300, 300]);
  const form = doc.getForm();
  form.createTextField('surname').addToPage(sheet, { x: 10, y: 250, width: 200, height: 20 });
  form.createCheckBox('member').addToPage(sheet, { x: 10, y: 200, width: 20, height: 20 });
  const own = Buffer.from(await doc.save());

  await page.goto('/forms/pdf');
  await expect(page.getByRole('heading', { name: 'Fill in a PDF' })).toBeVisible();
  await page
    .getByTestId('fill-pdf-file')
    .setInputFiles({ name: 'own.pdf', mimeType: 'application/pdf', buffer: own });
  await page.getByLabel('surname').fill('Öberg');
  await page.getByLabel('member').check();
  const kept = await downloaded(page, 'Keep as PDF');
  const back = (await PDFDocument.load(new Uint8Array(kept))).getForm();
  expect(back.getTextField('surname').getText()).toBe('Öberg');
  expect(back.getCheckBox('member').isChecked()).toBe(true);

  // A signed PDF asks before its signature goes; an encrypted one is refused in words.
  const signed = Buffer.concat([own, Buffer.from('\n% /ByteRange [0 1 2 3]\n')]);
  await page
    .getByTestId('fill-pdf-file')
    .setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: signed });
  await expect(page.getByRole('dialog')).toContainText('digital signature');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove the signature and fill it in' })
    .click();
  await expect(page.getByLabel('surname')).toBeVisible();

  const encrypted = await readFile(new URL('../fixtures/pdf/encrypted.pdf', import.meta.url));
  await page
    .getByTestId('fill-pdf-file')
    .setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encrypted });
  await expect(page.getByText(/protected with a password/)).toBeVisible();

  // A PDF with no fields of its own says so, and offers the form route.
  const plain = await PDFDocument.create();
  plain.addPage([200, 200]);
  await page.getByTestId('fill-pdf-file').setInputFiles({
    name: 'plain.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await plain.save()),
  });
  await expect(page.getByText('This PDF has no fields of its own to fill in.')).toBeVisible();

  expect(await traces()).toEqual(before);
});

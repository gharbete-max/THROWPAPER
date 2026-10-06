import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  abstractList,
  docxBytes,
  list,
  numbered,
  numberingXml,
  paragraph,
  zipBytes,
} from '../apps/forms/src/screens/builder/paper/docx.fixture.js';
import { db, plantLoginToken } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * "From paper" draws the PDF it was given.
 *
 * It had no end-to-end test, and it broke without anybody seeing: pdf.js 6's default build calls
 * `Map.prototype.getOrInsertComputed` while drawing a page, which browsers only gained in 2026, so
 * the import threw in any browser a few versions old. The app now loads the legacy build. This
 * spec draws a page in whatever Chromium runs the suite — including older ones — and checks there
 * is ink on the canvas, not merely that a canvas exists.
 */
const sql = db();
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await sql`delete from forms where id = ${id}`;
  // And anything an interrupted run left behind.
  await sql`delete from forms where slug like 'papper-%' and published_version_id is null`;
  await sql.end();
});

/** Signed in, in Swedish, on a new blank form in the editor, with "From paper" open. */
async function openPaperDoor(page: Page) {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.addInitScript(() => window.localStorage.setItem('tp.locale', 'sv-SE'));
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('heading', { name: 'Evenemang' })).toBeVisible();

  await page.goto('/forms');
  await page.getByRole('button', { name: 'Nytt formulär' }).first().click();
  await page.getByRole('button', { name: /Bygga själv/ }).click();
  // A blank form, named, then opened in the editor from its card.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await page.getByLabel('Titel', { exact: true }).fill(`Blankett från papper ${stamp}`);
  await page.getByLabel('Länkadress').fill(`papper-${stamp}`);
  await page.getByRole('button', { name: 'Skapa' }).click();
  await page
    .locator('.card', { hasText: `Blankett från papper ${stamp}` })
    .getByRole('link', { name: 'Redigera formulär' })
    .click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  created.push(page.url().split('/').pop()!);
  await page.getByRole('button', { name: 'Från papper' }).click();
}

test('a PDF imported from paper is drawn on the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPaperDoor(page);

  await page.getByLabel('PDF, Word-dokument eller fotografier').setInputFiles({
    name: 'blankett.pdf',
    mimeType: 'application/pdf',
    buffer: tinyPdf('Ansokan om medlemskap'),
  });
  await expect(page.getByText('1 sida')).toBeVisible();
  await expect(page.getByText('Filen gick inte att läsa.')).toHaveCount(0);
  // Its printed line was read too, through the text layer and the import's stages.
  const reading = page.getByRole('region', { name: 'Det här läste Loppa: blankett.pdf' });
  await expect(reading.getByText('1 rad · 0 numrerade punkter')).toBeVisible();
  await page.getByRole('button', { name: 'Ersätt formuläret' }).click();

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  // Ink: some pixel on the page is dark. A canvas that failed to draw is all one colour.
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const c = element as HTMLCanvasElement;
          const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! < 100 && data[i + 1]! < 100 && data[i + 2]! < 100 && data[i + 3]! > 0) {
              dark += 1;
            }
          }
          return dark;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(50);

  expect(errors.filter((message) => /getOrInsertComputed|is not a function/.test(message))).toEqual(
    [],
  );
});

/**
 * The M4 demo (`docs/plan/ROADMAP.md`): a Word file with Word's own numbering read in order, in
 * the worker, what was read downloadable, and the form untouched — then pasted text, and a paste
 * that carries only HTML. A Word file with a DTD is refused, never read.
 */
test('a Word document and pasted text are read in order, and change nothing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await openPaperDoor(page);

  const word = docxBytes({
    body: [
      paragraph('ANMÄLAN', '', '<w:b/><w:sz w:val="32"/>'),
      numbered('Namn', 1),
      numbered('Kontakt', 1),
      numbered('Telefon', 1, 1),
      numbered('E-post', 1, 1),
      numbered('Allergier', 1),
    ].join(''),
    numbering: numberingXml(
      abstractList(0, [
        ['decimal', '%1.'],
        ['lowerLetter', '%2)'],
      ]) + list(1, 0),
    ),
  });
  await page.getByLabel('PDF, Word-dokument eller fotografier').setInputFiles({
    name: 'anmalan.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(word),
  });
  const reading = page.getByRole('region', { name: 'Det här läste Loppa: anmalan.docx' });
  await expect(reading.getByText('6 rader · 5 numrerade punkter')).toBeVisible();
  await expect(reading.locator('.import__item')).toHaveText([
    '1. Namn',
    '2. Kontakt',
    'a) Telefon',
    'b) E-post',
    '3. Allergier',
  ]);
  expect(workers.some((url) => url.includes('import.worker'))).toBe(true);

  // Nothing to import from a Word file yet: the confirmation stays shut, and says nothing about
  // replacing the form.
  await expect(page.getByRole('button', { name: 'Ersätt formuläret' })).toBeDisabled();
  await expect(page.getByText('Importen ersätter allt som finns i formuläret nu.')).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    reading.getByRole('button', { name: 'Ladda ned det som lästes' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('anmalan.reading.json');
  const file = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
    debug: { stage: string }[];
    lists: { items: { decidedBy: string }[] };
    segments: { segments: { kind: string; label?: string; answer?: string }[] };
    scored: { counts: { questions: number } };
  };
  // Stages 2 to 7, all in the worker (S9): what each part is, and how sure.
  expect(file.debug.map((d) => d.stage)).toEqual([
    'reassemble',
    'enumerate',
    'segment',
    'classify',
    'score',
  ]);
  expect(new Set(file.lists.items.map((i) => i.decidedBy))).toEqual(new Set(['W1']));
  // "Kontakt" with its lettered answers is a choice between them — a reading the review screen
  // (S10) asks about, since "Telefon" and "E-post" could as well be two questions.
  expect(
    file.segments.segments.map((s) =>
      s.kind === 'question' ? `${s.label} (${s.answer})` : s.kind,
    ),
  ).toEqual(['heading', 'Namn (unknown)', 'Kontakt (choice)', 'Allergier (unknown)']);
  expect(file.scored.counts.questions).toBe(3);

  // Pasted text, read the same way.
  await page.getByRole('button', { name: 'Klistra in text i stället' }).click();
  const box = page.getByLabel('Text från ditt dokument');
  await box.fill('1. Namn\n2. Adress\n3. Telefon');
  await page.getByRole('button', { name: 'Läs texten' }).click();
  const pasted = page.getByRole('region', { name: 'Det här läste Loppa: Inklistrad text' });
  await expect(pasted.locator('.import__item')).toHaveText(['1. Namn', '2. Adress', '3. Telefon']);

  // A paste with no plain text is read from its HTML: a list keeps its numbers.
  await box.fill('');
  await box.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/html', '<ol><li>Namn</li><li>Adress</li></ol>');
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(box).toHaveValue('1. Namn\n2. Adress');

  // A Word file with a document type declaration is refused, not read.
  const unsafe = zipBytes([
    {
      name: 'word/document.xml',
      data: '<!DOCTYPE lolz [<!ENTITY lol "lol">]><w:document xmlns:w="x"><w:body/></w:document>',
    },
  ]);
  await page.getByLabel('PDF, Word-dokument eller fotografier').setInputFiles({
    name: 'farlig.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(unsafe),
  });
  await expect(
    page.getByText('Word-dokumentet innehåller en del som kan vara osäker, så det lästes inte.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

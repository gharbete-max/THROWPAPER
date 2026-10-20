import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { linesPdf, tinyPdf } from './pdf.js';
import { fakeBridge } from './fake-model.js';
import { docxBytes, paragraph } from '../apps/forms/src/screens/builder/paper/docx.fixture.js';

/**
 * Documents as one tool (`docs/plan/DOCUMENTS.md` section 2, flow track): a file dropped anywhere in
 * the room is told apart by its bytes and arrives in the right part, with a sentence saying so; the
 * room remembers names only; a finished scan hands on to Summarise, Fill, Sign or Send; and keeping
 * a PDF asks for a name and a size first.
 */
const sql = db();
test.afterAll(async () => {
  await sql.end();
});

interface Lib {
  PDFDocument: {
    create(): Promise<{
      addPage(size: [number, number]): unknown;
      getForm(): { createTextField(name: string): { addToPage(page: unknown, box: object): void } };
      save(): Promise<Uint8Array>;
    }>;
  };
}
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Lib;

type Dropped = { name: string; type: string; buffer: Buffer };

/** Fires a real `drop` carrying files, as dragging them from the desktop would. */
async function dropOn(page: Page, selector: string, files: Dropped[]) {
  const encoded = files.map((f) => ({ ...f, data: f.buffer.toString('base64') }));
  const transfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    return dt;
  }, encoded);
  await page.dispatchEvent(selector, 'drop', { dataTransfer: transfer });
}

const word = (text: string): Dropped => ({
  // The name lies on purpose: only the bytes say it is Word.
  name: 'minutes.dat',
  type: '',
  buffer: Buffer.from(docxBytes({ body: paragraph(text) })),
});
const pdf = (name = 'letter.txt'): Dropped => ({
  name,
  type: '',
  buffer: tinyPdf('Hello'),
});

async function signIn(page: Page) {
  await signInAs(page, sql, 'admin@example.com', 'en-GB');
  await page.goto('/room');
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
}

test('dropping a Word file and a PDF on the room opens each in the right part, and the room remembers names', async ({
  page,
}) => {
  await signIn(page);

  await dropOn(page, '.room__floor', [word('Protokoll')]);
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByTestId('opened-notice')).toContainText('Opened as a Word file');
  await expect(page.locator('.scan__page')).toHaveCount(1);

  await page.goto('/room');
  await dropOn(page, '.room__floor', [pdf()]);
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByTestId('opened-notice')).toContainText('Opened as a PDF');
  await expect(page.locator('.scan__page')).toHaveCount(1);

  // Names only, newest first, and clearing asks first.
  await page.goto('/room');
  const recent = page.getByRole('region', { name: 'Recent documents' });
  await expect(recent.getByRole('button', { name: 'Choose letter.txt again' })).toBeVisible();
  await expect(recent.getByRole('button', { name: 'Choose minutes.dat again' })).toBeVisible();
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.startsWith('tp.recent-documents')),
  );
  expect(JSON.stringify(stored)).not.toContain('Hello');
  await recent.getByRole('button', { name: 'Clear the list' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear the list' }).click();
  await expect(recent.getByText('Nothing opened here yet.')).toBeVisible();
});

test('several mixed files all go to the page list, and a photograph named .pdf is a photograph', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/scan');
  const photo = await noisyPhoto(page);
  await dropOn(page, '.scan', [
    pdf('a.pdf'),
    { name: 'b.pdf', type: 'application/pdf', buffer: photo },
    word('Protokoll'),
  ]);
  await expect(page.getByTestId('opened-notice')).toContainText('several files');
  await expect(page.locator('.scan__page')).toHaveCount(3);
  // The photograph is drawn as an image, not a PDF canvas.
  await expect(page.locator('.scan__page img')).toHaveCount(1);
});

test('a PDF with its own fields offers Fill it in, and a file can be opened as an invoice instead', async ({
  page,
}) => {
  await signIn(page);
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([300, 300]);
  doc
    .getForm()
    .createTextField('surname')
    .addToPage(sheet, { x: 10, y: 250, width: 200, height: 20 });
  const own = Buffer.from(await doc.save());

  await dropOn(page, '.room__floor', [{ name: 'own.pdf', type: 'application/pdf', buffer: own }]);
  await expect(page.getByTestId('opened-notice')).toContainText('has fields to fill in');
  await page.getByTestId('handoff-fill').click();
  await expect(page).toHaveURL(/\/forms\/pdf$/);
  await expect(page.getByLabel('surname')).toBeVisible();

  // A plain PDF has no offer, but "Choose differently" lists the other ways.
  await page.goto('/room');
  await dropOn(page, '.room__floor', [pdf('plain.pdf')]);
  await expect(page.getByTestId('opened-fill')).toHaveCount(0);
  await page.getByText('Choose differently').click();
  await expect(page.getByRole('button', { name: 'Read as an invoice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To fill in' })).toBeVisible();
});

test('scan, then Summarise: the PDF travels in memory to the summary pane and is read there', async ({
  page,
}) => {
  await page.addInitScript(fakeBridge);
  await signIn(page);
  await page.goto('/scan');
  const lines = linesPdf(['The fee is 120 kronor.', 'Payment is due 2026-04-18.']);
  await dropOn(page, '.scan', [{ name: 'fee.pdf', type: 'application/pdf', buffer: lines }]);
  await expect(page.locator('.scan__page')).toHaveCount(1);
  await page.getByTestId('handoff-summarise').click();

  await expect(page).toHaveURL(/\/summary$/);
  expect(page.url()).not.toContain('fee');
  await page.getByRole('link', { name: 'Set up AI' }).click();
  await page.getByRole('button', { name: /Open a file( or an AI pack.*)? from disk/ }).click();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Summary and translation' }).click();
  await expect(page.getByRole('heading', { name: 'What to read' })).toBeVisible();
  await expect(page.locator('textarea[readonly]')).toHaveValue(/The fee is 120 kronor\./);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('summary-result')).toBeVisible();
  const sent = await page.evaluate(
    () => (window as unknown as { __fake: { requests: Array<{ text?: string }> } }).__fake.requests,
  );
  expect(sent[0]?.text).toContain('Payment is due 2026-04-18.');
});

test('without the desktop bridge there is no Summarise button', async ({ page }) => {
  await signIn(page);
  await page.goto('/scan');
  await dropOn(page, '.scan', [pdf('a.pdf')]);
  await expect(page.locator('.scan__page')).toHaveCount(1);
  await expect(page.getByTestId('handoff-summarise')).toHaveCount(0);
});

/** A noisy 2400 x 1700 JPEG, so that smaller really is smaller. */
async function noisyPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1700;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const base = (i / 4 / canvas.width) % 256;
      image.data[i] = (base + (seed % 40)) & 255;
      image.data[i + 1] = (base * 2 + ((seed >> 8) % 40)) & 255;
      image.data[i + 2] = (255 - base + ((seed >> 16) % 40)) & 255;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return Buffer.from(base64, 'base64');
}

test('keeping a PDF suggests a name and shows Small < Medium < Original before downloading', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/scan');
  const photo = await noisyPhoto(page);
  await dropOn(page, '.scan', [{ name: 'IMG_0001.jpg', type: 'image/jpeg', buffer: photo }]);
  await expect(page.locator('.scan__page')).toHaveCount(1);

  await page.getByRole('button', { name: 'Make the PDF' }).click();
  const panel = page.getByTestId('keep-panel');
  await expect(panel).toBeVisible();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  await expect(page.getByTestId('keep-name')).toHaveValue(`Scan ${iso}`);

  const bytes = async (size: string) => {
    const span = page.getByTestId(`keep-size-${size}`);
    await expect(span).toHaveAttribute('data-bytes', /^\d+$/);
    return Number(await span.getAttribute('data-bytes'));
  };
  const [small, medium, original] = [
    await bytes('small'),
    await bytes('medium'),
    await bytes('original'),
  ];
  expect(small).toBeLessThan(medium);
  expect(medium).toBeLessThan(original);

  await page.getByTestId('keep-name').fill('Årsmöte 2026/Protokoll');
  await panel.getByRole('radio', { name: /Small/ }).check();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Årsmöte 2026 Protokoll.pdf');
});

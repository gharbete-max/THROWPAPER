import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, test, type Page } from '@playwright/test';
import { db, signInAs } from './support.js';
import { E2E_SIGN_SERVICE_TOKEN, signDatabaseUrl } from './ports.js';
import { extractSeal, opensslVerify } from '../apps/api-sign/src/sealing/openssl-validator.js';

/**
 * Sign: place a signature, initials and a date on a two-page PDF with the keyboard alone, send it
 * for signing, sign, download the sealed file, and read where the marks ended up.
 *
 * The marks are put on the document before it goes for signing, so the file that comes down is
 * the document with its marks, the signer's record, and the audit page, all under the seal.
 */
const APP_ORIGIN = 'http://localhost:4173';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const PAGE = { width: 595, height: 842 };
const STORE_NAME = 'tp.sign.marks.v1';

interface Stream {
  [key: string]: unknown;
}
interface Reader {
  PDFDocument: {
    create(): Promise<{
      addPage(size: [number, number]): { drawText(text: string, options: object): void };
      save(): Promise<Uint8Array>;
    }>;
    load(bytes: Uint8Array): Promise<{
      getPageCount(): number;
      getPages(): Array<{ node: { Contents(): unknown } }>;
      context: { lookup(ref: unknown): unknown };
    }>;
  };
  PDFArray: new (...args: never[]) => { asArray(): unknown[] };
  PDFRawStream: new (...args: never[]) => Stream;
  decodePDFRawStream(stream: unknown): { decode(): Uint8Array };
}
const pdfLib = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Reader;

async function twoPages(): Promise<Buffer> {
  const doc = await pdfLib.PDFDocument.create();
  for (const words of ['Lease, page one', 'Lease, page two']) {
    doc.addPage([PAGE.width, PAGE.height]).drawText(words, { x: 72, y: 760, size: 18 });
  }
  return Buffer.from(await doc.save());
}

/** What a page draws: each picture as {x, y, width, height} and each text start as {x, y}. */
async function marksOn(bytes: Uint8Array, pageIndex: number) {
  const doc = await pdfLib.PDFDocument.load(bytes);
  const contents = doc.getPages()[pageIndex]!.node.Contents();
  const streams =
    contents instanceof pdfLib.PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const source = streams
    .map((s) => Buffer.from(pdfLib.decodePDFRawStream(s).decode()).toString('latin1'))
    .join('\n');
  const number = '(-?[\\d.]+(?:e-?\\d+)?)';
  // pdf-lib writes a picture as: move to (x, y), then scale to (width, height), then draw.
  const unit = '1 0 0 1 0 0 cm\\s+';
  const pictures = [
    ...source.matchAll(
      new RegExp(
        `q\\s+1 0 0 1 ${number} ${number} cm\\s+${unit}${number} 0 0 ${number} 0 0 cm\\s+${unit}/\\S+ Do`,
        'g',
      ),
    ),
  ].map((m) => ({ x: +m[1]!, y: +m[2]!, width: +m[3]!, height: +m[4]! }));
  const texts = [
    ...source.matchAll(new RegExp(`1 0 0 1 ${number} ${number} Tm\\s+<([0-9A-Fa-f]+)> Tj`, 'g')),
  ].map((m) => ({
    x: +m[1]!,
    y: +m[2]!,
    text: Buffer.from(m[3]!, 'hex').toString('latin1'),
  }));
  return { pictures, texts };
}

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.06);

async function field(page: Page, name: string): Promise<number> {
  return Number(await page.getByLabel(name).inputValue());
}

/** Makes a typed mark with the keyboard. */
async function makeMark(page: Page, slot: 'Signature' | 'Initials', words: string) {
  await page.getByRole('button', { name: `Create: ${slot}` }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Text to use').fill(words);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved on this computer')).not.toHaveCount(0);
}

async function add(page: Page, what: string, kind: string) {
  await page.getByRole('button', { name: `Add to this page: ${what}` }).focus();
  await page.keyboard.press('Enter');
  // The new mark takes the focus, so the arrow keys move it at once.
  await expect(page.locator(`[data-mark][data-kind="${kind}"]:focus`)).toHaveCount(1);
}

test('place signature, initials and date on two pages by keyboard, seal, and find them where they were put', async ({
  page,
  context,
}) => {
  const sql = db();
  try {
    const [organisation] = await sql`select organisation_id from users
      where email = 'admin@example.com' limit 1`;
    const sign = postgres(signDatabaseUrl(DATABASE_URL), { max: 1, onnotice: () => {} });
    try {
      await sign`insert into service_tokens (organisation_id, name, token_sha256, allowed_origins)
        values (${String(organisation!['organisation_id'])}, 'forms-e2e',
                ${createHash('sha256').update(E2E_SIGN_SERVICE_TOKEN).digest('hex')},
                array[${APP_ORIGIN}]::text[])
        on conflict (token_sha256) do nothing`;
    } finally {
      await sign.end();
    }
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
  } finally {
    await sql.end();
  }

  await page.goto('/signing');
  await page.evaluate((key) => localStorage.removeItem(key), STORE_NAME);
  await page.reload();
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page
    .getByLabel('PDF file')
    .setInputFiles({ name: 'Lease.pdf', mimeType: 'application/pdf', buffer: await twoPages() });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Jon Smith');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Place signature, initials and date' }).click();

  await makeMark(page, 'Signature', 'Jon Smith');
  await makeMark(page, 'Initials', 'JS');
  // Kept on this computer, and only here.
  expect(await page.evaluate((key) => localStorage.getItem(key), STORE_NAME)).toContain(
    'data:image/png',
  );
  const sample = async (n: number) =>
    page
      .locator('.sign-place__sample')
      .nth(n)
      .evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  const aspect = { signature: await sample(0), initials: await sample(1) };

  // Page 1: signature moved right five points and down twenty; initials left where they start;
  // the date nudged up a point.
  await add(page, 'Signature', 'signature');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 2; i += 1) await page.keyboard.press('Shift+ArrowDown');
  const sig1 = {
    x: await field(page, 'From the left (points)'),
    y: await field(page, 'From the top (points)'),
    width: await field(page, 'Width (points)'),
  };
  near(sig1.x, PAGE.width * 0.1 + 5);
  near(sig1.y, PAGE.height * 0.78 + 20);

  await add(page, 'Initials', 'initials');
  const ini1 = {
    x: await field(page, 'From the left (points)'),
    y: await field(page, 'From the top (points)'),
    width: await field(page, 'Width (points)'),
  };
  await add(page, 'Date', 'date');
  await page.keyboard.press('ArrowUp');
  const date1 = {
    x: await field(page, 'From the left (points)'),
    y: await field(page, 'From the top (points)'),
    size: await field(page, 'Size (points)'),
  };
  near(date1.y, PAGE.height * 0.9 - 1);

  // Page 2: the same three, the signature three points to the left.
  await page.getByLabel('Page', { exact: true }).selectOption('1');
  await add(page, 'Signature', 'signature');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowLeft');
  const sig2 = {
    x: await field(page, 'From the left (points)'),
    y: await field(page, 'From the top (points)'),
    width: await field(page, 'Width (points)'),
  };
  near(sig2.x, PAGE.width * 0.1 - 3);
  await add(page, 'Initials', 'initials');
  await add(page, 'Date', 'date');

  // The strip shows the whole document with the marks on each page.
  const strip = page.getByTestId('sign-place-strip');
  await expect(strip.locator('button')).toHaveCount(2);
  await expect(strip.locator('button').nth(0)).toHaveAttribute('data-marks', '3');
  await expect(strip.locator('button').nth(1)).toHaveAttribute('data-marks', '3');

  // Nothing is changed until it is confirmed.
  await page.getByRole('button', { name: 'Apply the marks' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Marks: 6');
  await expect(dialog).toContainText('1, 2');
  const today = new Intl.DateTimeFormat('en-GB-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await expect(dialog).toContainText(today);
  await dialog.getByRole('button', { name: 'Apply the marks' }).click();
  await expect(
    page.getByRole('button', { name: 'Place signature, initials and date' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel('Document name').fill('Marked lease');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Send for signing' }).click();
  const row = page.getByTestId('signing-row').filter({ hasText: 'Marked lease' }).first();
  await expect(row.getByTestId('signing-status')).toHaveText('Waiting for signatures');
  const signUrl = await row.getByRole('link', { name: 'Open signing page' }).getAttribute('href');

  const signer = await context.newPage();
  await signer.goto(signUrl!);
  await signer.getByLabel('Your name').fill('Jon Smith');
  await signer.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(signer.getByTestId('outcome')).toHaveText('Everyone has signed.');
  await signer.close();

  await row.getByRole('button', { name: 'Refresh' }).click();
  await expect(row.getByTestId('signing-status')).toHaveText('Signed by everyone');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download signed PDF' }).click(),
  ]);
  const bytes = new Uint8Array(await readFile((await download.path())!));

  // Sealed, with the audit page after the two document pages.
  const seal = extractSeal(bytes);
  expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);
  expect((await pdfLib.PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(3);

  // Where each picture is, from the lower left of the page: the seen top edge turned over.
  const expectedPicture = (seen: { x: number; y: number; width: number }, ratio: number) => {
    const height = Math.round((seen.width / ratio) * 100) / 100;
    return { x: seen.x, y: PAGE.height - (seen.y + height), width: seen.width, height };
  };
  for (const [index, set] of [
    [0, { signature: sig1, initials: ini1 }],
    [1, { signature: sig2, initials: ini1 }],
  ] as const) {
    const { pictures, texts } = await marksOn(bytes, index);
    expect(pictures).toHaveLength(2);
    for (const kind of ['signature', 'initials'] as const) {
      const want = expectedPicture(set[kind], aspect[kind]);
      const got = pictures.find((p) => Math.abs(p.width - want.width) < 0.06);
      expect(got, `${kind} on page ${index + 1}`).toBeTruthy();
      near(got!.x, want.x);
      near(got!.y, want.y);
      near(got!.height, want.height);
    }
    const date = texts.find((t) => t.text === today);
    expect(date, `date on page ${index + 1}`).toBeTruthy();
    // Dates sit at the baseline, 0.8 of the line down its box.
    const box = index === 0 ? date1 : { ...date1, y: PAGE.height * 0.9 };
    near(date!.x, box.x);
    near(date!.y, PAGE.height - (box.y + box.size * 1.3 * 0.8));
  }
});

test('a saved signature is forgotten only after a confirmation', async ({ page }) => {
  const sql = db();
  try {
    await signInAs(page, sql, 'admin@example.com', 'en-GB');
  } finally {
    await sql.end();
  }
  await page.goto('/signing');
  await page.evaluate((key) => localStorage.removeItem(key), STORE_NAME);
  await page.reload();
  await page.getByRole('button', { name: 'Send a PDF for signing' }).click();
  await page
    .getByLabel('PDF file')
    .setInputFiles({ name: 'Lease.pdf', mimeType: 'application/pdf', buffer: await twoPages() });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Jon Smith');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Place signature, initials and date' }).click();
  await makeMark(page, 'Signature', 'Jon Smith');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORE_NAME)).not.toBeNull();

  await page.getByRole('button', { name: 'Forget: Signature' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORE_NAME)).not.toBeNull();

  await page.getByRole('button', { name: 'Forget: Signature' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(page.getByText('Not saved yet')).not.toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORE_NAME)).toBeNull();
});

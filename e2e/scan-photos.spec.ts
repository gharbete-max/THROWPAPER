import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { db, plantLoginToken } from './support.js';
import { tinyPdf } from './pdf.js';

/**
 * Photos and scans become one PDF — phase 1a, second increment of `docs/plan/NEXT.md`.
 *
 * Photographs and a PDF page are told apart in the output by the page they make: a landscape
 * photograph is an A4 landscape page, a portrait one A4 portrait, and the PDF page carries the turn
 * it was made with. The person puts them in order, turns one, takes one out; the PDF that comes
 * down must be exactly that.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env['E2E_CHROMIUM'] ? { executablePath: process.env['E2E_CHROMIUM'] } : {}),
  },
});

const sql = db();
test.afterAll(async () => {
  await sql.end();
});

interface Reader {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{
      getPages(): Array<{
        getWidth(): number;
        getHeight(): number;
        getRotation(): { angle: number };
      }>;
    }>;
  };
}
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Reader;

/** A solid-colour PNG, written by hand so the spec needs no image library. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function open(page: Page) {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  await page.goto('/scan');
  await expect(page.getByRole('heading', { name: 'Arrange pages' })).toBeVisible();
}

async function download(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  const saved = await (await saving).path();
  const out = await PDFDocument.load(await readFile(saved));
  return out
    .getPages()
    .map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight()), p.getRotation().angle]);
}

test('photos and a PDF page are reordered, turned and removed into one download', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('scan-files').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: png(120, 80, [200, 30, 30]) },
    { name: 'green.png', mimeType: 'image/png', buffer: png(80, 120, [30, 160, 30]) },
    { name: 'half-turn.pdf', mimeType: 'application/pdf', buffer: tinyPdf('x', 180) },
    { name: 'blue.png', mimeType: 'image/png', buffer: png(100, 140, [30, 30, 200]) },
  ]);
  await expect(page.getByText('4 pages')).toBeVisible();
  const cards = page.locator('.scan__page');
  await expect(cards).toHaveCount(4);
  // The photographs are shown, as pictures that have loaded.
  await expect(cards.first().locator('img')).toBeVisible();
  await expect
    .poll(() =>
      cards
        .first()
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(120);

  // Red, green, PDF, blue -> red, blue, green, PDF -> take green out -> turn red a quarter.
  await cards.nth(3).getByRole('button', { name: 'Move earlier' }).click();
  await cards.nth(2).getByRole('button', { name: 'Move earlier' }).click();
  await cards.nth(2).getByRole('button', { name: 'Remove page' }).click();
  await cards.nth(0).getByRole('button', { name: 'Turn' }).click();
  await expect(page.getByText('3 pages')).toBeVisible();

  expect(await download(page)).toEqual([
    [842, 595, 90],
    [595, 842, 0],
    [595, 842, 180],
  ]);
});

test('a WebP is converted to a JPEG page, and what cannot be a page is refused in words', async ({
  page,
}) => {
  await open(page);
  const webp = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(20, 120, 200)';
    context.fillRect(0, 0, 300, 100);
    const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/webp'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page
    .getByTestId('scan-files')
    .setInputFiles({ name: 'wide.webp', mimeType: 'image/webp', buffer: Buffer.from(webp) });
  await expect(page.getByText(/^1 pages?$/)).toBeVisible();

  // Not a page: refused, and the list is unchanged.
  await page
    .getByTestId('scan-files')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText(/Only PDF, JPEG, PNG and WebP files can be added/)).toBeVisible();
  // Called a photo, but its bytes say it is not one: refused by content, not by name.
  await page.getByTestId('scan-files').setInputFiles({
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('this is not a picture'),
  });
  await expect(page.getByText(/Only PDF, JPEG, PNG and WebP files can be added/)).toHaveCount(2);
  await expect(page.locator('.scan__page')).toHaveCount(1);

  expect(await download(page)).toEqual([[842, 595, 0]]);
});

test('pages taken with the camera join the same list', async ({ page }) => {
  await open(page);
  await page
    .getByTestId('scan-files')
    .setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: png(80, 120, [9, 9, 9]) });
  await expect(page.getByText(/^1 pages?$/)).toBeVisible();

  await page.getByRole('button', { name: 'Take photos' }).click();
  const scanner = page.getByTestId('camera-scan');
  await expect(scanner.getByRole('button', { name: 'Take page' })).toBeEnabled();
  await scanner.getByRole('button', { name: 'Take page' }).click();
  await scanner.getByRole('button', { name: 'Take page' }).click();
  await scanner.getByRole('button', { name: /^Done \(2\)$/ }).click();
  await expect(page.getByText('3 pages')).toBeVisible();

  // The fake camera's picture is landscape; the file before it was a portrait.
  expect(await download(page)).toEqual([
    [595, 842, 0],
    [842, 595, 0],
    [842, 595, 0],
  ]);
});

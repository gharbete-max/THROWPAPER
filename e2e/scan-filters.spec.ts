import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { db, plantLoginToken, scanStep } from './support.js';

/**
 * Scan filters (Track A): a photographed page of text under a shadow, filtered to Black and white
 * on the Scan screen, comes down as a PDF whose image is ink and paper only — no grey, no shadow.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

// pdf-lib is the API's dependency, not the root's, so it is loaded from there and typed by hand.
interface Raw {
  dict: { toString(): string };
  contents?: Uint8Array;
}
interface Reader {
  PDFDocument: {
    load(bytes: Uint8Array): Promise<{
      context: { enumerateIndirectObjects(): Array<[unknown, Raw]> };
    }>;
  };
}
const { PDFDocument } = createRequire(new URL('../apps/api-forms/package.json', import.meta.url))(
  'pdf-lib',
) as Reader;

const W = 600;
const H = 800;

/** An 8-bit RGB PNG of dashed lines on paper with a shadow from 235 (left) to 110 (right). */
function shadowedPage(): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3); // filter byte 0
    for (let x = 0; x < W; x++) {
      const light = 235 - (125 * x) / W;
      const stroke = y > 60 && y < H - 60 && y % 28 < 4 && x > 50 && x < W - 50 && x % 14 < 9;
      const v = Math.round(stroke ? light * 0.2 : light);
      row[1 + x * 3] = row[2 + x * 3] = row[3 + x * 3] = v;
    }
    rows.push(row);
  }
  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(W, 0);
  header.writeUInt32BE(H, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

test('scan filters: a shadowed photo made Black and white embeds as ink and paper only', async ({
  page,
}) => {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();

  await page.goto('/scan');
  await page
    .getByTestId('scan-files')
    .setInputFiles([{ name: 'page.png', mimeType: 'image/png', buffer: shadowedPage() }]);
  await expect(page.locator('.scan__page')).toHaveCount(1);

  await page.getByRole('button', { name: 'Filters' }).click();
  const panel = page.getByRole('region', { name: 'Filter for page 1' });
  // It looks like text on paper: Clean document is suggested, and shown, but not yet applied.
  await expect(panel.getByRole('radio', { name: /Clean document/ })).toBeChecked();
  await expect(panel.getByText('· Suggested')).toBeVisible();

  await panel.getByRole('radio', { name: 'Black and white' }).check();
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(panel).toHaveCount(0);

  const download = page.waitForEvent('download');
  await scanStep(page, 'keep');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  const saved = await (await download).path();
  const doc = await PDFDocument.load(await readFile(saved));
  const images = doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object) => /\/Subtype \/Image/.test(String(object.dict)));
  expect(images).toHaveLength(1);
  const image = images[0]!;
  const description = String(image.dict);
  expect(description).toMatch(/\/Filter \/FlateDecode/); // a PNG's pixels, not a JPEG
  const pixels = inflateSync(image.contents!);
  const channels = /DeviceGray/.test(description) ? 1 : 3;
  let dark = 0;
  let white = 0;
  let other = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const v = pixels[i]!;
    if (channels === 3 && (pixels[i + 1] !== v || pixels[i + 2] !== v)) other++;
    else if (v === 0) dark++;
    else if (v === 255) white++;
    else other++;
  }
  expect(other).toBe(0);
  expect(dark).toBeGreaterThan(1000); // the strokes survived the shadow
  expect(white).toBeGreaterThan((dark + white) * 0.9); // and the shadow became paper
  expect(image.contents!.length).toBeLessThan(100_000);
});

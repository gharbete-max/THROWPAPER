import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PageTooLarge, pagesToPdf } from './scan.js';

/** A 1×1 PNG and the smallest valid JPEG, so the test needs no image library. */
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

async function jpeg(width: number, height: number): Promise<string> {
  // pdf-lib reads a JPEG's size from its SOF marker; build a minimal baseline frame header.
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  return Buffer.from([0xff, 0xd8, ...sof, 0xff, 0xd9]).toString('base64');
}

describe('scanned pages become a PDF', () => {
  it('makes one A4 page per image, turned to the image, in order', async () => {
    const pdf = await PDFDocument.load(
      await pagesToPdf([
        { contentType: 'image/jpeg', base64: await jpeg(1200, 1600) },
        { contentType: 'image/jpeg', base64: await jpeg(1600, 1200) },
        { contentType: 'image/png', base64: PNG_1x1 },
      ]),
    );
    const sizes = pdf.getPages().map((page) => page.getSize());
    expect(sizes.map((s) => Math.round(s.width))).toEqual([595, 842, 595]);
    expect(sizes.map((s) => Math.round(s.height))).toEqual([842, 595, 842]);
  });

  it('refuses a page that is not the image it claims to be', async () => {
    await expect(
      pagesToPdf([{ contentType: 'image/jpeg', base64: Buffer.from('hello').toString('base64') }]),
    ).rejects.toThrow();
  });
});

describe('a page that claims to be enormous', () => {
  /** A PNG header saying `width × height`, with no pixel data at all: the shape of a bomb. */
  function pngClaiming(width: number, height: number): string {
    const bytes = Buffer.from(PNG_1x1, 'base64');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes.toString('base64');
  }

  it('is refused from its header, before anything is decoded', async () => {
    const started = Date.now();
    await expect(
      pagesToPdf([{ contentType: 'image/png', base64: pngClaiming(20_000, 20_000) }]),
    ).rejects.toBeInstanceOf(PageTooLarge);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is refused as a JPEG too, and a real page size is not', async () => {
    await expect(
      pagesToPdf([{ contentType: 'image/jpeg', base64: await jpeg(9000, 9000) }]),
    ).rejects.toBeInstanceOf(PageTooLarge);
    await expect(
      pagesToPdf([{ contentType: 'image/jpeg', base64: await jpeg(3000, 4000) }]),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('refuses a "PNG" with no PNG header', async () => {
    await expect(
      pagesToPdf([
        { contentType: 'image/png', base64: Buffer.from('not a png').toString('base64') },
      ]),
    ).rejects.toThrow();
  });
});

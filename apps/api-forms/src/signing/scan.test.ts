import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pagesToPdf } from './scan.js';

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

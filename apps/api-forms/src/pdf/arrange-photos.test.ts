import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { arrangePdf, ArrangeRefusal } from './arrange.js';

/** The smallest valid PNG, 1 x 1; and a JPEG that is only a header, which is all pdf-lib reads. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

function jpeg(width: number, height: number, orientation?: number): Uint8Array {
  const exif =
    orientation === undefined
      ? []
      : [
          // APP1 "Exif", big-endian TIFF, one entry in IFD0: tag 0x0112 (orientation), SHORT.
          ...[0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
          ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01],
          ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00],
          ...[0x00, 0x00, 0x00, 0x00],
        ];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255];
  const components = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return new Uint8Array([0xff, 0xd8, ...exif, ...sof, ...components, 0xff, 0xd9]);
}

function pngClaiming(width: number, height: number): Uint8Array {
  const bytes = Buffer.from(PNG_1x1);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}

/** A PDF whose pages are told apart by width (100, 110, ...). */
async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([100 + i * 10, 200]);
  return doc.save();
}

async function pageShapes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPages()
    .map((page) => [
      Math.round(page.getWidth()),
      Math.round(page.getHeight()),
      page.getRotation().angle,
    ]);
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ArrangeRefusal);
  return (error as ArrangeRefusal).code;
};

describe('arrangePdf with photographs', () => {
  it('puts photographs and PDF pages in one ordered list, one A4 page per photograph', async () => {
    const out = await arrangePdf(
      [jpeg(1200, 1600), new Uint8Array(PNG_1x1), await pdfOf(2), jpeg(1600, 1200)],
      [
        { file: 2, page: 1 },
        { file: 0, page: 0 },
        { file: 3, page: 0 },
        { file: 1, page: 0 },
        { file: 2, page: 0 },
      ],
    );
    expect(await pageShapes(out)).toEqual([
      [110, 200, 0],
      [595, 842, 0],
      [842, 595, 0],
      [595, 842, 0],
      [100, 200, 0],
    ]);
  });

  it('embeds a JPEG as it is, without re-encoding it', async () => {
    const photo = jpeg(1200, 1600);
    const out = Buffer.from(await arrangePdf([photo], [{ file: 0, page: 0 }]));
    // A DCT-filtered stream is the JPEG itself; the file holds the photograph's bytes verbatim.
    expect(out.includes(Buffer.from(photo))).toBe(true);
    expect(out.includes(Buffer.from('/DCTDecode'))).toBe(true);
  });

  it('turns a photograph upright from its EXIF orientation, then by what the person adds', async () => {
    const out = await arrangePdf(
      [jpeg(1600, 1200, 6), jpeg(1600, 1200, 3), jpeg(1600, 1200, 1)],
      [
        { file: 0, page: 0 },
        { file: 1, page: 0 },
        { file: 2, page: 0, rotate: 90 },
        { file: 0, page: 0, rotate: 180 },
      ],
    );
    expect((await pageShapes(out)).map((s) => s[2])).toEqual([90, 180, 90, 270]);
  });

  it('may use one photograph twice, and has no second page to name', async () => {
    const photo = jpeg(300, 400);
    const out = await arrangePdf(
      [photo],
      [
        { file: 0, page: 0 },
        { file: 0, page: 0 },
      ],
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    expect(await refusal(arrangePdf([photo], [{ file: 0, page: 1 }]))).toBe('no-such-page');
  });

  it('refuses a photograph with more pixels than a page can use, before decoding it', async () => {
    const tooBig = [pngClaiming(5000, 5000), pngClaiming(40000, 40000), jpeg(8000, 8000)];
    for (const photo of tooBig) {
      expect(await refusal(arrangePdf([photo], [{ file: 0, page: 0 }]))).toBe('image-too-large');
    }
    // 24 MP exactly is inside the cap.
    const out = await arrangePdf([jpeg(6000, 4000)], [{ file: 0, page: 0 }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('refuses a corrupt photograph and a format it cannot embed', async () => {
    const truncatedPng = new Uint8Array(PNG_1x1.subarray(0, 12));
    expect(await refusal(arrangePdf([truncatedPng], [{ file: 0, page: 0 }]))).toBe('unreadable');
    // The header is fine, the pixel data is not.
    const garbled = Buffer.from(PNG_1x1);
    garbled.fill(0x41, 41, 55);
    expect(await refusal(arrangePdf([new Uint8Array(garbled)], [{ file: 0, page: 0 }]))).toBe(
      'unreadable',
    );
    const headerless = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(await refusal(arrangePdf([headerless], [{ file: 0, page: 0 }]))).toBe('unreadable');
    // WebP is not embedded here; the browser converts it first.
    const webp = new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 '));
    expect(await refusal(arrangePdf([webp], [{ file: 0, page: 0 }]))).toBe('unreadable');
  });
});

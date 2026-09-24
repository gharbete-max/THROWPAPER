import { PDFDocument } from 'pdf-lib';
import { imageSize } from '../uploads/image-size.js';

/**
 * The most pixels a scanned page may claim, read from its header before anything decodes it.
 *
 * pdf-lib decodes a PNG into full RGBA before looking at it, so a 186 KB PNG that says it is
 * 8000 × 8000 costs 700 MB, and one that says 20000 × 20000 stalls the server for seconds and then
 * fails to allocate — a decompression bomb inside the 15 MB request limit. A phone photo is about
 * 12 MP and the app shrinks pages to 2400 px on the long side; 40 MP is room for any real page.
 */
export const MAX_PAGE_PIXELS = 40_000_000;

export class PageTooLarge extends Error {
  constructor() {
    super('A scanned page is larger than any real page');
    this.name = 'PageTooLarge';
  }
}

/** A4 in points. A scanned page becomes one, turned to the photograph's own orientation. */
const A4 = { short: 595.28, long: 841.89 };

/**
 * Pages scanned with a camera, as a PDF (P1c-3, camera scanning). The browser has already
 * straightened each photograph on the corners the person placed; this only lays them out: one
 * image per page, A4, portrait or landscape as the image is, scaled to fit with its proportions
 * kept and centred. The result is an ordinary PDF — what Sign fetches, hashes and seals.
 *
 * Throws if a page is not the image its content type says, or claims more pixels than a page has.
 */
export async function pagesToPdf(
  pages: readonly { contentType: 'image/jpeg' | 'image/png'; base64: string }[],
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    // A copy of its own: `Buffer.from(base64)` is a slice of Node's shared pool, and pdf-lib reads
    // the underlying ArrayBuffer from offset 0 — so it would find somebody else's bytes first.
    const raw = Buffer.from(page.base64, 'base64');
    const size = imageSize(raw, page.contentType === 'image/png' ? 'png' : 'jpeg');
    // A PNG's size is at a fixed place in its header; one without it is not a PNG. pdf-lib embeds a
    // JPEG without decoding it, so a JPEG whose header this reader does not follow is left to
    // pdf-lib — which reads its own. Either way, too many pixels is refused before any decoding.
    if (!size && page.contentType === 'image/png') throw new Error('A scanned page is not a PNG');
    if (size && size.width * size.height > MAX_PAGE_PIXELS) throw new PageTooLarge();
    const bytes = new Uint8Array(raw);
    const image =
      page.contentType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const landscape = image.width > image.height;
    const width = landscape ? A4.long : A4.short;
    const height = landscape ? A4.short : A4.long;
    const scale = Math.min(width / image.width, height / image.height);
    const drawn = { width: image.width * scale, height: image.height * scale };
    pdf.addPage([width, height]).drawImage(image, {
      x: (width - drawn.width) / 2,
      y: (height - drawn.height) / 2,
      ...drawn,
    });
  }
  return Buffer.from(await pdf.save());
}

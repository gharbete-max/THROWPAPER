import { PDFDocument } from 'pdf-lib';

/** A4 in points. A scanned page becomes one, turned to the photograph's own orientation. */
const A4 = { short: 595.28, long: 841.89 };

/**
 * Pages scanned with a camera, as a PDF (P1c-3, camera scanning). The browser has already
 * straightened each photograph on the corners the person placed; this only lays them out: one
 * image per page, A4, portrait or landscape as the image is, scaled to fit with its proportions
 * kept and centred. The result is an ordinary PDF — what Sign fetches, hashes and seals.
 *
 * Throws if a page is not the image its content type says.
 */
export async function pagesToPdf(
  pages: readonly { contentType: 'image/jpeg' | 'image/png'; base64: string }[],
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    // A copy of its own: `Buffer.from(base64)` is a slice of Node's shared pool, and pdf-lib reads
    // the underlying ArrayBuffer from offset 0 — so it would find somebody else's bytes first.
    const bytes = new Uint8Array(Buffer.from(page.base64, 'base64'));
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

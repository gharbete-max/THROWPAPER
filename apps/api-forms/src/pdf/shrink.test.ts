import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ArrangeRefusal } from './arrange.js';
import { shrinkPdf } from './shrink.js';

const STANDARD_FONTS = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

/** A long document the way an editor leaves it: written loose, with an old revision's leftovers. */
async function bulky(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([300, 400]).drawText(`Page ${i + 1} agreement text`, { x: 40, y: 300, font });
  }
  // Objects nothing points to: three uncompressed 100 kB streams.
  for (let i = 0; i < 3; i += 1) {
    doc.context.register(doc.context.stream(new Uint8Array(100_000).fill(65 + i)));
  }
  return doc.save({ useObjectStreams: false });
}

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  await pdf.loadingTask.destroy();
  return pages;
}

describe('shrinkPdf', () => {
  it('drops what nothing points to and keeps every page and its text', async () => {
    const before = await bulky(20);
    const after = await shrinkPdf(before);
    // The leftovers alone are 300 kB; the rest packs well under what remains.
    expect(after.length).toBeLessThan(before.length / 2);
    const words = await textOf(after);
    expect(words).toEqual(await textOf(before));
    expect(words).toHaveLength(20);
    expect(words[19]).toBe('Page 20 agreement text');
  });

  it('hands back the same bytes when nothing is gained', async () => {
    const once = await shrinkPdf(await bulky(3));
    const twice = await shrinkPdf(once);
    expect(twice.length).toBeLessThanOrEqual(once.length);
    expect(await textOf(twice)).toEqual(await textOf(once));
  });

  it('refuses a signed file rather than breaking its signature', async () => {
    const signed = new Uint8Array([
      ...(await bulky(1)),
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    const error = await shrinkPdf(signed).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrangeRefusal);
    expect((error as ArrangeRefusal).code).toBe('signed');
  });

  it('refuses what is not a PDF', async () => {
    const error = await shrinkPdf(new TextEncoder().encode('hello')).catch((e: unknown) => e);
    expect((error as ArrangeRefusal).code).toBe('unreadable');
  });
});

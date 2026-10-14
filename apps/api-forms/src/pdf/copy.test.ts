import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { CopyPdfRequest } from '@tp/shared/api';
import { ArrangeRefusal } from './arrange.js';
import { copyPdf } from './copy.js';

/** pdf.js reads standard fonts' widths from files; without them it drops text it cannot measure. */
const STANDARD_FONTS = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

/** The smallest valid PNG, 1 x 1: stands for the photograph. */
const PHOTO = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const WORDS = ['Faktura', '2026-14', 'Totalt', 'Привет', '合計'];
const REQUEST: CopyPdfRequest = {
  mode: 'copy',
  widthPt: 595,
  heightPt: 842,
  lines: [
    { x1: 50, y1: 100, x2: 545, y2: 100, width: 1 },
    { x1: 50, y1: 100, x2: 50, y2: 400, width: 1 },
  ],
  words: WORDS.map((text, i) => ({ text, x: 60, y: 130 + i * 40, size: 14 })),
};

async function read(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const operators = await page.getOperatorList();
  const result = {
    text: content.items.flatMap((item) =>
      'str' in item && item.str.trim() ? [item.str.trim()] : [],
    ),
    ops: operators.fnArray,
    args: operators.argsArray,
    pages: pdf.numPages,
  };
  await pdf.loadingTask.destroy();
  return result;
}

describe('copyPdf, the digital copy', () => {
  it('has real text equal to the words it was given, lines, and no picture', async () => {
    const { pdf, replaced } = await copyPdf(REQUEST);
    const seen = await read(pdf);
    expect(replaced).toBe(0);
    expect(seen.pages).toBe(1);
    expect(seen.text).toEqual(WORDS);
    expect(seen.ops).not.toContain(OPS.paintImageXObject);
    expect(seen.ops).toContain(OPS.constructPath);
    const page = (await PDFDocument.load(pdf)).getPage(0);
    expect([page.getWidth(), page.getHeight()]).toEqual([595, 842]);
  });

  it('draws a character no font has as a question mark, and says how many', async () => {
    const { pdf, replaced } = await copyPdf({
      ...REQUEST,
      words: [{ text: 'aกb', x: 10, y: 50, size: 12 }],
    });
    expect(replaced).toBe(1);
    expect((await read(pdf)).text).toEqual(['a?b']);
  });
});

describe('copyPdf, the searchable PDF', () => {
  const searchable = { ...REQUEST, mode: 'searchable' as const, lines: [] };

  it('shows the photograph and carries the same words as text pdf.js can extract', async () => {
    const { pdf } = await copyPdf(searchable, PHOTO);
    const seen = await read(pdf);
    expect(seen.text).toEqual(WORDS);
    // The page paints the photograph ...
    expect(seen.ops).toContain(OPS.paintImageXObject);
    // ... and every word is drawn in render mode 3, which paints nothing.
    const modes = seen.ops.flatMap((op, i) =>
      op === OPS.setTextRenderingMode ? [seen.args[i]![0]] : [],
    );
    expect(modes).toContain(3);
    const firstText = seen.ops.indexOf(OPS.showText);
    expect(seen.ops.indexOf(OPS.paintImageXObject)).toBeLessThan(firstText);
    expect(seen.ops.indexOf(OPS.setTextRenderingMode)).toBeLessThan(firstText);
  });

  it('refuses a search layer with no photograph, and a photograph that is not one', async () => {
    const refusal = async (promise: Promise<unknown>) =>
      (
        (await promise.then(
          () => undefined,
          (error: unknown) => error,
        )) as ArrangeRefusal
      ).code;
    expect(await refusal(copyPdf(searchable))).toBe('unreadable');
    expect(await refusal(copyPdf(searchable, new Uint8Array([1, 2, 3, 4])))).toBe('unreadable');
  });
});

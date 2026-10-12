import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { arrangePdf, ArrangeRefusal, MAX_STEPS } from './arrange.js';
import { objectStreamBomb } from '../test-pdf-bomb.js';

const ENCRYPTED = new URL('../../../../fixtures/pdf/encrypted.pdf', import.meta.url);

/**
 * A PDF whose pages are told apart by width (100, 110, 120, …), so the order of an output can be
 * read back from its page sizes without extracting any text.
 */
async function pdfOf(pages: number, options: { rotate?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([100 + i * 10, 200]);
    if (options.rotate) page.setRotation(degrees(options.rotate));
  }
  return doc.save();
}

async function widthsAndRotations(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [page.getWidth(), page.getRotation().angle]);
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ArrangeRefusal);
  return (error as ArrangeRefusal).code;
};

describe('arrangePdf', () => {
  it('keeps one file as it is when every page is named in order', async () => {
    const a = await pdfOf(3);
    const out = await arrangePdf(
      [a],
      [
        { file: 0, page: 0 },
        { file: 0, page: 1 },
        { file: 0, page: 2 },
      ],
    );
    expect(await widthsAndRotations(out)).toEqual([
      [100, 0],
      [110, 0],
      [120, 0],
    ]);
  });

  it('puts two files together, in the order named', async () => {
    const a = await pdfOf(2);
    const b = await pdfOf(1);
    const out = await arrangePdf(
      [a, b],
      [
        { file: 1, page: 0 },
        { file: 0, page: 0 },
        { file: 0, page: 1 },
      ],
    );
    expect(await widthsAndRotations(out)).toEqual([
      [100, 0],
      [100, 0],
      [110, 0],
    ]);
  });

  it('reorders, and a page left out is deleted', async () => {
    const a = await pdfOf(4);
    const out = await arrangePdf(
      [a],
      [
        { file: 0, page: 3 },
        { file: 0, page: 0 },
      ],
    );
    expect(await widthsAndRotations(out)).toEqual([
      [130, 0],
      [100, 0],
    ]);
  });

  it('extracts a single page, and may use a page twice', async () => {
    const a = await pdfOf(3);
    const out = await arrangePdf(
      [a],
      [
        { file: 0, page: 1 },
        { file: 0, page: 1 },
      ],
    );
    expect(await widthsAndRotations(out)).toEqual([
      [110, 0],
      [110, 0],
    ]);
  });

  it('turns a page, on top of the turn it already has', async () => {
    const a = await pdfOf(2);
    const turned = await pdfOf(1, { rotate: 90 });
    const out = await arrangePdf(
      [a, turned],
      [
        { file: 0, page: 0, rotate: 90 },
        { file: 0, page: 1 },
        { file: 1, page: 0, rotate: 270 },
      ],
    );
    expect(await widthsAndRotations(out)).toEqual([
      [100, 90],
      [110, 0],
      [100, 0],
    ]);
  });

  it('refuses a plan with no pages, so nothing is deleted by accident', async () => {
    expect(await refusal(arrangePdf([await pdfOf(1)], []))).toBe('empty-plan');
  });

  it('refuses a page or a file that does not exist', async () => {
    const a = await pdfOf(2);
    expect(await refusal(arrangePdf([a], [{ file: 0, page: 2 }]))).toBe('no-such-page');
    expect(await refusal(arrangePdf([a], [{ file: 1, page: 0 }]))).toBe('no-such-file');
  });

  it('refuses a turn that is not a quarter turn', async () => {
    const a = await pdfOf(1);
    expect(await refusal(arrangePdf([a], [{ file: 0, page: 0, rotate: 45 }]))).toBe('bad-rotation');
  });

  it('refuses more steps than the limit', async () => {
    const a = await pdfOf(1);
    const plan = Array.from({ length: MAX_STEPS + 1 }, () => ({ file: 0, page: 0 }));
    expect(await refusal(arrangePdf([a], plan))).toBe('too-many-pages');
  });

  it('refuses bytes that are not a PDF', async () => {
    const junk = new TextEncoder().encode('not a pdf at all');
    expect(await refusal(arrangePdf([junk], [{ file: 0, page: 0 }]))).toBe('unreadable');
  });

  it('refuses a file that costs more to open than the budget allows', async () => {
    const bomb = new Uint8Array(objectStreamBomb(400_000));
    expect(await refusal(arrangePdf([bomb], [{ file: 0, page: 0 }]))).toBe('too-costly');
  }, 30_000);

  it('refuses an encrypted PDF, which it could copy only as garbage', async () => {
    // Made by pypdf with an RC4-128 password; 828 bytes.
    const encrypted = new Uint8Array(readFileSync(ENCRYPTED));
    expect(await refusal(arrangePdf([encrypted], [{ file: 0, page: 0 }]))).toBe('encrypted');
  });

  it('refuses a signed PDF until the caller has been told the signature will go', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const plain = await doc.save();
    // Not a valid signature, but the marker a signed file carries and the only thing looked for.
    const marked = new Uint8Array([
      ...plain,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    expect(await refusal(arrangePdf([marked], [{ file: 0, page: 0 }]))).toBe('signed');
    const out = await arrangePdf([marked], [{ file: 0, page: 0 }], { acceptSignatureLoss: true });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

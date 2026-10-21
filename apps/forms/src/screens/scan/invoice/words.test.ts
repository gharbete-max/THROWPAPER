import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readInvoice } from '@tp/shared/payable';
import { fixtures, invoicePdf } from '../../../../../../fixtures/invoices/invoices.js';
import { openPdf, type Pdfjs } from '../../forms/builder/paper/extract.js';
import { wordsFromRecognised, wordsFromRuns } from './words.js';

const require = createRequire(import.meta.url);
/** pdf.js in Node: the same legacy build the browser loads, its worker run in-process. */
async function nodePdfjs(): Promise<Pdfjs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  return pdfjs;
}

/** The PDF path end to end: a real PDF's text layer, read by the code the screen runs, then the rules. */
describe.each(fixtures)('a PDF of the synthetic invoice $name', (fixture) => {
  it('is read from its text layer into every field it should have', async () => {
    const bytes = Buffer.from(invoicePdf(fixture), 'latin1');
    const pdf = await openPdf(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      0,
      nodePdfjs,
    );
    try {
      const reading = readInvoice(wordsFromRuns(await pdf.text(0), 1));
      const { expected } = fixture;
      expect(reading.total.candidates[0]?.value).toBe(BigInt(expected.total));
      expect(reading.currency.candidates[0]?.value).toBe(expected.currency);
      expect(reading.dueDate.candidates[0]?.value).toBe(expected.dueDate);
      expect(reading.bank.candidates[0]?.value).toEqual(expected.bank);
      expect(reading.reference.candidates[0]?.value).toEqual({
        kind: expected.reference.kind,
        value: expected.reference.value,
      });
      expect(reading.reference.candidates[0]?.check).toBe('passed');
      expect(reading.vat.candidates[0]?.value).toBe(BigInt(expected.vat!));
      for (const field of [reading.total, reading.dueDate, reading.bank, reading.reference]) {
        expect(field.status).toBe('found');
      }
    } finally {
      await pdf.close();
    }
  });
});

describe('words from the two readers', () => {
  it('divides a run among its words by characters', () => {
    const [a, b] = wordsFromRuns([{ text: 'ab cd', x: 0.1, y: 0.2, w: 0.5, h: 0.02 }], 2);
    expect(a).toMatchObject({ text: 'ab', page: 2, x0: 0.1, confidence: 100 });
    expect(a!.x1).toBeCloseTo(0.3);
    expect(b!.x0).toBeCloseTo(0.4);
    expect(b!.x1).toBeCloseTo(0.6);
  });
  it('divides optical reading’s pixel boxes by the picture, and keeps its confidence', () => {
    const [word] = wordsFromRecognised(
      {
        width: 1000,
        height: 2000,
        engine: 'test',
        lines: [
          {
            baseline: { x0: 0, y0: 0, x1: 0, y1: 0 },
            rowHeight: 10,
            words: [
              { text: ' 12 ', confidence: 61.5, bbox: { x0: 100, y0: 200, x1: 300, y1: 240 } },
              { text: '  ', confidence: 99, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
            ],
          },
        ],
      },
      1,
    );
    expect(word).toEqual({
      page: 1,
      text: '12',
      x0: 0.1,
      x1: 0.3,
      y0: 0.1,
      y1: 0.12,
      confidence: 61.5,
    });
  });
});

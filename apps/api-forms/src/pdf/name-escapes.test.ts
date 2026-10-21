import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { arrangePdf } from './arrange.js';
import { editPdf, redactPdf } from './edit.js';
import { fillPdf, pdfFields } from './fill.js';
import { shrinkPdf } from './shrink.js';

/**
 * A PDF name may spell any byte as `#` and two hex digits, so `/Byte#52ange` is `/ByteRange`. The
 * "already signed" and "encrypted" checks must read the name, not the spelling.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);
const text = (s: string) => new TextEncoder().encode(s);

async function formPdf(register?: (doc: PDFDocument) => void, objectStreams = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  doc.getForm().createTextField('name').addToPage(page, { x: 5, y: 5, width: 50, height: 20 });
  register?.(doc);
  return doc.save({ useObjectStreams: objectStreams });
}

const withTail = async (tail: string) => new Uint8Array([...(await formPdf()), ...text(tail)]);

/** A signature dictionary kept inside a compressed object stream, where no byte scan sees it. */
async function signedInObjectStream(): Promise<Uint8Array> {
  const bytes = await formPdf((doc) => {
    doc.context.register(
      doc.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 1, 2, 3] }),
    );
  }, true);
  expect(Buffer.from(bytes).includes('ByteRange')).toBe(false);
  return bytes;
}

const signedVariants: [string, () => Promise<Uint8Array>][] = [
  ['one escaped letter', () => withTail('\n% /Byte#52ange [0 1 2 3]\n')],
  ['lower-case hex', () => withTail('\n% /ByteRa#6ege [0 1 2 3]\n')],
  ['every letter escaped', () => withTail('\n% /#42#79#74#65#52#61#6e#67#65 [0 1 2 3]\n')],
  ['inside an object stream', signedInObjectStream],
];

const encryptedVariants: [string, string][] = [
  ['one escaped letter', '\ntrailer << /Encr#79pt 9 0 R >>\n'],
  ['first letter escaped', '\ntrailer << /#45ncrypt 9 0 R >>\n'],
];

const code = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );

const uses = {
  arrange: (b: Uint8Array, accept = false) =>
    arrangePdf([b], [{ file: 0, page: 0 }], { acceptSignatureLoss: accept }),
  edit: (b: Uint8Array, accept = false) =>
    editPdf(b, [{ page: 0, x: 1, y: 1, text: 'a', size: 10 }], { acceptSignatureLoss: accept }),
  redact: (b: Uint8Array, accept = false) =>
    redactPdf(b, [{ page: 0, image: new Uint8Array(PNG) }], { acceptSignatureLoss: accept }),
  fill: (b: Uint8Array, accept = false) =>
    fillPdf(b, { name: 'x' }, { acceptSignatureLoss: accept }),
  fields: (b: Uint8Array, accept = false) => pdfFields(b, { acceptSignatureLoss: accept }),
  shrink: (b: Uint8Array) => shrinkPdf(b),
};

describe('a signature or encryption written with #-escapes is still seen', () => {
  for (const [variant, make] of signedVariants) {
    for (const [route, run] of Object.entries(uses)) {
      it(`${route} calls a PDF signed (${variant})`, async () => {
        const signed = await make();
        expect(await code(run(signed))).toBe('signed');
        if (route !== 'shrink') await expect(run(signed, true)).resolves.toBeTruthy();
      });
    }
  }

  for (const [variant, tail] of encryptedVariants) {
    for (const [route, run] of Object.entries(uses)) {
      it(`${route} calls a PDF encrypted (${variant})`, async () => {
        expect(await code(run(await withTail(tail)))).toBe('encrypted');
      });
    }
  }
});

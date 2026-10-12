import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ArrangeRefusal } from './arrange.js';
import { fillPdf, pdfFields } from './fill.js';

/** A one-page PDF with a text box, a tick box and a drop-down of its own. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 10, y: 250, width: 200, height: 20 });
  form.createCheckBox('agree').addToPage(page, { x: 10, y: 200, width: 20, height: 20 });
  const pick = form.createDropdown('size');
  pick.addOptions(['small', 'large']);
  pick.addToPage(page, { x: 10, y: 150, width: 100, height: 20 });
  return doc.save();
}

async function readBack(bytes: Uint8Array) {
  const form = (await PDFDocument.load(bytes)).getForm();
  return {
    name: form.getTextField('name').getText(),
    agree: form.getCheckBox('agree').isChecked(),
    size: form.getDropdown('size').getSelected(),
  };
}

const refusal = async (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: unknown) => (error instanceof ArrangeRefusal ? error.code : String(error)),
  );

describe('a PDF’s own fields', () => {
  it('lists each field with its kind, options and current value', async () => {
    expect(await pdfFields(await formPdf())).toEqual([
      { name: 'name', kind: 'text', value: '' },
      { name: 'agree', kind: 'checkbox', value: false },
      { name: 'size', kind: 'choice', options: ['small', 'large'], value: '' },
    ]);
  });

  it('writes the values it is given and leaves the rest as they were', async () => {
    const out = await fillPdf(await formPdf(), { name: 'Åsa Öberg', agree: true });
    expect(await readBack(out)).toEqual({ name: 'Åsa Öberg', agree: true, size: [] });
    const again = await fillPdf(out, { size: 'large' });
    expect(await readBack(again)).toEqual({ name: 'Åsa Öberg', agree: true, size: ['large'] });
  });

  it('refuses a field the PDF does not have, an option it does not offer, and text it cannot draw', async () => {
    const pdf = await formPdf();
    expect(await refusal(fillPdf(pdf, { nope: 'x' }))).toBe('no-such-field');
    expect(await refusal(fillPdf(pdf, { size: 'medium' }))).toBe('bad-value');
    expect(await refusal(fillPdf(pdf, { name: 'Заявка' }))).toBe('unencodable');
  });

  it('says so when there is nothing to fill', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await refusal(pdfFields(await doc.save()))).toBe('no-fields');
  });

  it('refuses an encrypted PDF, and a signed one until the person has agreed', async () => {
    const pdf = await formPdf();
    const encrypted = Buffer.concat([
      Buffer.from(pdf),
      Buffer.from('\ntrailer << /Encrypt 9 0 R >>\n'),
    ]);
    expect(await refusal(fillPdf(encrypted, { name: 'x' }))).toBe('encrypted');
    const signed = Buffer.concat([Buffer.from(pdf), Buffer.from('\n% /ByteRange [0 1 2 3]\n')]);
    expect(await refusal(fillPdf(signed, { name: 'x' }))).toBe('signed');
    expect(await refusal(pdfFields(signed))).toBe('signed');
    await expect(
      fillPdf(signed, { name: 'x' }, { acceptSignatureLoss: true }),
    ).resolves.toBeTruthy();
  });
});

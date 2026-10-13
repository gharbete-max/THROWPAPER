import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decodePDFRawStream,
  degrees,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { objectStreamBomb } from '../test-pdf-bomb.js';
import { editPdf, EditRefusal, redactPdf, type EditOp } from './edit.js';

/** pdf.js reads standard fonts' widths from files; without them it drops text it cannot measure. */
const STANDARD_FONTS = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;
const ENCRYPTED = new URL('../../../../fixtures/pdf/encrypted.pdf', import.meta.url);

/** Three pages whose words differ, so what an operation did to which page can be read back. */
const WORDS = ['ALPHA secret 111', 'BRAVO secret 222', 'CHARLIE secret 333'];

async function fixture(
  options: { rotate?: number; linkTo?: number; title?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, words] of WORDS.entries()) {
    const page = doc.addPage([300, 400]);
    page.drawText(words, { x: 40, y: 300, size: 18, font });
    if (options.rotate && i === 1) page.setRotation(degrees(options.rotate));
  }
  if (options.title) doc.setTitle(options.title);
  if (options.linkTo !== undefined) {
    // A link on page 0 that jumps to another page: the way a redacted page could ride along.
    const target = doc.getPage(options.linkTo).ref;
    const link = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 50, 50],
      Border: [0, 0, 0],
      Dest: [target, 'Fit'],
    });
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
  }
  return doc.save();
}

/** What pdf.js reads from each page: the text a person can search and copy. */
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

/** Every byte the file holds that could spell a word: raw, and every stream inflated. */
async function everyByte(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let all = Buffer.from(bytes).toString('latin1');
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    // Standard fonts write their text as hex strings; shown as (text) so a word can be looked for.
    const readable = (raw: Uint8Array) =>
      Buffer.from(raw)
        .toString('latin1')
        .replace(
          /<([0-9A-Fa-f]{2,})>/g,
          (_, hex: string) => `(${Buffer.from(hex, 'hex').toString('latin1')})`,
        );
    if (object instanceof PDFRawStream) all += readable(decodePDFRawStream(object).decode());
    else if (object instanceof PDFStream) all += readable(object.getContents());
  }
  return all;
}

/** A grey PNG of the given size, written by hand so the test needs no image library. */
function png(width: number, height: number, claim?: { width: number; height: number }): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(claim?.width ?? width, 0);
  header.writeUInt32BE(claim?.height ?? height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grey
  const rows = Buffer.alloc((width + 1) * height, 0x40);
  for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0; // filter: none
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EditRefusal);
  return error as EditRefusal;
};

const text = (page: number, words: string, extra: Partial<EditOp> = {}): EditOp =>
  ({ page, x: 40, y: 200, text: words, size: 14, ...extra }) as EditOp;

describe('editPdf: add text', () => {
  it('writes Latin text, å ä ö and all, on the page named and leaves the others alone', async () => {
    const out = await editPdf(await fixture(), [text(1, 'Åke Östling: räksmörgås – 25 €')]);
    const pages = await textOf(out);
    expect(pages[1]).toContain('Åke Östling: räksmörgås – 25 €');
    expect(pages[0]).toBe(WORDS[0]);
    expect(pages[2]).toBe(WORDS[2]);
  });

  it('writes the Danish, Icelandic, German, French and Spanish letters without embedding a font', async () => {
    const words = 'Blåbærgrød þýðing Größe œuvre ñandú ¿Qué?';
    const plain = await fixture();
    const out = await editPdf(plain, [text(0, words, { size: 8 })]);
    expect((await textOf(out))[0]).toContain(words);
    // Helvetica is a standard font: the file grows by a few hundred bytes, not by a font.
    expect(out.length - plain.length).toBeLessThan(2_000);
  });

  it('writes Russian, with digits and quotation marks from the other font', async () => {
    const out = await editPdf(await fixture(), [text(0, 'Привет, «мир» 42!')]);
    expect((await textOf(out))[0]).toContain('Привет, «мир» 42!');
  });

  it('writes Japanese and Chinese, embedding only the glyphs used', async () => {
    const plain = await fixture();
    const ja = await editPdf(plain, [text(0, 'こんにちは、世界 2026')]);
    expect((await textOf(ja))[0]).toContain('こんにちは、世界 2026');
    const zh = await editPdf(plain, [text(2, '你好，世界。汉字')]);
    expect((await textOf(zh))[2]).toContain('你好，世界。汉字');
    // The fonts are 1.6 MB each; what the PDF gained is a few KB.
    expect(ja.length - plain.length).toBeLessThan(60_000);
    expect(zh.length - plain.length).toBeLessThan(60_000);
  });

  it('writes text with lines and mixed scripts in one go', async () => {
    const out = await editPdf(await fixture(), [text(0, 'Namn: Björk\nИмя: Анна\n名前: 山田')]);
    const [first] = await textOf(out);
    for (const part of ['Namn: Björk', 'Имя: Анна', '名前: 山田']) expect(first).toContain(part);
  });

  it('refuses characters no font has, naming them, and changes nothing', async () => {
    const error = await refusal(editPdf(await fixture(), [text(0, 'ok'), text(1, 'hej 😀 مرحبا')]));
    expect(error.code).toBe('unsupported-glyphs');
    expect(error.characters).toContain('😀');
    expect(error.characters).toContain('م');
  });

  it('refuses a Chinese character outside the font rather than printing a box', async () => {
    // 毖 is one of the 1 051 GB 2312 hanzi the Simplified Chinese subset lacks (and Japanese too).
    const error = await refusal(editPdf(await fixture(), [text(0, '你好毖')]));
    expect(error.code).toBe('unsupported-glyphs');
    expect(error.characters).toEqual(['毖']);
  });

  it('turns text on a turned page so that it reads upright', async () => {
    const out = await editPdf(await fixture({ rotate: 90 }), [text(1, 'Upright')]);
    const pdf = await getDocument({
      data: new Uint8Array(out),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
    const content = await (await pdf.getPage(2)).getTextContent();
    const item = content.items.find((i) => 'str' in i && i.str === 'Upright');
    // pdf.js reports the text matrix in page space: a quarter turn counter-clockwise, which the
    // page's /Rotate 90 turns back to horizontal.
    expect(
      (item as { transform: number[] }).transform.slice(0, 4).map((v) => Math.round(v / 14) + 0),
    ).toEqual([0, 1, -1, 0]);
    await pdf.loadingTask.destroy();
  });
});

describe('editPdf: cover and replace', () => {
  it('covers with paint, which leaves the words under it in the file', async () => {
    const out = await editPdf(await fixture(), [
      { page: 1, rect: { x: 30, y: 290, width: 200, height: 30 }, fill: '#ffffff' },
    ]);
    // Honest about what a cover is: the text is still there, which is why redaction exists.
    expect((await textOf(out))[1]).toBe(WORDS[1]);
    const doc = await PDFDocument.load(out);
    const contents = doc.getPage(1).node.Contents();
    expect(contents).toBeDefined();
    const all = await everyByte(out);
    expect(all).toMatch(/1 1 1 rg/);
    expect(all).toMatch(/1 0 0 1 30 290 cm[\s\S]*200 30 l/);
  });

  it('replace is a cover and then an add, in that order', async () => {
    const out = await editPdf(await fixture(), [
      { page: 0, rect: { x: 30, y: 290, width: 200, height: 30 }, fill: '#ffffff' },
      text(0, 'REPLACED', { x: 40, y: 300, size: 18 }),
    ]);
    expect((await textOf(out))[0]).toContain('REPLACED');
    const all = await everyByte(out);
    expect(all.indexOf('1 1 1 rg')).toBeGreaterThan(-1);
    expect(all.indexOf('1 1 1 rg')).toBeLessThan(all.indexOf('(REPLACED)'));
  });

  it('draws in the colour asked for', async () => {
    const out = await editPdf(await fixture(), [text(0, 'Red', { color: '#ff0000' })]);
    expect(await everyByte(out)).toMatch(/1 0 0 rg/);
  });
});

describe('editPdf: refusals', () => {
  const cases: Array<[string, EditOp[]]> = [
    ['a page that is not there', [text(5, 'x')]],
    ['a negative page', [text(-1, 'x')]],
    ['empty text', [text(0, '   ')]],
    ['a size of zero', [text(0, 'x', { size: 0 })]],
    ['a huge size', [text(0, 'x', { size: 1000 })]],
    ['a position that is not a number', [text(0, 'x', { x: Number.NaN })]],
    ['a colour that is not #rrggbb', [text(0, 'x', { color: 'red' })]],
    [
      'a cover of no width',
      [{ page: 0, rect: { x: 0, y: 0, width: 0, height: 5 }, fill: '#000000' }],
    ],
    ['a cover with no colour', [{ page: 0, rect: { x: 0, y: 0, width: 5, height: 5 }, fill: '' }]],
  ];
  it.each(cases)('refuses %s', async (_name, ops) => {
    const error = await refusal(editPdf(await fixture(), ops));
    expect(['bad-op', 'no-such-page']).toContain(error.code);
  });

  it('refuses no operations and too many', async () => {
    expect((await refusal(editPdf(await fixture(), []))).code).toBe('no-ops');
    const many = Array.from({ length: 201 }, () => text(0, 'x'));
    expect((await refusal(editPdf(await fixture(), many))).code).toBe('too-many-ops');
  });

  it('refuses an encrypted PDF, a bomb, and a signed one until the person has agreed', async () => {
    const encrypted = new Uint8Array(readFileSync(ENCRYPTED));
    expect((await refusal(editPdf(encrypted, [text(0, 'x')]))).code).toBe('encrypted');
    const bomb = new Uint8Array(objectStreamBomb(400_000));
    expect((await refusal(editPdf(bomb, [text(0, 'x')]))).code).toBe('too-costly');

    const plain = await fixture();
    const marked = new Uint8Array([
      ...plain,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    expect((await refusal(editPdf(marked, [text(0, 'x')]))).code).toBe('signed');
    const out = await editPdf(marked, [text(0, 'x')], { acceptSignatureLoss: true });
    expect((await textOf(out))[0]).toContain('x');
  }, 30_000);
});

describe('redactPdf: the redacted text is gone', () => {
  it('leaves no text on the page, none of its words anywhere in the file, and the other pages as they were', async () => {
    const source = await fixture({ title: 'BRAVO secret title' });
    expect(await everyByte(source)).toContain('BRAVO secret 222');

    const out = await redactPdf(source, [{ page: 1, image: png(120, 160) }]);

    // The proof: what pdf.js can extract.
    expect(await textOf(out)).toEqual([WORDS[0], '', WORDS[2]]);
    // And the stronger claim: no byte of the file, raw or inflated, spells it.
    const all = await everyByte(out);
    expect(all).not.toContain('BRAVO');
    expect(all).not.toContain('222');
    expect(all).toContain('ALPHA secret 111');
    expect(all).toContain('CHARLIE secret 333');
    // The page keeps its size.
    const doc = await PDFDocument.load(out);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [300, 400],
      [300, 400],
      [300, 400],
    ]);
  });

  it('does not bring a redacted page along through a link to it', async () => {
    const source = await fixture({ linkTo: 1 });
    const out = await redactPdf(source, [{ page: 1, image: png(30, 40) }]);
    expect(await textOf(out)).toEqual([WORDS[0], '', WORDS[2]]);
    expect(await everyByte(out)).not.toContain('BRAVO');
  });

  it('redacts several pages and sizes a turned page as it is shown', async () => {
    const out = await redactPdf(await fixture({ rotate: 90 }), [
      { page: 0, image: png(30, 40) },
      { page: 1, image: png(40, 30) },
    ]);
    expect(await textOf(out)).toEqual(['', '', WORDS[2]]);
    const doc = await PDFDocument.load(out);
    expect([doc.getPage(1).getWidth(), doc.getPage(1).getHeight()]).toEqual([400, 300]);
    expect(await everyByte(out)).not.toMatch(/ALPHA|BRAVO/);
  });

  it('refuses what is not a usable request', async () => {
    const source = await fixture();
    const code = async (promise: Promise<unknown>) => (await refusal(promise)).code;
    expect(await code(redactPdf(source, []))).toBe('no-ops');
    expect(await code(redactPdf(source, [{ page: 3, image: png(3, 4) }]))).toBe('no-such-page');
    expect(await code(redactPdf(source, [{ page: 0, image: new Uint8Array([1, 2, 3]) }]))).toBe(
      'bad-image',
    );
    expect(
      await code(redactPdf(source, [{ page: 0, image: png(3, 4, { width: 9000, height: 9000 }) }])),
    ).toBe('image-too-large');
    const encrypted = new Uint8Array(readFileSync(ENCRYPTED));
    expect(await code(redactPdf(encrypted, [{ page: 0, image: png(3, 4) }]))).toBe('encrypted');
    const marked = new Uint8Array([
      ...source,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    expect(await code(redactPdf(marked, [{ page: 0, image: png(3, 4) }]))).toBe('signed');
    const out = await redactPdf(marked, [{ page: 0, image: png(3, 4) }], {
      acceptSignatureLoss: true,
    });
    expect(await textOf(out)).toEqual(['', WORDS[1], WORDS[2]]);
  });
});

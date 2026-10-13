import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([100 + i * 10, 200]);
  return doc.save();
}

/** A one-pixel grey PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);

/** A real multipart body, so the parser is exercised rather than bypassed. */
async function post(
  url: string,
  files: Uint8Array[],
  fields: Record<string, string>,
  signedIn = true,
) {
  const form = new FormData();
  for (const [index, file] of files.entries()) {
    form.append('file', new File([new Uint8Array(file)], `f${index}`));
  }
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  if (!boundary) throw new Error('no boundary');
  return harness.app.inject({
    method: 'POST',
    url,
    headers: {
      ...(signedIn ? bearer(token) : {}),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
}

describe('POST /v1/pdf/edit', () => {
  it('puts text and a cover on the page named, for any signed-in person', async () => {
    const response = await post('/v1/pdf/edit', [await pdfOf(2)], {
      ops: JSON.stringify([
        { page: 1, rect: { x: 0, y: 0, width: 50, height: 20 }, fill: '#ffffff' },
        { page: 1, x: 10, y: 100, text: 'Привет', size: 12 },
      ]),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await PDFDocument.load(response.rawPayload)).getPageCount()).toBe(2);
  });

  it('is not open to somebody who is not signed in', async () => {
    const response = await post('/v1/pdf/edit', [await pdfOf(1)], { ops: '[]' }, false);
    expect(response.statusCode).toBe(401);
  });

  it('says what is wrong, in codes a screen can translate', async () => {
    const one = [await pdfOf(1)];
    const code = async (response: Awaited<ReturnType<typeof post>>) => response.json().error.code;
    expect(await code(await post('/v1/pdf/edit', one, {}))).toBe('bad-ops');
    expect(await code(await post('/v1/pdf/edit', one, { ops: '[{"page":0}]' }))).toBe('bad-ops');
    expect(await code(await post('/v1/pdf/edit', one, { ops: '[]' }))).toBe('no-ops');
    expect(await code(await post('/v1/pdf/edit', [], { ops: '[]' }))).toBe('no-file');
    const far = await post('/v1/pdf/edit', one, {
      ops: '[{"page":3,"x":1,"y":1,"text":"a","size":10}]',
    });
    expect(far.statusCode).toBe(400);
    expect(await code(far)).toBe('no-such-page');
  });

  it('names the characters it cannot print', async () => {
    const response = await post('/v1/pdf/edit', [await pdfOf(1)], {
      ops: '[{"page":0,"x":1,"y":1,"text":"hi 😀","size":10}]',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('unsupported-glyphs');
    expect(response.json().error.fields.characters).toEqual(['😀']);
  });

  it('refuses a signed PDF with a conflict until the person has agreed', async () => {
    const plain = await pdfOf(1);
    const signed = new Uint8Array([
      ...plain,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    const ops = '[{"page":0,"x":1,"y":1,"text":"a","size":10}]';
    expect((await post('/v1/pdf/edit', [signed], { ops })).statusCode).toBe(409);
    const agreed = await post('/v1/pdf/edit', [signed], { ops, acceptSignatureLoss: 'true' });
    expect(agreed.statusCode).toBe(200);
  });
});

describe('POST /v1/pdf/redact', () => {
  it('replaces the pages named with the pictures sent', async () => {
    const response = await post('/v1/pdf/redact', [await pdfOf(2), new Uint8Array(PNG)], {
      pages: '[1]',
    });
    expect(response.statusCode).toBe(200);
    const out = await PDFDocument.load(response.rawPayload);
    expect(out.getPages().map((page) => page.getWidth())).toEqual([100, 110]);
  });

  it('wants one picture for each page named', async () => {
    const response = await post('/v1/pdf/redact', [await pdfOf(2), new Uint8Array(PNG)], {
      pages: '[0,1]',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('no-file');
    const badPages = await post('/v1/pdf/redact', [await pdfOf(2), new Uint8Array(PNG)], {});
    expect(badPages.json().error.code).toBe('bad-pages');
  });

  it('refuses a picture that is not a PNG', async () => {
    const response = await post('/v1/pdf/redact', [await pdfOf(1), new Uint8Array([1, 2, 3])], {
      pages: '[0]',
    });
    expect(response.json().error.code).toBe('bad-image');
  });
});

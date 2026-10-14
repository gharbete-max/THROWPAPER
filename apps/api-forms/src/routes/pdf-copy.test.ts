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

const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

const COPY = {
  mode: 'copy',
  widthPt: 300,
  heightPt: 400,
  lines: [{ x1: 10, y1: 20, x2: 290, y2: 20, width: 1 }],
  words: [{ text: 'Hello', x: 10, y: 50, size: 12 }],
};

/** A real multipart body, so the parser is exercised rather than bypassed. */
async function post(copy: unknown, photo?: Buffer, signedIn = true) {
  const form = new FormData();
  if (photo) form.append('file', new File([new Uint8Array(photo)], 'p.png', { type: 'image/png' }));
  form.set('copy', typeof copy === 'string' ? copy : JSON.stringify(copy));
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  return harness.app.inject({
    method: 'POST',
    url: '/v1/pdf/copy',
    headers: {
      ...(signedIn ? bearer(token) : {}),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
}

describe('POST /v1/pdf/copy', () => {
  it('draws a digital copy from lines and words, with no file, for any signed-in person', async () => {
    const response = await post(COPY);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-copy-replaced']).toBe('0');
    const page = (await PDFDocument.load(response.rawPayload)).getPage(0);
    expect([page.getWidth(), page.getHeight()]).toEqual([300, 400]);
  });

  it('makes the searchable kind from the photograph', async () => {
    const response = await post({ ...COPY, mode: 'searchable', lines: [] }, PHOTO);
    expect(response.statusCode).toBe(200);
    expect((await PDFDocument.load(response.rawPayload)).getPageCount()).toBe(1);
  });

  it('refuses a searchable copy with no photograph, and a copy that is not one', async () => {
    expect((await post({ ...COPY, mode: 'searchable' })).statusCode).toBe(400);
    expect((await post('{"mode":"copy"}')).statusCode).toBe(400);
    expect((await post('not json')).statusCode).toBe(400);
  });

  it('is not open to somebody who is not signed in', async () => {
    expect((await post(COPY, undefined, false)).statusCode).toBe(401);
  });
});

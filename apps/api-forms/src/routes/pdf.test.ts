import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

let harness: TestHarness;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness();
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([100 + i * 10, 200]);
  return doc.save();
}

/** A real multipart body, so the parser is exercised rather than bypassed. */
async function arrange(
  files: Uint8Array[],
  fields: Record<string, string>,
  options: { token?: string | null } = {},
) {
  const form = new FormData();
  for (const [index, file] of files.entries()) {
    form.append(
      'file',
      new File([new Uint8Array(file)], `f${index}.pdf`, { type: 'application/pdf' }),
    );
  }
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  if (!boundary) throw new Error('no boundary');
  const body = Buffer.from(await encoded.arrayBuffer());
  return harness.app.inject({
    method: 'POST',
    url: '/v1/pdf/arrange',
    headers: {
      ...(options.token === null ? {} : bearer(options.token ?? operatorToken)),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

const widths = async (response: { rawPayload: Buffer }) =>
  (await PDFDocument.load(response.rawPayload)).getPages().map((page) => page.getWidth());

describe('POST /v1/pdf/arrange', () => {
  it('puts two uploaded files together in the order the plan names, for any signed-in person', async () => {
    const response = await arrange([await pdfOf(2), await pdfOf(1)], {
      plan: JSON.stringify([
        { file: 1, page: 0 },
        { file: 0, page: 1 },
      ]),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await widths(response)).toEqual([100, 110]);
  });

  it('is not open to somebody who is not signed in', async () => {
    const response = await arrange(
      [await pdfOf(1)],
      { plan: '[{"file":0,"page":0}]' },
      { token: null },
    );
    expect(response.statusCode).toBe(401);
  });

  it('says what is wrong with a plan, in a code a screen can translate', async () => {
    const one = [await pdfOf(1)];
    expect((await arrange(one, {})).json().error.code).toBe('bad-plan');
    expect((await arrange(one, { plan: 'not json' })).json().error.code).toBe('bad-plan');
    expect((await arrange(one, { plan: '[]' })).json().error.code).toBe('empty-plan');
    const missing = await arrange(one, { plan: '[{"file":0,"page":4}]' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('no-such-page');
    expect((await arrange([], { plan: '[{"file":0,"page":0}]' })).json().error.code).toBe(
      'no-file',
    );
  });

  it('refuses an encrypted PDF', async () => {
    const encrypted = new Uint8Array(
      readFileSync(new URL('../../../../fixtures/pdf/encrypted.pdf', import.meta.url)),
    );
    const response = await arrange([encrypted], { plan: '[{"file":0,"page":0}]' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('encrypted');
  });

  it('refuses a signed PDF with a conflict until the person has agreed to lose the signature', async () => {
    const plain = await pdfOf(1);
    const signed = new Uint8Array([
      ...plain,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    const plan = JSON.stringify([{ file: 0, page: 0 }]);
    const refused = await arrange([signed], { plan });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('signed');
    const agreed = await arrange([signed], { plan, acceptSignatureLoss: 'true' });
    expect(agreed.statusCode).toBe(200);
  });

  it('does not take more files than the limit', async () => {
    const files = await Promise.all(Array.from({ length: 15 }, () => pdfOf(1)));
    const response = await arrange(files, { plan: '[{"file":0,"page":0}]' });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('too-many-files');
  });

  it('refuses a file over the size limit, and a second file after it does not break the request', async () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    const response = await arrange([big, await pdfOf(1)], { plan: '[{"file":1,"page":0}]' });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('too-large');
  }, 30_000);

  it('does not touch the audit trail or store anything', async () => {
    const before = await harness.repos.audit.list(adminUser.organisationId);
    await arrange([await pdfOf(1)], { plan: '[{"file":0,"page":0}]' });
    expect(await harness.repos.audit.list(adminUser.organisationId)).toEqual(before);
  });
});

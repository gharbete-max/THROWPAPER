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
  options: { token?: string | null; url?: string } = {},
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
    url: options.url ?? '/v1/pdf/arrange',
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

  it('takes a photograph as a page, and refuses one that claims too many pixels', async () => {
    // A JPEG that is only a header (1600 x 1200), and a PNG header claiming 40000 x 40000.
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40];
    const components = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    const photo = new Uint8Array([0xff, 0xd8, ...sof, ...components, 0xff, 0xd9]);
    const plan = '[{"file":0,"page":0},{"file":1,"page":0}]';
    const ok = await arrange([photo, await pdfOf(1)], { plan });
    expect(ok.statusCode).toBe(200);
    expect((await widths(ok)).map(Math.round)).toEqual([842, 100]);

    const bomb = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    );
    bomb.writeUInt32BE(40000, 16);
    bomb.writeUInt32BE(40000, 20);
    const refused = await arrange([new Uint8Array(bomb)], { plan: '[{"file":0,"page":0}]' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('image-too-large');
  });

  it('does not take more files than the limit', async () => {
    const files = await Promise.all(Array.from({ length: 45 }, () => pdfOf(1)));
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

describe('POST /v1/pdf/word', () => {
  const send = (payload: unknown, token: string | null = operatorToken) =>
    harness.app.inject({
      method: 'POST',
      url: '/v1/pdf/word',
      headers: token === null ? {} : bearer(token),
      payload: payload as never,
    });
  const blocks = [{ kind: 'paragraph', runs: [{ text: '<script>x</script> Hej', bold: true }] }];

  it('lays the blocks out, escaped, and returns a PDF to any signed-in person', async () => {
    const response = await send({ blocks, lang: 'sv-SE' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    const html = harness.renderer.rendered.at(-1) ?? '';
    expect(html).toContain('<html lang="sv-SE">');
    expect(html).toContain('<strong>&lt;script&gt;x&lt;/script&gt; Hej</strong>');
    expect(html).not.toContain('<script>x');
  });

  it('is not open to somebody who is not signed in', async () => {
    expect((await send({ blocks }, null)).statusCode).toBe(401);
  });

  it('refuses a body that is not blocks, an unknown kind, or a picture that is not a PNG, JPEG or GIF', async () => {
    expect((await send({})).statusCode).toBe(400);
    expect((await send({ blocks: [] })).statusCode).toBe(400);
    expect((await send({ blocks: [{ kind: 'script', src: 'x' }] })).statusCode).toBe(400);
    const svg = { kind: 'image', mime: 'image/svg+xml', data: 'AAAA' };
    expect((await send({ blocks: [svg] })).statusCode).toBe(400);
    expect((await send({ blocks, lang: '"><script>' })).statusCode).toBe(400);
  });
});

describe('POST /v1/pdf/fields and /v1/pdf/fill', () => {
  async function withFields(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    doc
      .getForm()
      .createTextField('name')
      .addToPage(page, { x: 10, y: 100, width: 150, height: 20 });
    return doc.save();
  }

  it('lists a PDF’s own fields, then returns it filled, storing and auditing nothing', async () => {
    const pdf = await withFields();
    const before = await harness.repos.audit.list(adminUser.organisationId);
    const listed = await arrange([pdf], {}, { url: '/v1/pdf/fields' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().fields).toEqual([{ name: 'name', kind: 'text', value: '' }]);

    const filled = await arrange(
      [pdf],
      { values: JSON.stringify({ name: 'Åsa' }) },
      { url: '/v1/pdf/fill' },
    );
    expect(filled.statusCode).toBe(200);
    expect(filled.headers['content-type']).toBe('application/pdf');
    expect(
      (await PDFDocument.load(filled.rawPayload)).getForm().getTextField('name').getText(),
    ).toBe('Åsa');
    expect(await harness.repos.audit.list(adminUser.organisationId)).toEqual(before);
  });

  it('refuses in codes a screen can translate', async () => {
    const pdf = await withFields();
    const fill = (values: string, files = [pdf], extra: Record<string, string> = {}) =>
      arrange(files, { values, ...extra }, { url: '/v1/pdf/fill' });
    expect((await fill('nope')).json().error.code).toBe('bad-values');
    expect((await fill('{"x":"1"}')).json().error.code).toBe('no-such-field');
    expect((await fill('{"name":"Заявка"}')).json().error.code).toBe('unencodable');
    const plain = await pdfOf(1);
    expect((await arrange([plain], {}, { url: '/v1/pdf/fields' })).json().error.code).toBe(
      'no-fields',
    );
    const signed = new Uint8Array([
      ...pdf,
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    const refused = await fill('{"name":"x"}', [signed]);
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'signed']);
    const agreed = await fill('{"name":"x"}', [signed], { acceptSignatureLoss: 'true' });
    expect(agreed.statusCode).toBe(200);
    const encrypted = new Uint8Array(
      readFileSync(new URL('../../../../fixtures/pdf/encrypted.pdf', import.meta.url)),
    );
    expect((await fill('{}', [encrypted])).json().error.code).toBe('encrypted');
    const anonymous = await arrange([pdf], { values: '{}' }, { url: '/v1/pdf/fill', token: null });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('POST /v1/pdf/shrink', () => {
  it('hands back a smaller PDF with the same pages, for anyone signed in', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    doc.context.register(doc.context.stream(new Uint8Array(200_000).fill(65)));
    const bulky = await doc.save({ useObjectStreams: false });
    const response = await arrange([bulky], {}, { url: '/v1/pdf/shrink' });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeLessThan(bulky.length / 2);
    expect(await widths(response)).toEqual([100]);
    const anonymous = await arrange([bulky], {}, { url: '/v1/pdf/shrink', token: null });
    expect(anonymous.statusCode).toBe(401);
  });

  it('refuses a signed file as a 409', async () => {
    const signed = new Uint8Array([
      ...(await pdfOf(1)),
      ...new TextEncoder().encode('\n% /ByteRange [0 1 2 3]\n'),
    ]);
    const response = await arrange([signed], {}, { url: '/v1/pdf/shrink' });
    expect([response.statusCode, response.json().error.code]).toEqual([409, 'signed']);
  });
});

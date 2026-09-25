import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { objectStreamBomb } from '../test-pdf-bomb.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

/**
 * The paper a form is made from: stored privately, read back only through the form that lists it.
 */

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;
let formId: string;

/** A real one-page PDF: the upload is opened on a budget now, and a header alone has no pages. */
const PDF = await (async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
})();
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const PDF_KEY = `${createHash('sha256').update(PDF).digest('hex')}.pdf`;

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'paper', title: { 'sv-SE': 'Papper', 'en-GB': 'Paper' } },
  });
  formId = created.json().id;
});

async function upload(content: Buffer, options: { token?: string; filename?: string } = {}) {
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array(content)], options.filename ?? 'old-form.pdf', {
      type: 'application/pdf',
    }),
  );
  const encoded = new Response(form as never);
  const boundary = /boundary=(.+)$/.exec(encoded.headers.get('content-type') ?? '')?.[1];
  return harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${formId}/paper`,
    headers: {
      ...bearer(options.token ?? adminToken),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
}

function saveDraft(paper: formSchemas.Paper | undefined) {
  return harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${formId}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, paper } },
  });
}

function read(key: string, token = adminToken) {
  return harness.app.inject({
    method: 'GET',
    url: `/v1/forms/${formId}/paper/${key}`,
    headers: bearer(token),
  });
}

describe('adding paper to a form', () => {
  it('stores a PDF under its content hash', async () => {
    const response = await upload(PDF);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      key: PDF_KEY,
      contentType: 'application/pdf',
      bytes: PDF.length,
    });
  });

  it('judges the bytes, not the filename', async () => {
    const response = await upload(HTML, { filename: 'form.pdf' });
    expect(response.statusCode).toBe(400);
  });

  it('refuses anything over the attachment cap', async () => {
    const response = await upload(Buffer.concat([PDF, Buffer.alloc(formSchemas.MAX_UPLOAD_BYTES)]));
    expect(response.statusCode).toBe(413);
  });

  it('is refused to somebody who cannot edit the form', async () => {
    const response = await upload(PDF, { token: operatorToken });
    expect([403, 404]).toContain(response.statusCode);
  });
});

describe('reading paper back', () => {
  beforeEach(async () => {
    await upload(PDF);
  });

  it('is a 404 until the draft lists the key', async () => {
    expect((await read(PDF_KEY)).statusCode).toBe(404);

    expect((await saveDraft({ sources: [{ key: PDF_KEY, pages: 1 }] })).statusCode).toBe(200);
    const response = await read(PDF_KEY);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.rawPayload.equals(PDF)).toBe(true);
  });

  it('is a 404 for somebody who cannot see the form', async () => {
    await saveDraft({ sources: [{ key: PDF_KEY, pages: 1 }] });
    expect((await read(PDF_KEY, operatorToken)).statusCode).toBe(404);
  });

  it('never builds a path from the key', async () => {
    await saveDraft({ sources: [{ key: PDF_KEY, pages: 1 }] });
    expect((await read('..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(404);
  });
});

describe("what may join a draft's paper list", () => {
  it('a file uploaded to this form, and not a key borrowed from anywhere else', async () => {
    const mine = await upload(PDF);
    expect(mine.statusCode).toBe(201);
    const ok = await saveDraft({ sources: [{ key: mine.json().key, pages: 1 }] });
    expect(ok.statusCode).toBe(200);

    // A key that exists in the store but was never uploaded to this form — somebody else's
    // attachment, or another form's paper — is refused, and so cannot be read back through it.
    const elsewhere = await harness.uploadStore.put(
      Buffer.concat([PDF, Buffer.from('\n% another')]),
      'pdf',
    );
    const refused = await saveDraft({ sources: [{ key: elsewhere.key, pages: 1 }] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('unknown-paper');
    expect((await read(elsewhere.key)).statusCode).toBe(404);
  });
});

describe('a PDF that costs too much to open', () => {
  it('is refused on upload, and the server answers others meanwhile', async () => {
    const bomb = objectStreamBomb(400_000);
    const pending = upload(bomb);
    const started = Date.now();
    const health = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1_000);

    const response = await pending;
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('pdf-too-costly');
    expect(harness.uploadStore.files?.size ?? 0).toBe(0);
  }, 20_000);

  it('refuses a file that says it is a PDF and has no pages', async () => {
    const response = await upload(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(16)]));
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('unreadable-pdf');
  });
});

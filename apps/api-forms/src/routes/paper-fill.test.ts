import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
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
 * `GET /v1/submissions/:id/paper.pdf` — the filled-in sheet, with the admission card's access.
 *
 * The harness's fake renderer returns bytes pdf-lib cannot open, so the happy path is proved in
 * `documents/paper.test.ts` with a stand-in that returns real pages; here the renderer is that
 * same stand-in, and what is on trial is the route: who may ask, and what a form without paper
 * says.
 */

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness(undefined, {
    renderer: {
      rendered: [],
      async render() {
        throw new Error('not used here');
      },
      async renderPages(html) {
        const doc = await PDFDocument.create();
        for (const [, w, h] of html.matchAll(/@page p\d+ \{ size: ([\d.]+)pt ([\d.]+)pt/g)) {
          doc.addPage([Number(w), Number(h)]).drawRectangle({ x: 0, y: 0, width: 0, height: 0 });
        }
        return Buffer.from(await doc.save());
      },
      async close() {},
    },
  });
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

/** A published form, with or without paper, and one complete submission of it. */
async function formWithSubmission(paper: boolean) {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'blankett', title: { 'sv-SE': 'Blankett', 'en-GB': 'Form' } },
  });
  const formId = created.json().id as string;

  let sources: formSchemas.Paper['sources'] = [];
  if (paper) {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const stored = await harness.uploadStore.put(Buffer.from(await doc.save()), 'pdf');
    sources = [{ key: stored.key, pages: 1 }];
  }

  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${formId}/draft`,
    headers: bearer(adminToken),
    payload: {
      definition: {
        ...formSchemas.emptyDefinition,
        ...(paper ? { paper: { sources } } : {}),
        fields: [
          {
            id: 'f1',
            key: 'name',
            type: 'short_text',
            label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
            required: true,
            ...(paper ? { paper: { page: 0, x: 0.2, y: 0.1, w: 0.5, h: 0.03 } } : {}),
          },
        ],
      },
    },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${formId}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: true },
  });
  await harness.app.inject({
    method: 'POST',
    url: '/public/forms/blankett',
    payload: { locale: 'sv-SE', values: { name: 'Alva Öberg' } },
  });

  const listed = await harness.app.inject({
    method: 'GET',
    url: `/v1/forms/${formId}/submissions`,
    headers: bearer(adminToken),
  });
  return listed.json().submissions[0].id as string;
}

describe('the filled-in paper', () => {
  it('comes back as a PDF with a page per page of the paper', async () => {
    const submissionId = await formWithSubmission(true);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/paper.pdf`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/-paper\.pdf"$/);
    expect((await PDFDocument.load(response.rawPayload)).getPageCount()).toBe(1);
  });

  it('is a 409 for a form that was not made from paper', async () => {
    const submissionId = await formWithSubmission(false);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/paper.pdf`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no-paper');
  });

  it('is a 404 for somebody who cannot see the form', async () => {
    const submissionId = await formWithSubmission(true);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/paper.pdf`,
      headers: bearer(operatorToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

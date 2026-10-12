import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
 * `POST /v1/forms/:id/draft.pdf` — a form as the author's own document: no submission row, no
 * published version (phase "Forms" of `docs/plan/DOCUMENTS.md`). The harness renderer records the
 * HTML it is asked to print, which is where the content of the page can be checked cheaply.
 */

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

async function draftForm(): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'utkast', title: { 'sv-SE': 'Utkast', 'en-GB': 'Draft form' } },
  });
  const id = created.json().id as string;
  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/draft`,
    headers: bearer(adminToken),
    payload: {
      definition: {
        ...formSchemas.emptyDefinition,
        fields: [
          { id: 'a', key: 'name', type: 'short_text', label: { 'sv-SE': 'Namn' }, required: true },
          {
            id: 'b',
            key: 'extra',
            type: 'short_text',
            label: { 'sv-SE': 'Tillägg' },
            showWhen: {
              match: 'all',
              conditions: [{ fieldKey: 'name', operator: 'equals', value: 'x' }],
            },
          },
          { id: 'c', key: 'sig', type: 'signature', label: { 'sv-SE': 'Underskrift' } },
        ],
      },
    },
  });
  return id;
}

const draftPdf = (id: string, payload: unknown, token = adminToken) =>
  harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${id}/draft.pdf`,
    headers: bearer(token),
    payload: payload as never,
  });

describe('a form’s draft as a PDF', () => {
  it('is a blank to write on: every question, a ruled line each, nothing said to be sent', async () => {
    const id = await draftForm();
    const response = await draftPdf(id, {});
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="/);
    const html = harness.renderer.rendered.at(-1)!;
    for (const label of ['Namn', 'Tillägg', 'Underskrift']) expect(html).toContain(label);
    expect(html.match(/<span class="blank">/g)).toHaveLength(3);
    expect(html).not.toContain('class="closing"');
    expect(html).not.toContain('class="meta"');
  });

  it('writes the answers it is given, and never the key of a stored file or signature', async () => {
    const id = await draftForm();
    await draftPdf(id, { locale: 'sv-SE', values: { name: 'Åsa Öberg', sig: 'secret/key.png' } });
    const html = harness.renderer.rendered.at(-1)!;
    expect(html).toContain('Åsa Öberg');
    expect(html).not.toContain('secret/key.png');
  });

  it('writes no submission and publishes nothing', async () => {
    const id = await draftForm();
    await draftPdf(id, { values: { name: 'Åsa' } });
    const form = await harness.repos.forms.findById(adminUser.organisationId, id);
    expect(form?.publishedVersion).toBeNull();
    expect(form?.publishedVersionId).toBeNull();
    expect(await harness.repos.submissions.list(adminUser.organisationId, id)).toEqual([]);
    expect(await harness.repos.forms.listVersions(id)).toEqual([]);
  });

  it('is a 404 for somebody who cannot see the form, and a 401 for nobody', async () => {
    const id = await draftForm();
    expect((await draftPdf(id, {}, operatorToken)).statusCode).toBe(404);
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/draft.pdf`,
      payload: {},
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

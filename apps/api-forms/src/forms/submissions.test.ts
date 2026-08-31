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

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

const nameField = {
  id: 'f1',
  key: 'full_name',
  type: 'short_text' as const,
  label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
  required: true,
};

const emailField = {
  id: 'f2',
  key: 'email',
  type: 'email' as const,
  label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
  required: true,
};

async function publishForm() {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  const id = created.json().id as string;

  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/draft`,
    headers: bearer(adminToken),
    payload: {
      definition: { ...formSchemas.emptyDefinition, fields: [nameField, emailField] },
    },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${id}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: false },
  });
  return id;
}

function submit(values: Record<string, unknown>) {
  return harness.app.inject({
    method: 'POST',
    url: '/public/forms/anmalan',
    payload: { locale: 'sv-SE', values },
  });
}

function listSubmissions(id: string, token = adminToken) {
  return harness.app.inject({
    method: 'GET',
    url: `/v1/forms/${id}/submissions`,
    headers: bearer(token),
  });
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('listing submissions', () => {
  it('returns the answers with the definition needed to label them', async () => {
    const id = await publishForm();
    await submit({ full_name: 'Björn Öberg', email: 'bjorn@example.com' });

    const response = await listSubmissions(id);
    expect(response.statusCode).toBe(200);
    expect(response.json().submissions).toHaveLength(1);
    expect(response.json().submissions[0].data.full_name).toBe('Björn Öberg');
    expect(response.json().definition.fields.map((f: { key: string }) => f.key)).toEqual([
      'full_name',
      'email',
    ]);
  });

  it('reports which version each submission was filled against', async () => {
    const id = await publishForm();
    await submit({ full_name: 'Alva', email: 'alva@example.com' });
    expect((await listSubmissions(id)).json().submissions[0].formVersion).toBe(1);
  });

  it('is readable by an operator — they run the event day to day', async () => {
    const id = await publishForm();
    expect((await listSubmissions(id, operatorToken)).statusCode).toBe(200);
  });

  it('requires authentication — submissions are not public', async () => {
    const id = await publishForm();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}/submissions`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('404s a form in another organisation', async () => {
    const response = await listSubmissions('44444444-4444-4444-8444-444444444444');
    expect(response.statusCode).toBe(404);
  });

  it('includes partial submissions so an operator can see who started', async () => {
    const id = await publishForm();
    await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { full_name: 'Halvvägs' } },
    });

    const submissions = (await listSubmissions(id)).json().submissions;
    expect(submissions).toHaveLength(1);
    expect(submissions[0].status).toBe('partial');
    expect(submissions[0].submittedAt).toBeNull();
  });
});

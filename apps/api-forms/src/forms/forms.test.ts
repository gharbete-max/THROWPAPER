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

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

const swedishOnlyField = {
  id: 'f1',
  key: 'first_name',
  type: 'short_text' as const,
  label: { 'sv-SE': 'Förnamn' },
  required: true,
};

const bilingualField = {
  ...swedishOnlyField,
  label: { 'sv-SE': 'Förnamn', 'en-GB': 'First name' },
};

async function createForm(slug = 'varmotet') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug, title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  return response;
}

function saveDraft(id: string, fields: unknown[]) {
  return harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, fields } },
  });
}

function publish(id: string, override = false) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${id}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: override },
  });
}

describe('form CRUD', () => {
  it('creates a form with an empty definition', async () => {
    const response = await createForm();
    expect(response.statusCode).toBe(201);
    expect(response.json().draftDefinition.fields).toEqual([]);
    expect(response.json().status).toBe('draft');
  });

  it('refuses a duplicate slug — the public link must be unambiguous', async () => {
    await createForm('varmotet');
    const clash = await createForm('varmotet');
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('slug-taken');
  });

  it('rejects a slug that would not survive a URL', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'Vår Anmälan!', title: { 'sv-SE': 'Anmälan' } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lets operators read forms but not build them', async () => {
    const { id } = (await createForm()).json();

    const read = await harness.app.inject({
      method: 'GET',
      url: '/v1/forms',
      headers: bearer(operatorToken),
    });
    expect(read.statusCode).toBe(200);

    const write = await saveDraftAs(operatorToken, id);
    expect(write.statusCode).toBe(403);
  });

  function saveDraftAs(token: string, id: string) {
    return harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/draft`,
      headers: bearer(token),
      payload: { definition: formSchemas.emptyDefinition },
    });
  }
});

describe('the draft', () => {
  it('autosaves without creating a version', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [bilingualField]);

    const versions = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}/versions`,
      headers: bearer(adminToken),
    });
    expect(versions.json().versions).toEqual([]);
  });

  it('refuses a definition that is not a valid form', async () => {
    const { id } = (await createForm()).json();
    const response = await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/draft`,
      headers: bearer(adminToken),
      payload: { definition: { schemaVersion: 1, fields: [{ type: 'signature' }] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports completeness per locale as the draft changes', async () => {
    const { id } = (await createForm()).json();
    const saved = await saveDraft(id, [swedishOnlyField]);

    const english = saved.json().completeness.find((c: { locale: string }) => c.locale === 'en-GB');
    expect(english.complete).toBe(false);
    expect(english.missing).toContain('field.f1.label');
  });
});

describe('publishing', () => {
  it('blocks on missing required translations', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [swedishOnlyField]);

    const response = await publish(id);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('translations-incomplete');
    expect(response.json().error.fields['en-GB']).toContain('field.f1.label');
  });

  it('allows an explicit override, and records it in the audit log', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [swedishOnlyField]);

    const response = await publish(id, true);
    expect(response.statusCode).toBe(200);
    expect(response.json().publishedVersion).toBe(1);

    const entry = harness.state.audit.find((e) => e.action === 'form.published_with_override');
    expect(entry).toBeTruthy();
    expect(harness.state.formVersions[0]?.translationOverride).toBe(true);
  });

  it('blocks a form that collects nothing', async () => {
    const { id } = (await createForm()).json();
    const response = await publish(id);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('definition-problems');
  });

  it('blocks duplicate field keys, which would silently lose answers', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [bilingualField, { ...bilingualField, id: 'f2' }]);

    const response = await publish(id);
    expect(response.json().error.message).toContain('first_name');
  });

  it('publishes a complete form and numbers versions upward', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [bilingualField]);

    expect((await publish(id)).json().publishedVersion).toBe(1);
    await saveDraft(id, [bilingualField, { ...bilingualField, id: 'f2', key: 'last_name' }]);
    expect((await publish(id)).json().publishedVersion).toBe(2);

    const versions = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}/versions`,
      headers: bearer(adminToken),
    });
    expect(versions.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('leaves published versions untouched when the draft changes afterwards', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [bilingualField]);
    await publish(id);

    await saveDraft(id, [{ ...bilingualField, key: 'renamed' }]);

    // The snapshot must still describe what people were actually shown.
    const snapshot = harness.state.formVersions[0]?.definition as { fields: { key: string }[] };
    expect(snapshot.fields[0]?.key).toBe('first_name');
  });
});

describe('version history', () => {
  it('restores an old version into the draft without republishing', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [bilingualField]);
    await publish(id);
    await saveDraft(id, [{ ...bilingualField, key: 'changed_my_mind' }]);

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/versions/1/restore`,
      headers: bearer(adminToken),
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json().draftDefinition.fields[0].key).toBe('first_name');
    // Restoring is not publishing.
    expect(restored.json().publishedVersion).toBe(1);
    expect(harness.state.formVersions).toHaveLength(1);
    expect(harness.state.audit.some((e) => e.action === 'form.version_restored')).toBe(true);
  });

  it('404s for a version that does not exist', async () => {
    const { id } = (await createForm()).json();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/versions/9/restore`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

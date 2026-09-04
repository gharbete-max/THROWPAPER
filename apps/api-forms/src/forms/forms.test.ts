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

function saveDraft(id: string, fields: unknown[], settings: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/draft`,
    headers: bearer(adminToken),
    payload: {
      definition: {
        ...formSchemas.emptyDefinition,
        fields,
        settings: { ...formSchemas.emptyDefinition.settings, ...settings },
      },
    },
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

  /**
   * The rule that replaced "only administrators may build forms".
   *
   * Everybody gets their own workspace, so everybody can fill it. What protects a form is who
   * owns it, not what role its author holds.
   */
  it('lets anybody build a form of their own', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(operatorToken),
      payload: { slug: 'oskars-enkat', title: { 'sv-SE': 'Enkät' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().access).toBe('owner');

    expect((await saveDraftAs(operatorToken, created.json().id)).statusCode).toBe(200);
  });

  /**
   * Somebody else's form is **404, not 403**.
   *
   * A 403 would confirm the form exists to somebody who has no business knowing that. Both
   * requests below are the same denial wearing the same answer.
   */
  it("keeps one person's form out of another's reach", async () => {
    const { id } = (await createForm()).json();

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/forms',
      headers: bearer(operatorToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().forms).toEqual([]);

    expect((await saveDraftAs(operatorToken, id)).statusCode).toBe(404);
    const read = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}`,
      headers: bearer(operatorToken),
    });
    expect(read.statusCode).toBe(404);
  });

  /** Sharing is the way in, and an editor share is enough to save the draft. */
  it('opens a form to a colleague when it is shared with them', async () => {
    const { id } = (await createForm()).json();

    const shared = await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/shares`,
      headers: bearer(adminToken),
      payload: { email: operatorUser.email, role: 'editor' },
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().shares).toHaveLength(1);

    expect((await saveDraftAs(operatorToken, id)).statusCode).toBe(200);

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/v1/forms?scope=shared',
      headers: bearer(operatorToken),
    });
    expect(mine.json().forms.map((form: { id: string }) => form.id)).toEqual([id]);
    expect(mine.json().forms[0].access).toBe('editor');
  });

  /** A viewer may read the form and its responses, and may not change either. */
  it('stops a viewer share short of editing', async () => {
    const { id } = (await createForm()).json();
    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/shares`,
      headers: bearer(adminToken),
      payload: { email: operatorUser.email, role: 'viewer' },
    });

    const read = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}`,
      headers: bearer(operatorToken),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().access).toBe('viewer');

    expect((await saveDraftAs(operatorToken, id)).statusCode).toBe(403);
  });

  /** Reading every form in the organisation is an administrator's privilege, not a query string. */
  it('refuses scope=all to anybody but an administrator', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/forms?scope=all',
      headers: bearer(operatorToken),
    });
    expect(response.statusCode).toBe(403);
  });

  describe('the bin', () => {
    it('takes a form out of the ordinary list and puts it in the bin', async () => {
      const { id } = (await createForm()).json();

      const trashed = await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${id}/trash`,
        headers: bearer(adminToken),
      });
      expect(trashed.statusCode).toBe(200);
      expect(trashed.json().deletedAt).not.toBeNull();

      expect((await listAs(adminToken, 'active')).json().forms).toEqual([]);
      expect(
        (await listAs(adminToken, 'trash')).json().forms.map((f: { id: string }) => f.id),
      ).toEqual([id]);
    });

    it('puts it back where it was', async () => {
      const { id } = (await createForm()).json();
      await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${id}/trash`,
        headers: bearer(adminToken),
      });

      const restored = await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${id}/restore`,
        headers: bearer(adminToken),
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().deletedAt).toBeNull();
      expect((await listAs(adminToken, 'trash')).json().forms).toEqual([]);
    });

    /**
     * The property that makes the bin worth having: there is no single request that destroys a
     * live form. Deleting one that has not been binned is refused, not obeyed.
     */
    it('refuses to destroy a form that is not in the bin', async () => {
      const { id } = (await createForm()).json();
      const response = await harness.app.inject({
        method: 'DELETE',
        url: `/v1/forms/${id}`,
        headers: bearer(adminToken),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('not-in-bin');
    });

    it('destroys it once it is in the bin', async () => {
      const { id } = (await createForm()).json();
      await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${id}/trash`,
        headers: bearer(adminToken),
      });

      const destroyed = await harness.app.inject({
        method: 'DELETE',
        url: `/v1/forms/${id}`,
        headers: bearer(adminToken),
      });
      expect(destroyed.statusCode).toBe(204);
      expect((await listAs(adminToken, 'trash')).json().forms).toEqual([]);
    });

    /** An editor can fix a typo. Throwing the thing away is the owner's to do. */
    it('does not let an editor share bin a form', async () => {
      const { id } = (await createForm()).json();
      await harness.app.inject({
        method: 'PUT',
        url: `/v1/forms/${id}/shares`,
        headers: bearer(adminToken),
        payload: { email: operatorUser.email, role: 'editor' },
      });

      const response = await harness.app.inject({
        method: 'POST',
        url: `/v1/forms/${id}/trash`,
        headers: bearer(operatorToken),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  function listAs(token: string, scope: string) {
    return harness.app.inject({
      method: 'GET',
      url: `/v1/forms?scope=${scope}`,
      headers: bearer(token),
    });
  }

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

  /**
   * The gate asks about the languages the form offers, not every language the organisation has.
   *
   * `settings.locales` exists so an author can say "this form is in Swedish". Before this, saying
   * so changed nothing: publishing still demanded English, and the only way through was the
   * override — which is meant for a genuinely half-finished translation and records itself in the
   * audit log as one. Narrowing the form is not an override; it is the form being finished.
   */
  it('does not demand a language the form has been narrowed out of', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [swedishOnlyField], { locales: ['sv-SE'] });

    const response = await publish(id);
    expect(response.statusCode).toBe(200);
    expect(response.json().publishedVersion).toBe(1);
    // Not an override — nothing incomplete was waved through.
    expect(harness.state.formVersions[0]?.translationOverride).toBe(false);
  });

  /** Narrowing is a filter, not an escape hatch: a language it still claims is still required. */
  it('still blocks on a language the form does claim', async () => {
    const { id } = (await createForm()).json();
    await saveDraft(id, [swedishOnlyField], { locales: ['sv-SE', 'en-GB'] });

    const response = await publish(id);
    expect(response.statusCode).toBe(422);
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

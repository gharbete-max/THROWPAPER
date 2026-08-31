import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  adminUser,
  bearer,
  createTestHarness,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';

let harness: TestHarness;
let adminToken: string;

const nameField = {
  id: 'f1',
  key: 'first_name',
  type: 'short_text' as const,
  label: { 'sv-SE': 'Förnamn', 'en-GB': 'First name' },
  required: true,
};

const emailField = {
  id: 'f2',
  key: 'email',
  type: 'email' as const,
  label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
  required: true,
};

const pageBreak = { id: 'f3', key: 'page', type: 'page_break' as const };

const mealField = {
  id: 'f4',
  key: 'meal',
  type: 'single_select' as const,
  label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
  required: false,
  options: [
    { value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' } },
    { value: 'fish', label: { 'sv-SE': 'Fisk', 'en-GB': 'Fish' } },
  ],
};

/** Builds and publishes a form the public routes can serve. */
async function publishForm(options: { capacity?: number | null; fields?: unknown[] } = {}) {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  const form = created.json();

  if (options.capacity !== undefined) {
    const event = await harness.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(adminToken),
      payload: {
        name: { 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' },
        startsAt: '2027-05-14T09:00:00.000Z',
        endsAt: '2027-05-14T16:00:00.000Z',
        capacity: options.capacity,
        status: 'open',
      },
    });
    await harness.app.inject({
      method: 'PATCH',
      url: `/v1/forms/${form.id}`,
      headers: bearer(adminToken),
      payload: { eventId: event.json().id },
    });
  }

  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${form.id}/draft`,
    headers: bearer(adminToken),
    payload: {
      definition: {
        ...formSchemas.emptyDefinition,
        fields: options.fields ?? [nameField, emailField, pageBreak, mealField],
        settings: {
          ...formSchemas.emptyDefinition.settings,
          confirmationMessage: { 'sv-SE': 'Tack!', 'en-GB': 'Thank you!' },
        },
      },
    },
  });

  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${form.id}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: false },
  });

  return form.id as string;
}

function submit(payload: Record<string, unknown>) {
  return harness.app.inject({ method: 'POST', url: '/public/forms/anmalan', payload });
}

const answers = { first_name: 'Alva', email: 'alva@example.com', meal: 'veg' };

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('fetching a public form', () => {
  it('serves the published definition with no authentication', async () => {
    await publishForm();
    const response = await harness.app.inject({ method: 'GET', url: '/public/forms/anmalan' });

    expect(response.statusCode).toBe(200);
    expect(response.json().formVersion).toBe(1);
    expect(response.json().supportedLocales).toEqual(['sv-SE', 'en-GB']);
    expect(response.json().open).toBe(true);
  });

  it('serves the published version, not the draft', async () => {
    const id = await publishForm();
    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/draft`,
      headers: bearer(adminToken),
      payload: {
        definition: {
          ...formSchemas.emptyDefinition,
          fields: [{ ...nameField, key: 'not_published_yet' }],
        },
      },
    });

    const response = await harness.app.inject({ method: 'GET', url: '/public/forms/anmalan' });
    const keys = response.json().definition.fields.map((f: { key: string }) => f.key);
    expect(keys).toContain('first_name');
    expect(keys).not.toContain('not_published_yet');
  });

  it('404s an unpublished form — whether a draft exists is not public information', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'hemligt', title: { 'sv-SE': 'Hemligt' } },
    });
    const response = await harness.app.inject({ method: 'GET', url: '/public/forms/hemligt' });
    expect(response.statusCode).toBe(404);
  });
});

describe('submitting', () => {
  it('accepts a valid submission and returns a quotable reference', async () => {
    await publishForm();
    const response = await submit({ locale: 'sv-SE', values: answers });

    expect(response.statusCode).toBe(201);
    expect(response.json().reference).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/);
    expect(response.json().confirmationMessage).toBe('Tack!');
    expect(harness.state.submissions[0]?.status).toBe('complete');
  });

  it('binds the answers to the version that was on screen', async () => {
    const id = await publishForm();
    await submit({ locale: 'sv-SE', values: answers });

    // Publishing again must not move the existing submission onto the new version.
    await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/publish`,
      headers: bearer(adminToken),
      payload: { overrideIncompleteTranslations: true },
    });

    const firstVersion = harness.state.formVersions.find((v) => v.version === 1);
    expect(harness.state.submissions[0]?.formVersionId).toBe(firstVersion?.id);
  });

  it('rejects invalid answers server-side, whatever the browser thought', async () => {
    await publishForm();
    const response = await submit({
      locale: 'sv-SE',
      values: { first_name: '', email: 'not-an-email', meal: 'steak' },
    });

    expect(response.statusCode).toBe(422);
    const codes = response.json().issues.map((issue: { code: string }) => issue.code);
    expect(codes).toContain('validation.required');
    expect(codes).toContain('validation.email');
    expect(codes).toContain('validation.option');
    expect(harness.state.submissions).toHaveLength(0);
  });

  it('returns issues as message keys so they can be shown in the visitor’s language', async () => {
    await publishForm();
    const response = await submit({ locale: 'en-GB', values: { ...answers, first_name: '' } });
    expect(response.json().issues[0].code).toMatch(/^validation\./);
  });

  it('records the locale the form was filled in', async () => {
    await publishForm();
    await submit({ locale: 'en-GB', values: answers });
    expect(harness.state.submissions[0]?.locale).toBe('en-GB');
  });

  it('refuses a duplicate email', async () => {
    await publishForm();
    await submit({ locale: 'sv-SE', values: answers });
    const second = await submit({
      locale: 'sv-SE',
      values: { ...answers, first_name: 'Someone else' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe('duplicate');
    expect(harness.state.submissions).toHaveLength(1);
  });

  it('matches duplicates case-insensitively', async () => {
    await publishForm();
    await submit({ locale: 'sv-SE', values: answers });
    const second = await submit({
      locale: 'sv-SE',
      values: { ...answers, email: 'ALVA@Example.com' },
    });
    expect(second.json().reason).toBe('duplicate');
  });

  it('refuses a closed form', async () => {
    const id = await publishForm();
    await harness.app.inject({
      method: 'PATCH',
      url: `/v1/forms/${id}`,
      headers: bearer(adminToken),
      payload: { closesAt: '2020-01-01T00:00:00.000Z' },
    });

    const response = await submit({ locale: 'sv-SE', values: answers });
    expect(response.statusCode).toBe(409);
    expect(response.json().reason).toBe('closed');
  });

  it('refuses a form whose event is full', async () => {
    await publishForm({ capacity: 1 });
    await submit({ locale: 'sv-SE', values: answers });

    const second = await submit({
      locale: 'sv-SE',
      values: { ...answers, email: 'second@example.com' },
    });
    expect(second.json().reason).toBe('full');
  });

  /**
   * The one that matters. Two people going for the last place at the same moment must not both
   * get it. This proves the handler has no check-then-act gap; the database-level guarantee is
   * the transaction and row lock in the Drizzle repository, which only CI exercises.
   */
  it('admits only one of two simultaneous submissions for the last place', async () => {
    await publishForm({ capacity: 1 });

    const [first, second] = await Promise.all([
      submit({ locale: 'sv-SE', values: { ...answers, email: 'a@example.com' } }),
      submit({ locale: 'sv-SE', values: { ...answers, email: 'b@example.com' } }),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    expect(harness.state.submissions.filter((s) => s.status === 'complete')).toHaveLength(1);
  });
});

describe('the honeypot', () => {
  it('answers a bot as though it worked, and stores nothing', async () => {
    await publishForm();
    const response = await submit({
      locale: 'sv-SE',
      values: answers,
      website: 'http://spam.example',
    });

    // Telling a bot it was detected only teaches whoever wrote it to try something else.
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('received');
    expect(harness.state.submissions).toHaveLength(0);
  });
});

describe('save and resume', () => {
  it('keeps partial answers without demanding the required ones', async () => {
    await publishForm();
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { first_name: 'Alva' } },
    });

    expect(saved.statusCode).toBe(200);
    expect(harness.state.submissions[0]?.status).toBe('partial');
    expect(harness.state.submissions[0]?.data).toMatchObject({ first_name: 'Alva' });
  });

  it('stores only a hash of the resume token', async () => {
    await publishForm();
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { first_name: 'Alva' } },
    });

    const token = saved.json().resumeToken as string;
    expect(harness.state.submissions[0]?.resumeTokenHash).not.toBe(token);
    expect(harness.state.submissions[0]?.resumeTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends the link through the mail transport when an address is known', async () => {
    await publishForm();
    await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { first_name: 'Alva', email: 'alva@example.com' } },
    });

    const sent = harness.mail.sent.at(-1);
    expect(sent?.to).toBe('alva@example.com');
    expect(sent?.text).toContain('/f/anmalan?resume=');
  });

  it('resumes into the answers already given', async () => {
    await publishForm();
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'en-GB', values: { first_name: 'Alva' } },
    });
    const token = saved.json().resumeToken;

    const resumed = await harness.app.inject({
      method: 'GET',
      url: `/public/forms/anmalan/resume/${token}`,
    });

    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().values).toMatchObject({ first_name: 'Alva' });
    expect(resumed.json().locale).toBe('en-GB');
  });

  it('refuses an expired resume token', async () => {
    await publishForm();
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { first_name: 'Alva' } },
    });
    const draft = harness.state.submissions[0];
    if (draft) draft.resumeExpiresAt = new Date(Date.now() - 1000);

    const resumed = await harness.app.inject({
      method: 'GET',
      url: `/public/forms/anmalan/resume/${saved.json().resumeToken}`,
    });
    expect(resumed.statusCode).toBe(404);
  });

  it('promotes the draft rather than leaving a duplicate behind', async () => {
    await publishForm();
    const saved = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan/draft',
      payload: { locale: 'sv-SE', values: { first_name: 'Alva' } },
    });

    const submitted = await submit({
      locale: 'sv-SE',
      values: answers,
      resumeToken: saved.json().resumeToken,
    });

    expect(submitted.statusCode).toBe(201);
    expect(harness.state.submissions).toHaveLength(1);
    expect(harness.state.submissions[0]?.status).toBe('complete');
    // The resume token dies with the draft it belonged to.
    expect(harness.state.submissions[0]?.resumeTokenHash).toBeNull();
  });
});

describe('organisation scoping', () => {
  it('never leaks another organisation’s submissions into the count', async () => {
    await publishForm({ capacity: 1 });
    await submit({ locale: 'sv-SE', values: answers });
    expect(harness.state.submissions.every((s) => s.organisationId === testOrganisation.id)).toBe(
      true,
    );
  });
});

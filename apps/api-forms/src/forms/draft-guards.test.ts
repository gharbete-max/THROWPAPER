import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';

/**
 * Saving a draft is a mail-sending endpoint, and it was the unguarded one.
 *
 * `POST /public/forms/:slug/draft` emails a resume link, from the customer's verified sending
 * domain, to whatever address the answers contain — anonymously. Its sibling `POST
 * /public/forms/:slug` has a honeypot and refuses a closed form. This one had neither, which made
 * it the better of the two to abuse: no account, and no row an operator ever reads.
 *
 * These tests pin both guards and the one thing that must keep working — a real person resuming.
 */
let harness: TestHarness;
let token: string;

const DEFINITION = {
  ...formSchemas.emptyDefinition,
  fields: [
    {
      id: 'f1',
      key: 'email',
      type: 'email' as const,
      label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
      required: true,
    },
  ],
  settings: { ...formSchemas.emptyDefinition.settings, allowSaveAndResume: true },
};

async function publishForm(closesAt: string | null = null) {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(token),
    payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan' } },
  });
  const { id } = created.json();

  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/draft`,
    headers: bearer(token),
    payload: { definition: DEFINITION },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${id}/publish`,
    headers: bearer(token),
    payload: { overrideIncompleteTranslations: true },
  });

  if (closesAt) {
    await harness.app.inject({
      method: 'PATCH',
      url: `/v1/forms/${id}`,
      headers: bearer(token),
      payload: { closesAt },
    });
  }
  return id as string;
}

/**
 * Mail sent *by this call*, not in total.
 *
 * Signing in as the administrator sends a magic link, so the outbox is never empty by the time a
 * test runs. Asserting on the total counts that one and hides the answer.
 */
async function saveDraft(payload: Record<string, unknown>) {
  const before = harness.mail.sent.length;
  const response = await harness.app.inject({
    method: 'POST',
    url: '/public/forms/anmalan/draft',
    payload,
  });
  return { response, mailed: harness.mail.sent.slice(before) };
}

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('saving a draft', () => {
  it('works for a person, and sends them the link', async () => {
    await publishForm();

    const { response, mailed } = await saveDraft({
      locale: 'sv-SE',
      values: { email: 'anna@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().resumeToken).toBeTruthy();
    expect(mailed).toHaveLength(1);
    expect(mailed[0]?.to).toBe('anna@example.com');
  });

  /**
   * A bot is answered 200 with a token that resumes nothing.
   *
   * Telling a script it was detected is telling it what to change. The tell is that no mail left
   * and no draft was stored.
   */
  it('sends nothing when the honeypot is filled', async () => {
    await publishForm();

    const { response, mailed } = await saveDraft({
      locale: 'sv-SE',
      values: { email: 'victim@example.com' },
      website: 'http://spam.example',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().resumeToken).toBeTruthy();
    expect(mailed).toHaveLength(0);
    expect(harness.state.submissions).toHaveLength(0);
  });

  /** A closed form does not send mail either — the guard its sibling always had. */
  it('refuses once the form has closed', async () => {
    await publishForm('2020-01-01T00:00:00.000Z');

    const { response, mailed } = await saveDraft({
      locale: 'sv-SE',
      values: { email: 'anna@example.com' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('closed');
    expect(mailed).toHaveLength(0);
  });
});

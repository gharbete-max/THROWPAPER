import { afterEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';

/**
 * The optional e-ID step after a form is sent (CONTRACT §5.6).
 *
 * The rule it keeps: nothing is claimed that did not happen. No provider — the step says so and the
 * form is finished. The development provider — it works end to end, and says "test" everywhere.
 */
const SIGN = 'http://sign.test';
let harness: TestHarness;
let adminToken: string;

/** A Sign that offers `methods` and confirms anything with the development provider. */
function fakeSign(methods: Array<{ method: string; provider: string; environment: string }>) {
  const sessions = new Map<string, string>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${SIGN}/v1/identity/methods`) return Response.json({ methods });
    if (url === `${SIGN}/v1/identity/sessions` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { documentSha256: string };
      const reference = `ref-${sessions.size + 1}`;
      sessions.set(reference, body.documentSha256);
      return Response.json({ reference, status: 'complete', environment: 'test' }, { status: 201 });
    }
    const match = /\/v1\/identity\/sessions\/(.+)$/.exec(url);
    if (match && sessions.has(match[1]!)) {
      return Response.json({
        reference: match[1],
        status: 'complete',
        environment: 'test',
        documentSha256: sessions.get(match[1]!),
        method: 'console',
        level: 'simple',
        name: 'Test Person (console provider, not a real identity)',
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

async function setUp(options: { sign?: typeof fetch | null; identity?: 'off' | 'optional' }) {
  harness = await createTestHarness(
    {},
    options.sign
      ? { signing: { apiUrl: SIGN, serviceToken: 'test-token' }, signFetch: options.sign }
      : {},
  );
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
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
      definition: {
        ...formSchemas.emptyDefinition,
        fields: [
          {
            id: 'f1',
            key: 'full_name',
            type: 'short_text',
            label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
            required: true,
          },
        ],
        settings: { ...formSchemas.emptyDefinition.settings, identity: options.identity ?? 'off' },
      },
    },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${id}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: true },
  });
}

async function send(name: string) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/public/forms/anmalan',
    payload: { locale: 'en-GB', values: { full_name: name }, website: '' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as formSchemas.SubmitResponse;
}

const post = (url: string, payload: object) => harness.app.inject({ method: 'POST', url, payload });

afterEach(async () => {
  await harness.close();
});

describe('the optional e-ID step', () => {
  it('is not offered by a form that does not ask for it', async () => {
    await setUp({
      sign: fakeSign([{ method: 'console', provider: 'console', environment: 'test' }]),
    });
    expect((await send('Ann')).identity).toBeNull();
  });

  it('says it is unavailable when no Sign is connected, and the form is finished anyway', async () => {
    await setUp({ sign: null, identity: 'optional' });
    const sent = await send('Ann');
    expect(sent.identity).toEqual({ available: false, test: false });
    expect(sent.document).not.toBeNull();
    const started = await post('/public/forms/anmalan/identity', { token: sent.document!.token });
    expect(started.statusCode).toBe(503);
    expect(started.json().error.code).toBe('identity-unavailable');
  });

  it('says it is unavailable when Sign offers no provider — the default everywhere today', async () => {
    await setUp({ sign: fakeSign([]), identity: 'optional' });
    const sent = await send('Ann');
    expect(sent.identity).toEqual({ available: false, test: false });
    const started = await post('/public/forms/anmalan/identity', { token: sent.document!.token });
    expect(started.statusCode).toBe(503);
    expect(started.json().error.code).toBe('identity-unavailable');
  });

  it('with the development provider: confirms, records, prints — and says test at every step', async () => {
    await setUp({
      sign: fakeSign([{ method: 'console', provider: 'console', environment: 'test' }]),
      identity: 'optional',
    });
    const sent = await send('Ann');
    expect(sent.identity).toEqual({ available: true, test: true });

    const started = await post('/public/forms/anmalan/identity', { token: sent.document!.token });
    expect(started.statusCode).toBe(200);
    const { reference } = started.json() as { reference: string };

    const checked = await post('/public/forms/anmalan/identity/check', {
      token: sent.document!.token,
      reference,
    });
    expect(checked.json()).toEqual({
      status: 'complete',
      confirmed: {
        method: 'console',
        name: 'Test Person (console provider, not a real identity)',
        test: true,
      },
    });

    const row = [...harness.state.submissions.values()].find((s) => s.reference === sent.reference);
    expect(row?.identity).toMatchObject({ method: 'console', test: true });
    expect(row?.identity?.documentSha256).toMatch(/^[0-9a-f]{64}$/);

    // The finished document now says so — as a test, not as a confirmation.
    const before = harness.renderer.rendered.length;
    await post('/public/forms/anmalan/document', { token: sent.document!.token });
    const html = harness.renderer.rendered.slice(before).join('');
    expect(html).toContain('This is not an identity check.');
    expect(html).not.toContain('Confirmed with e-ID');

    // Once is enough.
    const again = await post('/public/forms/anmalan/identity', { token: sent.document!.token });
    expect(again.statusCode).toBe(409);
  });

  it('never records somebody else’s confirmation against this submission', async () => {
    await setUp({
      sign: fakeSign([{ method: 'console', provider: 'console', environment: 'test' }]),
      identity: 'optional',
    });
    const mine = await send('Ann');
    const theirs = await send('Bo');
    const started = await post('/public/forms/anmalan/identity', { token: theirs.document!.token });
    const { reference } = started.json() as { reference: string };

    // Their bound reference, presented with my token.
    const swapped = await post('/public/forms/anmalan/identity/check', {
      token: mine.document!.token,
      reference,
    });
    expect(swapped.statusCode).toBe(404);
    // And a raw Sign reference, unbound, is not accepted either.
    const raw = await post('/public/forms/anmalan/identity/check', {
      token: mine.document!.token,
      reference: reference.split('.')[0],
    });
    expect(raw.statusCode).toBe(404);
    const row = [...harness.state.submissions.values()].find((s) => s.reference === mine.reference);
    expect(row?.identity ?? null).toBeNull();
  });
});

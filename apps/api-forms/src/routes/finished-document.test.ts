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
import { signFinishedToken, deriveFinishedKey } from '../documents/finished-token.js';

/**
 * The finished document, end to end through the routes: the person who sends a form can download
 * exactly their own answers for a day; staff can download any submission they can already see.
 */
let harness: TestHarness;
let adminToken: string;

const fields = [
  {
    id: 'f1',
    key: 'full_name',
    type: 'short_text' as const,
    label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
    required: true,
  },
  {
    id: 'f2',
    key: 'email',
    type: 'email' as const,
    label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
    required: true,
  },
];

async function publish(slug: string, title: Record<string, string>) {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug, title },
  });
  const form = created.json();
  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${form.id}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, fields } },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${form.id}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: true },
  });
  return form.id as string;
}

async function send(slug: string, name: string, email: string, locale = 'sv-SE') {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/public/forms/${slug}`,
    payload: { locale, values: { full_name: name, email }, website: '' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as formSchemas.SubmitResponse;
}

function download(slug: string, token: string) {
  return harness.app.inject({
    method: 'POST',
    url: `/public/forms/${slug}/document`,
    payload: { token },
  });
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('the respondent’s finished document', () => {
  it('is offered on submit, named after the form, and downloads as a PDF of their answers', async () => {
    await publish('anmalan', { 'sv-SE': 'Vårmötet 2026', 'en-GB': 'Spring meeting 2026' });
    const sent = await send('anmalan', 'Åsa Öberg', 'asa@example.com');

    expect(sent.document).not.toBeNull();
    expect(sent.document!.filename).toBe(`Vårmötet-2026-${sent.reference}.pdf`);

    const before = harness.renderer.rendered.length;
    const response = await download('anmalan', sent.document!.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers['content-disposition']).toContain(
      `filename*=UTF-8''V%C3%A5rm%C3%B6tet-2026-${sent.reference}.pdf`,
    );
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const html = harness.renderer.rendered.slice(before).join('');
    expect(html).toContain('Åsa Öberg');
    expect(html).toContain(sent.reference);
  });

  it('is in the language the form was filled in', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' });
    const sent = await send('anmalan', 'Ann', 'ann@example.com', 'en-GB');
    expect(sent.document!.filename).toBe(`Registration-${sent.reference}.pdf`);
    const before = harness.renderer.rendered.length;
    await download('anmalan', sent.document!.token);
    expect(harness.renderer.rendered.slice(before).join('')).toContain('lang="en-GB"');
  });

  it('gives one person their own answers and never someone else’s', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const first = await send('anmalan', 'Första Person', 'first@example.com');
    const second = await send('anmalan', 'Andra Person', 'second@example.com');

    const before = harness.renderer.rendered.length;
    await download('anmalan', first.document!.token);
    const html = harness.renderer.rendered.slice(before).join('');
    expect(html).toContain('Första Person');
    expect(html).not.toContain('Andra Person');
    expect(first.document!.token).not.toBe(second.document!.token);
  });

  it('cannot be replayed through another form’s address', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    await publish('annan', { 'sv-SE': 'Annan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');
    expect((await download('annan', sent.document!.token)).statusCode).toBe(404);
  });

  it('refuses a forged, altered or foreign-key token with the same 404', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');
    const token = sent.document!.token;
    const [id, expires, mac] = token.split('.');

    const forged = signFinishedToken(
      id!,
      deriveFinishedKey('a-different-secret-thirty-two-chars-long'),
    );
    for (const bad of [
      forged,
      `${id}.${Number(expires) + 60}.${mac}`,
      `${id}.${expires}.${'A'.repeat(43)}`,
      'not-a-token',
    ]) {
      const response = await download('anmalan', bad);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('Åsa');
    }
  });

  it('is gone once the registration is withdrawn', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');
    const submission = [...harness.state.submissions.values()].find(
      (row) => row.reference === sent.reference,
    )!;
    await harness.repos.submissions.revoke(submission.organisationId, submission.id, new Date());
    expect((await download('anmalan', sent.document!.token)).statusCode).toBe(404);
  });

  it('is not offered to a bot that filled in the honeypot', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan',
      payload: {
        locale: 'sv-SE',
        values: { full_name: 'Bot', email: 'bot@example.com' },
        website: 'http://spam.example',
      },
    });
    expect(response.json().document).toBeNull();
  });

  it('keeps the token out of the URL: the route takes it in the body only', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');
    const response = await harness.app.inject({
      method: 'GET',
      url: `/public/forms/anmalan/document?token=${encodeURIComponent(sent.document!.token)}`,
    });
    expect(response.headers['content-type']).not.toBe('application/pdf');
  });

  it('says so when the PDF cannot be made, without losing the submission', async () => {
    await harness.close();
    const { createFakePdfRenderer } = await import('../test-support.js');
    harness = await createTestHarness(
      {},
      { renderer: createFakePdfRenderer({ failOn: (html) => html.includes('Åsa') }) },
    );
    adminToken = (await signIn(harness, adminUser.email)).accessToken;
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');

    const response = await download('anmalan', sent.document!.token);
    expect(response.statusCode).toBe(500);
    // The generic error shape — no stack, no path, no answer.
    expect(response.body).not.toContain('Åsa');
    expect(response.body).not.toMatch(/at .*\.ts:\d+/);
    expect(
      [...harness.state.submissions.values()].some((s) => s.reference === sent.reference),
    ).toBe(true);
  });
});

describe('staff download of a finished document', () => {
  it('gives an admin the same document the respondent got', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa Öberg', 'asa@example.com');
    const submission = [...harness.state.submissions.values()].find(
      (row) => row.reference === sent.reference,
    )!;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submission.id}/document.pdf`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      `filename="Anmalan-${sent.reference}.pdf"`,
    );
    expect(harness.renderer.rendered.at(-1)).toContain('Åsa Öberg');
  });

  it('is refused to anyone not signed in, and to an operator the form is not shared with', async () => {
    await publish('anmalan', { 'sv-SE': 'Anmälan' });
    const sent = await send('anmalan', 'Åsa', 'asa@example.com');
    const submission = [...harness.state.submissions.values()].find(
      (row) => row.reference === sent.reference,
    )!;
    const url = `/v1/submissions/${submission.id}/document.pdf`;

    expect((await harness.app.inject({ method: 'GET', url })).statusCode).toBe(401);

    const operator = (await signIn(harness, operatorUser.email)).accessToken;
    const response = await harness.app.inject({ method: 'GET', url, headers: bearer(operator) });
    expect(response.statusCode).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  TEST_JWT_SECRET,
  adminUser,
  bearer,
  createFakePdfRenderer,
  createTestHarness,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';
import { deriveQrKey, verifyAdmissionToken } from './qr-token.js';
import { renderAdmissionPdf } from './admission-service.js';

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

/** A published form attached to an event, plus `count` completed registrations. */
async function setupRegistrations(count: number) {
  const event = await harness.app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: bearer(adminToken),
    payload: {
      name: { 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' },
      startsAt: '2027-05-14T09:00:00.000Z',
      endsAt: '2027-05-14T16:00:00.000Z',
      status: 'open',
    },
  });
  const eventId = event.json().id as string;

  const created = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(adminToken),
    payload: { slug: 'anmalan', title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
  });
  const formId = created.json().id as string;

  await harness.app.inject({
    method: 'PATCH',
    url: `/v1/forms/${formId}`,
    headers: bearer(adminToken),
    payload: { eventId },
  });
  await harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${formId}/draft`,
    headers: bearer(adminToken),
    payload: { definition: { ...formSchemas.emptyDefinition, fields } },
  });
  await harness.app.inject({
    method: 'POST',
    url: `/v1/forms/${formId}/publish`,
    headers: bearer(adminToken),
    payload: { overrideIncompleteTranslations: false },
  });

  for (let index = 0; index < count; index += 1) {
    await harness.app.inject({
      method: 'POST',
      url: '/public/forms/anmalan',
      payload: {
        locale: index % 2 === 0 ? 'sv-SE' : 'en-GB',
        values: { full_name: `Björn Öberg ${index}`, email: `deltagare${index}@example.com` },
      },
    });
  }

  return { formId, eventId };
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('a single admission document', () => {
  it('returns a PDF for a registration', async () => {
    await setupRegistrations(1);
    const submissionId = harness.state.submissions[0]!.id;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${submissionId}/admission.pdf`,
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('.pdf');
  });

  it('encodes a token the check-in screen can verify offline', async () => {
    const { eventId } = await setupRegistrations(1);
    const submission = harness.state.submissions[0]!;

    // Through the service rather than the route: the QR is vector paths, so the token is not
    // scrapeable from the HTML. This is the same code path the route uses.
    const rendered = await renderAdmissionPdf(
      {
        repos: harness.repos,
        renderer: harness.renderer,
        store: harness.store,
        jwtSecret: TEST_JWT_SECRET,
      },
      testOrganisation.id,
      submission,
    );

    expect(rendered).not.toBeNull();
    expect(verifyAdmissionToken(rendered!.token, eventId, deriveQrKey(TEST_JWT_SECRET))).toEqual({
      ok: true,
      reference: submission.reference,
    });
  });

  it('will not verify that token against a different event', async () => {
    await setupRegistrations(1);
    const submission = harness.state.submissions[0]!;
    const rendered = await renderAdmissionPdf(
      {
        repos: harness.repos,
        renderer: harness.renderer,
        store: harness.store,
        jwtSecret: TEST_JWT_SECRET,
      },
      testOrganisation.id,
      submission,
    );

    const otherEvent = '99999999-9999-4999-8999-999999999999';
    expect(verifyAdmissionToken(rendered!.token, otherEvent, deriveQrKey(TEST_JWT_SECRET)).ok).toBe(
      false,
    );
  });

  it('records the generation in the audit log', async () => {
    await setupRegistrations(1);
    await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${harness.state.submissions[0]!.id}/admission.pdf`,
      headers: bearer(adminToken),
    });
    expect(harness.state.audit.some((entry) => entry.action === 'admission.generated')).toBe(true);
  });

  it('requires authentication', async () => {
    await setupRegistrations(1);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${harness.state.submissions[0]!.id}/admission.pdf`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('409s a submission with no event — there is nothing to admit anyone to', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/forms',
      headers: bearer(adminToken),
      payload: { slug: 'fristaende', title: { 'sv-SE': 'Fristående' } },
    });
    const formId = created.json().id as string;
    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${formId}/draft`,
      headers: bearer(adminToken),
      payload: { definition: { ...formSchemas.emptyDefinition, fields } },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/publish`,
      headers: bearer(adminToken),
      payload: { overrideIncompleteTranslations: true },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/public/forms/fristaende',
      payload: { locale: 'sv-SE', values: { full_name: 'Alva', email: 'a@example.com' } },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/submissions/${harness.state.submissions[0]!.id}/admission.pdf`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no-event');
  });
});

describe('bulk generation', () => {
  it('enqueues rather than rendering inline', async () => {
    const { formId } = await setupRegistrations(3);
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('queued');
    expect(response.json().progressTotal).toBe(3);
    // Nothing rendered yet — that is the point of a job.
    expect(harness.renderer.rendered).toHaveLength(0);
  });

  it('produces one document per registration and a downloadable ZIP', async () => {
    const { formId } = await setupRegistrations(3);
    const queued = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });

    await harness.app.worker.drain();

    const job = await harness.app.inject({
      method: 'GET',
      url: `/v1/jobs/${queued.json().id}`,
      headers: bearer(adminToken),
    });

    expect(job.json().status).toBe('done');
    expect(job.json().result.generated).toBe(3);
    expect(job.json().result.failed).toBe(0);
    expect(job.json().progressDone).toBe(3);
    expect(harness.store.files.size).toBe(1);
  });

  it('asking twice returns the same job rather than starting a second run', async () => {
    const { formId } = await setupRegistrations(2);
    const first = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });

    expect(second.json().id).toBe(first.json().id);
    // Only the bulk job: 4b also enqueues confirmation mail per registration.
    expect(harness.state.jobs.filter((job) => job.kind === 'admission.bulk')).toHaveLength(1);
  });

  it('survives one document failing and still delivers the rest', async () => {
    await harness.close();
    // Fail exactly the second attendee's document.
    harness = await createTestHarness(
      {},
      { renderer: createFakePdfRenderer({ failOn: (html) => html.includes('Öberg 1') }) },
    );
    adminToken = (await signIn(harness, adminUser.email)).accessToken;

    const { formId } = await setupRegistrations(3);
    const queued = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });
    await harness.app.worker.drain();

    const job = await harness.app.inject({
      method: 'GET',
      url: `/v1/jobs/${queued.json().id}`,
      headers: bearer(adminToken),
    });

    // A bulk job that aborts at row 2 of 200 is worse than useless the night before an event.
    expect(job.json().status).toBe('done');
    expect(job.json().result.generated).toBe(2);
    expect(job.json().result.failed).toBe(1);
    expect(harness.state.audit.some((e) => e.action === 'admission.render_failed')).toBe(true);
  });
});

describe('the download link', () => {
  async function generate() {
    const { formId } = await setupRegistrations(2);
    const queued = await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${formId}/admission-documents`,
      headers: bearer(adminToken),
    });
    await harness.app.worker.drain();
    const job = await harness.app.inject({
      method: 'GET',
      url: `/v1/jobs/${queued.json().id}`,
      headers: bearer(adminToken),
    });
    return job.json().result.downloadPath as string;
  }

  it('serves the ZIP to a signed link, with no bearer token', async () => {
    const path = await generate();
    // The browser follows this directly and cannot attach an Authorization header.
    const response = await harness.app.inject({ method: 'GET', url: path });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('refuses a tampered signature', async () => {
    const path = await generate();
    const tampered = path.replace(
      /signature=([0-9a-f]+)/,
      'signature=$1'.replace('$1', 'f'.repeat(64)),
    );

    const response = await harness.app.inject({ method: 'GET', url: tampered });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an expired link', async () => {
    const path = await generate();
    const expired = path.replace(/expires=\d+/, 'expires=1000000');

    const response = await harness.app.inject({ method: 'GET', url: expired });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('link-expired');
  });
});

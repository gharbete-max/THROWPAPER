import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  TEST_JWT_SECRET,
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';
import { deriveQrKey, signAdmissionToken } from '../documents/qr-token.js';
import { attendanceOf } from './service.js';
import type { SubmissionRecord } from '../db/repositories/index.js';

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

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

async function setupEvent(registrations = 1, slug = 'anmalan') {
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
    payload: { slug, title: { 'sv-SE': 'Anmälan', 'en-GB': 'Registration' } },
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

  for (let index = 0; index < registrations; index += 1) {
    await harness.app.inject({
      method: 'POST',
      url: `/public/forms/${slug}`,
      payload: {
        locale: 'sv-SE',
        values: { full_name: `Björn Öberg ${index}`, email: `deltagare${index}@example.com` },
      },
    });
  }

  return { eventId, formId };
}

function scan(eventId: string, code: string, token = operatorToken) {
  return harness.app.inject({
    method: 'POST',
    url: `/v1/events/${eventId}/check-ins`,
    headers: bearer(token),
    payload: { code },
  });
}

function tokenFor(reference: string, eventId: string) {
  return signAdmissionToken({ reference, eventId }, deriveQrKey(TEST_JWT_SECRET));
}

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

describe('admitting', () => {
  it('admits a valid card on the first scan', async () => {
    const { eventId } = await setupEvent();
    const reference = harness.state.submissions[0]!.reference;

    const response = await scan(eventId, tokenFor(reference, eventId));

    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('admitted');
    expect(response.json().attendee.name).toBe('Björn Öberg 0');
    expect(response.json().checkedInAt).toBeTruthy();
  });

  it('accepts a typed reference as well as a scanned token', async () => {
    const { eventId } = await setupEvent();
    const reference = harness.state.submissions[0]!.reference;

    const response = await scan(eventId, reference.toLowerCase());
    expect(response.json().outcome).toBe('admitted');
    expect(harness.state.checkIns[0]?.method).toBe('manual');
  });

  it('records who admitted them, and audits the arrival', async () => {
    const { eventId } = await setupEvent();
    await scan(eventId, tokenFor(harness.state.submissions[0]!.reference, eventId));

    expect(harness.state.checkIns[0]?.checkedInByUserId).toBe(operatorUser.id);
    expect(harness.state.audit.some((entry) => entry.action === 'checkin.admitted')).toBe(true);
  });

  it('lets an operator work the door — that is what the role is for', async () => {
    const { eventId } = await setupEvent();
    const response = await scan(
      eventId,
      tokenFor(harness.state.submissions[0]!.reference, eventId),
      operatorToken,
    );
    expect(response.statusCode).toBe(200);
  });

  it('requires authentication', async () => {
    const { eventId } = await setupEvent();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/check-ins`,
      payload: { code: 'ABCD-EFGH' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('the second scan', () => {
  it('reports already-arrived with the original time, and is not an error', async () => {
    const { eventId } = await setupEvent();
    const code = tokenFor(harness.state.submissions[0]!.reference, eventId);

    const first = await scan(eventId, code);
    const second = await scan(eventId, code);

    // A scanner retrying after a dropped response must not become an error at a door.
    expect(second.statusCode).toBe(200);
    expect(second.json().outcome).toBe('already');
    expect(second.json().checkedInAt).toBe(first.json().checkedInAt);
    expect(harness.state.checkIns).toHaveLength(1);
  });

  it('writes no second audit row for a repeated scan', async () => {
    const { eventId } = await setupEvent();
    const code = tokenFor(harness.state.submissions[0]!.reference, eventId);
    await scan(eventId, code);
    await scan(eventId, code);

    expect(harness.state.audit.filter((e) => e.action === 'checkin.admitted')).toHaveLength(1);
  });

  /** The same shape that caught the capacity race in 3b. */
  it('produces one row when the same card is scanned twice simultaneously', async () => {
    const { eventId } = await setupEvent();
    const code = tokenFor(harness.state.submissions[0]!.reference, eventId);

    const [a, b] = await Promise.all([scan(eventId, code), scan(eventId, code)]);

    const outcomes = [a.json().outcome, b.json().outcome].sort();
    expect(outcomes).toEqual(['admitted', 'already']);
    expect(harness.state.checkIns).toHaveLength(1);
  });
});

describe('refusing', () => {
  it('refuses a revoked registration, but still shows who it was', async () => {
    const { eventId } = await setupEvent();
    const submission = harness.state.submissions[0]!;

    await harness.app.inject({
      method: 'POST',
      url: `/v1/submissions/${submission.id}/revoke`,
      headers: bearer(adminToken),
    });

    const response = await scan(eventId, tokenFor(submission.reference, eventId));
    expect(response.json().outcome).toBe('revoked');
    // The door needs to say why, not just no.
    expect(response.json().attendee.reference).toBe(submission.reference);
    expect(harness.state.checkIns).toHaveLength(0);
  });

  it('does not erase an arrival that already happened when revoking afterwards', async () => {
    const { eventId } = await setupEvent();
    const submission = harness.state.submissions[0]!;
    await scan(eventId, tokenFor(submission.reference, eventId));

    const revoked = await harness.app.inject({
      method: 'POST',
      url: `/v1/submissions/${submission.id}/revoke`,
      headers: bearer(adminToken),
    });

    expect(revoked.json().revoked).toBe(true);
    expect(revoked.json().checkedInAt).toBeTruthy();
    expect(harness.state.checkIns).toHaveLength(1);
  });

  it('refuses a correctly signed card for a different event', async () => {
    const { eventId } = await setupEvent(1, 'anmalan');
    const other = await setupEvent(0, 'annat');
    const reference = harness.state.submissions[0]!.reference;

    // Signed properly — for the wrong door.
    const response = await scan(other.eventId, tokenFor(reference, eventId));
    expect(response.json().outcome).toBe('wrong-event');
    expect(harness.state.checkIns).toHaveLength(0);
  });

  it('refuses a tampered token', async () => {
    const { eventId } = await setupEvent();
    const reference = harness.state.submissions[0]!.reference;
    const tampered = `${reference}.AAAAAAAAAAAAAAAA`;

    const response = await scan(eventId, tampered);
    expect(response.json().outcome).toBe('bad-signature');
    expect(harness.state.checkIns).toHaveLength(0);
  });

  it('refuses a reference nobody holds', async () => {
    const { eventId } = await setupEvent();
    expect((await scan(eventId, 'ZZZZ-ZZZZ')).json().outcome).toBe('not-found');
  });

  it('only lets an admin revoke', async () => {
    await setupEvent();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/submissions/${harness.state.submissions[0]!.id}/revoke`,
      headers: bearer(operatorToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('attendance', () => {
  it('counts registered, checked in and no-show', async () => {
    const { eventId } = await setupEvent(3);
    await scan(eventId, tokenFor(harness.state.submissions[0]!.reference, eventId));

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${eventId}/attendance`,
      headers: bearer(operatorToken),
    });

    expect(response.json().registered).toBe(3);
    expect(response.json().checkedIn).toBe(1);
    expect(response.json().noShow).toBe(2);
    expect(response.json().attendees).toHaveLength(3);
  });

  it('shows the arrival time against each attendee', async () => {
    const { eventId } = await setupEvent(2);
    const arriving = harness.state.submissions[0]!;
    await scan(eventId, tokenFor(arriving.reference, eventId));

    const attendees = (
      await harness.app.inject({
        method: 'GET',
        url: `/v1/events/${eventId}/attendance`,
        headers: bearer(operatorToken),
      })
    ).json().attendees as Array<{ reference: string; checkedInAt: string | null }>;

    expect(attendees.find((a) => a.reference === arriving.reference)?.checkedInAt).toBeTruthy();
    expect(attendees.filter((a) => a.checkedInAt === null)).toHaveLength(1);
  });
});

describe('attendanceOf', () => {
  function submission(overrides: Partial<SubmissionRecord>): SubmissionRecord {
    return {
      id: 's1',
      organisationId: 'o1',
      formId: 'f1',
      formVersionId: 'v1',
      eventId: 'e1',
      reference: 'AAAA-AAAA',
      status: 'complete',
      locale: 'sv-SE',
      email: null,
      data: {},
      resumeTokenHash: null,
      resumeExpiresAt: null,
      submittedAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('does not count a revoked registration as a no-show — nobody was expecting them', () => {
    const result = attendanceOf(
      [submission({ id: 'a' }), submission({ id: 'b', revokedAt: new Date() })],
      [],
    );
    expect(result.registered).toBe(2);
    expect(result.revoked).toBe(1);
    expect(result.noShow).toBe(1);
  });

  it('ignores partial submissions', () => {
    const result = attendanceOf([submission({ id: 'a', status: 'partial' })], []);
    expect(result.registered).toBe(0);
  });

  it('buckets arrivals by hour, for spotting the rush', () => {
    const result = attendanceOf(
      [submission({ id: 'a' }), submission({ id: 'b' })],
      [
        { submissionId: 'a', checkedInAt: new Date('2027-05-14T08:12:00Z') },
        { submissionId: 'b', checkedInAt: new Date('2027-05-14T08:47:00Z') },
      ],
    );
    expect(result.byHour).toEqual([{ hour: '2027-05-14T08:00', count: 2 }]);
  });
});

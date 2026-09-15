import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';
import type { EventRecord, FormRecord, SubmissionRecord } from '../db/repositories/types.js';

/**
 * Whose registrants these are.
 *
 * Every route in `routes/forms.ts` asks `resolveFormAccess` — "is this yours" — and answers 404
 * when it is not. Three routes elsewhere asked `findById(organisationId, …)` instead, which
 * answers the much weaker "is this in your company", and each of them hands back a registrant's
 * name and email. So any signed-in operator could read, export and download the attendees of a
 * colleague's private form by knowing an id.
 *
 * The helper was module-private, which is what let three files each grow their own weaker check.
 * Being unreachable is not the same as being a boundary.
 *
 * Alva is an admin, Oskar is an operator, and the form below belongs to Alva.
 */
const EVENT: EventRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  organisationId: testOrganisation.id,
  name: { 'sv-SE': 'Vårmötet' },
  description: {},
  startsAt: new Date('2027-05-14T09:00:00Z'),
  endsAt: new Date('2027-05-14T16:00:00Z'),
  venueName: null,
  venueAddress: null,
  capacity: 100,
  registrationClosesAt: null,
  status: 'open',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/** Alva's, explicitly. An unowned form is the organisation's and everybody may read it. */
const ALVAS_FORM: FormRecord = {
  id: '55555555-5555-4555-8555-555555555555',
  organisationId: testOrganisation.id,
  eventId: EVENT.id,
  slug: 'alvas-form',
  title: { 'sv-SE': 'Anmälan' },
  status: 'published',
  draftDefinition: { schemaVersion: 1, fields: [], settings: {} },
  publishedVersionId: '66666666-6666-4666-8666-666666666666',
  publishedVersion: 1,
  opensAt: null,
  closesAt: null,
  ownerUserId: adminUser.id,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const REGISTRANT: SubmissionRecord = {
  id: '77777777-7777-4777-8777-777777777777',
  organisationId: testOrganisation.id,
  formId: ALVAS_FORM.id,
  formVersionId: ALVAS_FORM.publishedVersionId!,
  eventId: EVENT.id,
  reference: 'ABC12345',
  status: 'complete',
  locale: 'sv-SE',
  email: 'anna.lindqvist@example.com',
  data: { full_name: 'Anna Lindqvist' },
  resumeTokenHash: null,
  resumeExpiresAt: null,
  submittedAt: new Date('2026-02-01T10:00:00Z'),
  revokedAt: null,
  createdAt: new Date('2026-02-01T10:00:00Z'),
  updatedAt: new Date('2026-02-01T10:00:00Z'),
};

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness({
    events: [EVENT],
    forms: [ALVAS_FORM],
    submissions: [REGISTRANT],
  });
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

const as = (token: string, method: 'GET' | 'POST', url: string) =>
  harness.app.inject({ method, url, headers: bearer(token) });

describe("a colleague's form", () => {
  it.each([
    ['the single admission card', 'GET' as const, `/v1/submissions/${REGISTRANT.id}/admission.pdf`],
    ['the bulk export', 'POST' as const, `/v1/forms/${ALVAS_FORM.id}/admission-documents`],
  ])('is not %s an operator can reach', async (_what, method, url) => {
    const response = await as(operatorToken, method, url);

    expect(response.statusCode).toBe(404);
    // 404 rather than 403: a 403 confirms the form exists, which the asker did not know.
    expect(response.body).not.toContain('Anna Lindqvist');
    expect(response.body).not.toContain('anna.lindqvist@example.com');
  });

  /**
   * The attendee list is **deliberately not** filtered this way, and that is worth pinning.
   *
   * A review flagged it as the same class of leak: an operator reads every registrant's name and
   * email for an event whose form belongs to somebody else. Filtering it broke two existing tests,
   * and the tests were right — `routes/checkin.ts` says "Operators run the door. This is the one
   * thing the Operator role exists for."
   *
   * Form ownership governs building forms and reading responses. The door is event-scoped work
   * with its own role, and an operator standing at one needs the list for that event regardless of
   * who built the form. Narrowing it would have removed the role's only purpose to close a gap
   * that is really a product decision — so it is recorded here rather than silently re-fixed.
   */
  it('is still readable at the door, which is what the Operator role is for', async () => {
    const response = await as(operatorToken, 'GET', `/v1/events/${EVENT.id}/attendance`);

    expect(response.statusCode).toBe(200);
    expect(response.json().attendees).toHaveLength(1);
  });
});

describe('the owner, and an administrator', () => {
  it('still reaches the bulk export', async () => {
    const response = await as(adminToken, 'POST', `/v1/forms/${ALVAS_FORM.id}/admission-documents`);
    expect(response.statusCode).toBe(202);
  });

  it('still sees the attendee list', async () => {
    const response = await as(adminToken, 'GET', `/v1/events/${EVENT.id}/attendance`);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.attendees).toHaveLength(1);
    expect(body.attendees[0].email).toBe('anna.lindqvist@example.com');
    expect(body.registered).toBe(1);
  });
});

/**
 * An unowned form belongs to the organisation, and that is deliberate — it is how forms made
 * before ownership existed stay readable. This pins the distinction so the fix above cannot be
 * "tightened" into locking everybody out of the shared pile.
 */
describe('a form nobody owns', () => {
  it('is readable by an operator', async () => {
    const orphan = await createTestHarness({
      events: [EVENT],
      forms: [{ ...ALVAS_FORM, ownerUserId: null }],
      submissions: [REGISTRANT],
    });
    try {
      const token = (await signIn(orphan, operatorUser.email)).accessToken;
      const response = await orphan.app.inject({
        method: 'GET',
        url: `/v1/events/${EVENT.id}/attendance`,
        headers: bearer(token),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().attendees).toHaveLength(1);
    } finally {
      await orphan.close();
    }
  });
});

/**
 * The inbox names the person, not only the form.
 *
 * Fourteen rows all titled "Spring meeting registration" with a reference code in grey cannot
 * answer "did Anna register?" — the question the screen is opened for. The name comes from the
 * answers by the same heuristic the admission card and the door already use.
 */
describe('the inbox', () => {
  it('says who answered', async () => {
    const response = await as(adminToken, 'GET', '/v1/submissions');
    expect(response.statusCode).toBe(200);
    const [entry] = response.json().submissions;
    expect(entry.who).toBe('Anna Lindqvist');
    expect(entry.reference).toBe('ABC12345');
  });
});

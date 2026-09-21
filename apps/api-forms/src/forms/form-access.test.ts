import { createHash } from 'node:crypto';
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
import type {
  EventRecord,
  FormRecord,
  JobRecord,
  OrganisationRecord,
  SubmissionRecord,
  UploadRecord,
  UserRecord,
} from '../db/repositories/types.js';
import { ADMISSION_BULK_JOB } from '../documents/admission-service.js';
import { generateSecret, hashSecret } from '../auth/tokens.js';

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

/** A CV Anna attached to her registration. The key is the content hash, as the store makes it. */
const CV = Buffer.from('%PDF-1.4 Anna Lindqvist, curriculum vitae');
const CV_KEY = `${createHash('sha256').update(CV).digest('hex')}.pdf`;
const ATTACHMENT: UploadRecord = {
  id: '88888888-8888-4888-8888-888888888888',
  organisationId: testOrganisation.id,
  formId: ALVAS_FORM.id,
  storageKey: CV_KEY,
  filename: 'cv.pdf',
  contentType: 'application/pdf',
  bytes: CV.byteLength,
  submissionId: REGISTRANT.id,
  createdAt: new Date('2026-02-01T10:00:00Z'),
};

/** A finished bulk export of Alva's form. Its result is a signed link to every registrant's card. */
const BULK_JOB: JobRecord = {
  id: '99999999-9999-4999-8999-999999999999',
  organisationId: testOrganisation.id,
  kind: ADMISSION_BULK_JOB,
  idempotencyKey: `admission:${ALVAS_FORM.id}:1`,
  status: 'done',
  payload: { formId: ALVAS_FORM.id },
  result: { downloadPath: '/v1/documents/download?key=admission.zip&expires=1&signature=x' },
  error: null,
  attempts: 1,
  maxAttempts: 3,
  progressDone: 1,
  progressTotal: 1,
  runAfter: new Date('2026-02-01T10:00:00Z'),
  startedAt: new Date('2026-02-01T10:00:00Z'),
  finishedAt: new Date('2026-02-01T10:01:00Z'),
  createdAt: new Date('2026-02-01T10:00:00Z'),
};

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness({
    events: [EVENT],
    forms: [ALVAS_FORM],
    submissions: [REGISTRANT],
    uploads: [ATTACHMENT],
    jobs: [BULK_JOB],
  });
  harness.uploadStore.files.set(CV_KEY, CV);
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

afterEach(async () => {
  await harness.close();
});

const as = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  harness.app.inject({ method, url, headers: bearer(token), ...(payload && { payload }) });

describe("a colleague's form", () => {
  /**
   * The last two rows are audit item 13. A respondent's attachment and a finished bulk job were
   * looked up by organisation and id alone — the "is this in your company" check that the first
   * two rows had already been moved off. The attachment is the respondent's own file; the job's
   * result is a signed link to a ZIP of every registrant's card. Both are the form's data, and
   * reaching either is reaching the form.
   */
  it.each([
    ['the single admission card', 'GET' as const, `/v1/submissions/${REGISTRANT.id}/admission.pdf`],
    ['the bulk export', 'POST' as const, `/v1/forms/${ALVAS_FORM.id}/admission-documents`],
    [
      "a respondent's attachment",
      'GET' as const,
      `/v1/submissions/${REGISTRANT.id}/files/${CV_KEY}`,
    ],
    ['the bulk job with its download link', 'GET' as const, `/v1/jobs/${BULK_JOB.id}`],
  ])('is not %s an operator can reach', async (_what, method, url) => {
    const response = await as(operatorToken, method, url);

    expect(response.statusCode).toBe(404);
    // 404 rather than 403: a 403 confirms the form exists, which the asker did not know.
    expect(response.body).not.toContain('Anna Lindqvist');
    expect(response.body).not.toContain('anna.lindqvist@example.com');
    expect(response.body).not.toContain('downloadPath');
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

  it('still downloads the attachment', async () => {
    const response = await as(
      adminToken,
      'GET',
      `/v1/submissions/${REGISTRANT.id}/files/${CV_KEY}`,
    );
    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.rawPayload).equals(CV)).toBe(true);
  });

  it('still reads the bulk job and its link', async () => {
    const response = await as(adminToken, 'GET', `/v1/jobs/${BULK_JOB.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().result.downloadPath).toContain('/v1/documents/download?');
  });
});

/**
 * Audit item 10, from the outside.
 *
 * The repository tests already show `events.findById` and `submissions.listForEvent` refuse a
 * row from another organisation. This asks the question the way an attacker would: a real,
 * signed-in administrator of a *different* organisation, holding the event id, calling the route.
 * The Drizzle queries behind it carry `organisation_id` in every `where`
 * (`db/repositories/drizzle.ts`: events.findById, submissions.listForEvent,
 * checkIns.listForEvent), so the fake and the SQL agree.
 */
describe('another organisation', () => {
  const OTHER: OrganisationRecord = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Grannföreningen',
    slug: 'granne',
    defaultLocale: 'sv-SE',
    supportedLocales: ['sv-SE'],
  };
  const OTHER_ADMIN: UserRecord = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organisationId: OTHER.id,
    email: 'admin@granne.example',
    name: 'Greta Granne',
    role: 'admin',
    disabledAt: null,
  };

  /**
   * The magic link resolves `organisations.first()` (single-tenant, audit item 17), so Greta
   * cannot sign in through it. A refresh token is planted the way `e2e/support.ts` does — random
   * secret, hash stored — and exchanged through the real `/v1/auth/refresh`, which resolves the
   * organisation from the user. Everything after that is the genuine bearer path.
   */
  async function signInElsewhere(both: TestHarness): Promise<string> {
    const secret = generateSecret();
    both.state.refreshTokens.push({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      userId: OTHER_ADMIN.id,
      familyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      tokenHash: hashSecret(secret),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    const response = await both.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: secret },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(OTHER_ADMIN.id);
    return response.json().accessToken as string;
  }

  it("cannot read the attendee list of somebody else's event", async () => {
    const both = await createTestHarness({
      organisations: [testOrganisation, OTHER],
      users: [adminUser, operatorUser, OTHER_ADMIN],
      events: [EVENT],
      forms: [ALVAS_FORM],
      submissions: [REGISTRANT],
    });
    try {
      const token = await signInElsewhere(both);
      const response = await both.app.inject({
        method: 'GET',
        url: `/v1/events/${EVENT.id}/attendance`,
        headers: bearer(token),
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('Anna Lindqvist');
      expect(response.body).not.toContain('anna.lindqvist@example.com');
    } finally {
      await both.close();
    }
  });

  /**
   * Audit item 15: a form must not be pointed at an event across the boundary.
   *
   * `eventId` was written as given after a UUID-shape check. The names never leaked — the attendee
   * and check-in queries are organisation-scoped — but `events.countRegistrations` is not, so a
   * form in Greta's organisation pointing at Alva's event would have counted Greta's registrants
   * against Alva's capacity. The event has to be the caller's, on create and on update alike.
   */
  describe("pointing a form at somebody else's event", () => {
    const GRETAS_FORM: FormRecord = {
      ...ALVAS_FORM,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organisationId: OTHER.id,
      eventId: null,
      slug: 'gretas-form',
      ownerUserId: OTHER_ADMIN.id,
    };

    async function bothOrganisations() {
      return createTestHarness({
        organisations: [testOrganisation, OTHER],
        users: [adminUser, operatorUser, OTHER_ADMIN],
        events: [EVENT],
        forms: [ALVAS_FORM, GRETAS_FORM],
        submissions: [REGISTRANT],
      });
    }

    it('is refused on create, and nothing is written', async () => {
      const both = await bothOrganisations();
      try {
        const token = await signInElsewhere(both);
        const response = await both.app.inject({
          method: 'POST',
          url: '/v1/forms',
          headers: bearer(token),
          payload: { slug: 'smuggled', title: { 'sv-SE': 'Anmälan' }, eventId: EVENT.id },
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('unknown-event');
        expect(both.state.forms.filter((form) => form.slug === 'smuggled')).toEqual([]);
      } finally {
        await both.close();
      }
    });

    it('is refused on update, and the form is unchanged', async () => {
      const both = await bothOrganisations();
      try {
        const token = await signInElsewhere(both);
        const response = await both.app.inject({
          method: 'PATCH',
          url: `/v1/forms/${GRETAS_FORM.id}`,
          headers: bearer(token),
          payload: { eventId: EVENT.id },
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('unknown-event');
        expect(both.state.forms.find((form) => form.id === GRETAS_FORM.id)?.eventId).toBeNull();
      } finally {
        await both.close();
      }
    });

    /** The same requests, by the event's own organisation, still work. */
    it('is allowed for the organisation that owns the event', async () => {
      const created = await as(adminToken, 'POST', '/v1/forms', {
        slug: 'own-event',
        title: { 'sv-SE': 'Anmälan' },
        eventId: EVENT.id,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().eventId).toBe(EVENT.id);

      const detached = await as(adminToken, 'PATCH', `/v1/forms/${ALVAS_FORM.id}`, {
        eventId: null,
      });
      expect(detached.statusCode).toBe(200);
      expect(detached.json().eventId).toBeNull();

      const reattached = await as(adminToken, 'PATCH', `/v1/forms/${ALVAS_FORM.id}`, {
        eventId: EVENT.id,
      });
      expect(reattached.statusCode).toBe(200);
      expect(reattached.json().eventId).toBe(EVENT.id);
    });
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

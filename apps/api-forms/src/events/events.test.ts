import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  eventInput,
  operatorUser,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';
import { registrationOpen } from './service.js';
import type { EventRecord, SubmissionRecord } from '../db/repositories/index.js';

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

function createEvent(body: Record<string, unknown> = {}) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: bearer(adminToken),
    payload: eventInput(body),
  });
}

describe('event CRUD', () => {
  it('creates an event with text in both locales', async () => {
    const response = await createEvent();
    expect(response.statusCode).toBe(201);

    const event = response.json();
    expect(event.name['sv-SE']).toBe('Vårmötet');
    expect(event.name['en-GB']).toBe('Spring meeting');
    expect(event.missingLocales).toEqual([]);
  });

  it('reports which supported locales are still untranslated', async () => {
    const response = await createEvent({ name: { 'sv-SE': 'Endast svenska' } });
    expect(response.json().missingLocales).toEqual(['en-GB']);
  });

  it('rejects an event that ends before it starts', async () => {
    const response = await createEvent({
      startsAt: '2026-05-14T16:00:00.000Z',
      endsAt: '2026-05-14T09:00:00.000Z',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects registration closing after the event starts', async () => {
    const response = await createEvent({ registrationClosesAt: '2026-06-01T00:00:00.000Z' });
    expect(response.statusCode).toBe(400);
  });

  it('lists and fetches events', async () => {
    const created = await createEvent();
    const id = created.json().id;

    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/events',
      headers: bearer(operatorToken),
    });
    expect(list.json().events).toHaveLength(1);

    const single = await harness.app.inject({
      method: 'GET',
      url: `/v1/events/${id}`,
      headers: bearer(operatorToken),
    });
    expect(single.json().id).toBe(id);
  });

  it('404s for an event in another organisation', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/events/44444444-4444-4444-8444-444444444444',
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it('patches only the fields supplied', async () => {
    const id = (await createEvent()).json().id;
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/events/${id}`,
      headers: bearer(adminToken),
      payload: { venueName: 'Nya Salen' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().venueName).toBe('Nya Salen');
    expect(response.json().name['sv-SE']).toBe('Vårmötet');
  });
});

describe('archiving', () => {
  it('archives rather than deletes, and refuses edits afterwards', async () => {
    const id = (await createEvent()).json().id;

    const archived = await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${id}/archive`,
      headers: bearer(adminToken),
    });
    expect(archived.json().status).toBe('archived');

    // The record is still there.
    expect(harness.state.events).toHaveLength(1);

    const edit = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/events/${id}`,
      headers: bearer(adminToken),
      payload: { venueName: 'Too late' },
    });
    expect(edit.statusCode).toBe(409);
  });
});

describe('roles', () => {
  it('lets an operator read but not write', async () => {
    const id = (await createEvent()).json().id;

    const read = await harness.app.inject({
      method: 'GET',
      url: '/v1/events',
      headers: bearer(operatorToken),
    });
    expect(read.statusCode).toBe(200);

    const write = await harness.app.inject({
      method: 'PATCH',
      url: `/v1/events/${id}`,
      headers: bearer(operatorToken),
      payload: { venueName: 'Nope' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('requires a token at all', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/events' });
    expect(response.statusCode).toBe(401);
  });
});

describe('audit log', () => {
  it('records every mutation with the actor who made it', async () => {
    const id = (await createEvent()).json().id;
    await harness.app.inject({
      method: 'PATCH',
      url: `/v1/events/${id}`,
      headers: bearer(adminToken),
      payload: { venueName: 'Nya Salen' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/events/${id}/archive`,
      headers: bearer(adminToken),
    });

    const actions = harness.state.audit.map((entry) => entry.action);
    expect(actions).toEqual(['event.created', 'event.updated', 'event.archived']);
    expect(harness.state.audit.every((entry) => entry.actorUserId === adminUser.id)).toBe(true);
    expect(harness.state.audit.every((entry) => entry.organisationId === testOrganisation.id)).toBe(
      true,
    );
  });

  it('records what changed, not just that something did', async () => {
    const id = (await createEvent()).json().id;
    await harness.app.inject({
      method: 'PATCH',
      url: `/v1/events/${id}`,
      headers: bearer(adminToken),
      payload: { venueName: 'Nya Salen' },
    });

    const update = harness.state.audit.find((entry) => entry.action === 'event.updated');
    expect((update?.before as EventRecord).venueName).toBe('Storgatan 19');
    expect((update?.after as EventRecord).venueName).toBe('Nya Salen');
  });

  it('writes nothing when the request was rejected', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(operatorToken),
      payload: eventInput(),
    });
    expect(harness.state.audit).toHaveLength(0);
  });
});

describe('registrationOpen is computed, not stored', () => {
  const base: EventRecord = {
    id: 'e1',
    organisationId: testOrganisation.id,
    name: { 'sv-SE': 'Vårmötet' },
    description: {},
    startsAt: new Date('2026-05-14T09:00:00Z'),
    endsAt: new Date('2026-05-14T16:00:00Z'),
    venueName: null,
    venueAddress: null,
    capacity: 2,
    registrationClosesAt: new Date('2026-05-01T00:00:00Z'),
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const before = new Date('2026-04-01T00:00:00Z');

  it('is open while under capacity and before the closing date', () => {
    expect(registrationOpen(base, 1, before)).toBe(true);
  });

  it('closes at capacity', () => {
    expect(registrationOpen(base, 2, before)).toBe(false);
  });

  it('treats a null capacity as uncapped', () => {
    expect(registrationOpen({ ...base, capacity: null }, 10_000, before)).toBe(true);
  });

  it('closes once the closing date has passed', () => {
    expect(registrationOpen(base, 0, new Date('2026-05-02T00:00:00Z'))).toBe(false);
  });

  it('is closed unless the event itself is open', () => {
    expect(registrationOpen({ ...base, status: 'draft' }, 0, before)).toBe(false);
    expect(registrationOpen({ ...base, status: 'archived' }, 0, before)).toBe(false);
  });
});

/**
 * The count behind that pure function.
 *
 * `countRegistrations` was stubbed to return `0` while registrations were being built, and stayed
 * stubbed once they existed. Nothing displayed it, so nothing contradicted it — every event
 * reported an empty guest list and stayed open however full it was. These tests are what stops it
 * being quietly stubbed again.
 */
describe('counting the people holding a place', () => {
  function registration(overrides: Partial<SubmissionRecord> & { eventId: string }) {
    const now = new Date();
    return {
      id: randomUUID(),
      organisationId: testOrganisation.id,
      formId: 'f1',
      formVersionId: 'v1',
      reference: randomUUID().slice(0, 8).toUpperCase(),
      status: 'complete' as const,
      locale: 'sv-SE',
      email: null,
      data: {},
      resumeTokenHash: null,
      resumeExpiresAt: null,
      submittedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } satisfies SubmissionRecord;
  }

  it('counts completed registrations for the event', async () => {
    harness.state.submissions.push(
      registration({ eventId: 'e1' }),
      registration({ eventId: 'e1' }),
      registration({ eventId: 'e2' }),
    );
    expect(await harness.repos.events.countRegistrations('e1')).toBe(2);
  });

  it('does not count a half-finished form as a registration', async () => {
    harness.state.submissions.push(registration({ eventId: 'e1', status: 'partial' }));
    expect(await harness.repos.events.countRegistrations('e1')).toBe(0);
  });

  it('gives a withdrawn registration its place back', async () => {
    harness.state.submissions.push(
      registration({ eventId: 'e1' }),
      registration({ eventId: 'e1', revokedAt: new Date() }),
    );
    expect(await harness.repos.events.countRegistrations('e1')).toBe(1);
  });

  it('reports the count on the event, which is what the list screen reads', async () => {
    const created = await createEvent();
    const { id } = created.json() as { id: string };
    harness.state.submissions.push(registration({ eventId: id }));

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/events',
      headers: bearer(adminToken),
    });
    const listed = (
      response.json() as { events: Array<{ id: string; registeredCount: number }> }
    ).events.find((event) => event.id === id);
    expect(listed?.registeredCount).toBe(1);
  });
});

/**
 * Two lookups that used to be loops.
 *
 * Finding one submission meant listing every form in the organisation and reading every
 * submission of each; the attendance screen issued one query per form pointing at the event. Both
 * are single queries now, and both are scoped — a faster wrong answer is not an optimisation.
 */
describe('finding submissions without walking every form', () => {
  function row(over: Partial<SubmissionRecord> & { id?: string }) {
    const now = new Date();
    return {
      id: over.id ?? randomUUID(),
      organisationId: testOrganisation.id,
      formId: 'f1',
      formVersionId: 'v1',
      eventId: null,
      reference: randomUUID().slice(0, 8).toUpperCase(),
      status: 'complete' as const,
      locale: 'sv-SE',
      email: null,
      data: {},
      resumeTokenHash: null,
      resumeExpiresAt: null,
      submittedAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
      ...over,
    } satisfies SubmissionRecord;
  }

  it('finds one by id', async () => {
    const wanted = row({ id: '11111111-1111-4111-8111-111111111111' });
    harness.state.submissions.push(row({}), wanted, row({}));
    const found = await harness.repos.submissions.findById(testOrganisation.id, wanted.id);
    expect(found?.id).toBe(wanted.id);
  });

  it('will not find one belonging to another organisation', async () => {
    const elsewhere = row({ organisationId: '99999999-9999-4999-8999-999999999999' });
    harness.state.submissions.push(elsewhere);
    expect(await harness.repos.submissions.findById(testOrganisation.id, elsewhere.id)).toBeNull();
  });

  it('collects an event across every form that feeds it', async () => {
    // The point of the change: two forms, one event, one query.
    harness.state.submissions.push(
      row({ formId: 'f1', eventId: 'e1' }),
      row({ formId: 'f2', eventId: 'e1' }),
      row({ formId: 'f3', eventId: 'e2' }),
      row({ formId: 'f4', eventId: null }),
    );
    const forEvent = await harness.repos.submissions.listForEvent(testOrganisation.id, 'e1');
    expect(forEvent).toHaveLength(2);
    expect(new Set(forEvent.map((entry) => entry.formId))).toEqual(new Set(['f1', 'f2']));
  });

  it('does not collect an event belonging to another organisation', async () => {
    harness.state.submissions.push(
      row({ organisationId: '99999999-9999-4999-8999-999999999999', eventId: 'e1' }),
    );
    expect(await harness.repos.submissions.listForEvent(testOrganisation.id, 'e1')).toEqual([]);
  });
});

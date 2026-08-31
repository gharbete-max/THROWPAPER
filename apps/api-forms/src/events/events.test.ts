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
import type { EventRecord } from '../db/repositories/index.js';

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

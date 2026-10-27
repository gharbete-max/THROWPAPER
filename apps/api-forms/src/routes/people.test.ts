import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';

let harness: TestHarness;
let headers: ReturnType<typeof bearer>;

beforeEach(async () => {
  harness = await createTestHarness();
  headers = bearer((await signIn(harness, adminUser.email)).accessToken);
});
afterEach(async () => {
  await harness.close();
});

describe('people', () => {
  it('creates, registers for an event, edits and deletes a person', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/people',
      headers,
      payload: { name: 'Ada Lovelace', email: 'ADA@example.com', eventIds: [eventId] },
    });
    expect(created.statusCode).toBe(201);
    const person = created.json();
    expect(person).toMatchObject({ email: 'ada@example.com', phone: null, eventIds: [eventId] });

    const edited = await harness.app.inject({
      method: 'PUT',
      url: `/v1/people/${person.id}`,
      headers,
      payload: { name: 'Ada King', eventIds: [] },
    });
    expect(edited.json()).toMatchObject({ name: 'Ada King', eventIds: [] });

    const list = await harness.app.inject({ method: 'GET', url: '/v1/people', headers });
    expect(list.json().people).toHaveLength(1);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/people/${person.id}`,
      headers,
    });
    expect(removed.statusCode).toBe(204);
    const gone = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/people/${person.id}`,
      headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('refuses an anonymous request', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/people' });
    expect(response.statusCode).toBe(401);
  });
});

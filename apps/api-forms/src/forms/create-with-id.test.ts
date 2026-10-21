import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminUser, bearer, createTestHarness, signIn, type TestHarness } from '../test-support.js';

/**
 * The guided builder opens at `/forms/<id>/guided` before the form exists and makes it on the first
 * answer, so the caller chooses the id (an abandoned start then leaves nothing behind).
 */
let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await createTestHarness();
  token = (await signIn(harness, adminUser.email)).accessToken;
});
afterEach(async () => {
  await harness.close();
});

const create = (payload: Record<string, unknown>) =>
  harness.app.inject({ method: 'POST', url: '/v1/forms', headers: bearer(token), payload });

describe('creating a form under an id the caller chose', () => {
  it('gives the form that id, and refuses a second form with it', async () => {
    const id = '5b0d3a6e-8f3b-4c43-9a55-0c9a1e5e7f10';
    const first = await create({ id, slug: 'form-aaa', title: { 'sv-SE': 'Namnlöst' } });
    expect(first.statusCode).toBe(201);
    expect(first.json().id).toBe(id);
    const read = await harness.app.inject({
      method: 'GET',
      url: `/v1/forms/${id}`,
      headers: bearer(token),
    });
    expect(read.statusCode).toBe(200);

    const again = await create({ id, slug: 'form-bbb', title: { 'sv-SE': 'Andra' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('id-taken');
  });

  it('still chooses one itself when none is given', async () => {
    const made = await create({ slug: 'form-ccc', title: { 'sv-SE': 'Utan id' } });
    expect(made.statusCode).toBe(201);
    expect(made.json().id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

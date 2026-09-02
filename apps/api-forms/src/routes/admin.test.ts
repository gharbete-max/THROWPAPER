import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

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

function createFormAs(token: string, slug: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(token),
    payload: { slug, title: { 'sv-SE': 'Enkät' } },
  });
}

/** The harness seeds these two with fixed ids, so the support view has a real person to visit. */
const operatorId = (): string => operatorUser.id;

describe('the user list', () => {
  it('names everybody in the organisation with their form counts', async () => {
    await createFormAs(operatorToken, 'oskars-enkat');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(200);

    const oskar = response
      .json()
      .users.find((user: { email: string }) => user.email === operatorUser.email);
    expect(oskar.formCount).toBe(1);
    expect(oskar.trashCount).toBe(0);
    expect(oskar.role).toBe('operator');
  });

  it('counts a binned form in the bin column and not the other one', async () => {
    const { id } = (await createFormAs(operatorToken, 'oskars-enkat')).json();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/trash`,
      headers: bearer(operatorToken),
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: bearer(adminToken),
    });
    const oskar = response
      .json()
      .users.find((user: { email: string }) => user.email === operatorUser.email);
    expect(oskar.formCount).toBe(0);
    expect(oskar.trashCount).toBe(1);
  });

  it('is not for operators', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: bearer(operatorToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('looking at somebody else’s workspace', () => {
  it('shows their forms', async () => {
    const { id } = (await createFormAs(operatorToken, 'oskars-enkat')).json();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms`,
      headers: bearer(adminToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().forms.map((form: { id: string }) => form.id)).toEqual([id]);
  });

  it('shows their bin as a separate pile', async () => {
    const { id } = (await createFormAs(operatorToken, 'oskars-enkat')).json();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/forms/${id}/trash`,
      headers: bearer(operatorToken),
    });

    const active = await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms`,
      headers: bearer(adminToken),
    });
    expect(active.json().forms).toEqual([]);

    const bin = await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms?scope=trash`,
      headers: bearer(adminToken),
    });
    expect(bin.json().forms.map((form: { id: string }) => form.id)).toEqual([id]);
  });

  /**
   * The support view is looking, not becoming.
   *
   * Every form comes back marked with the *administrator's* access, because those are the
   * administrator's buttons — and every action they take is logged as theirs. Reporting the other
   * person's access here would draw a page that lies about who is holding it.
   */
  it("reports the administrator's own access, not the user's", async () => {
    await createFormAs(operatorToken, 'oskars-enkat');

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms`,
      headers: bearer(adminToken),
    });
    expect(response.json().forms[0].access).toBe('admin');
    expect(response.json().forms[0].ownerName).toBe(operatorUser.name);
  });

  /** And the looking itself is recorded — support work is still somebody reading your things. */
  it('writes an audit entry for the visit', async () => {
    await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms`,
      headers: bearer(adminToken),
    });
    expect(harness.state.audit.some((entry) => entry.action === 'admin.viewed_user_forms')).toBe(
      true,
    );
  });

  it('is not for operators', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${operatorId()}/forms`,
      headers: bearer(operatorToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

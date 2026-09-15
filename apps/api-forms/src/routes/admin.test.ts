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

describe('adding somebody to the organisation', () => {
  function add(payload: Record<string, unknown>, token = adminToken) {
    return harness.app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: bearer(token),
      payload,
    });
  }

  it('creates a colleague who can then be signed in as', async () => {
    const response = await add({ email: 'kim@example.com', name: 'Kim Karlsson' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      email: 'kim@example.com',
      name: 'Kim Karlsson',
      // The lesser privilege is the default; the greater one has to be asked for.
      role: 'operator',
      disabled: false,
    });

    // The account is real from here: no acceptance step, and a magic link reaches it.
    const session = await signIn(harness, 'kim@example.com');
    expect(session.accessToken).toBeTruthy();
  });

  it('creates an administrator when asked to', async () => {
    const response = await add({ email: 'ada@example.com', name: 'Ada', role: 'admin' });
    expect(response.json().role).toBe('admin');
  });

  /**
   * `Kim@Example.com` and `kim@example.com` must be one account. Stored as typed, they would be
   * two — one of which can never receive a magic link, because sign-in lower-cases the address.
   */
  it('folds the address to lower case, so sign-in finds it', async () => {
    const response = await add({ email: 'Kim@Example.COM', name: 'Kim' });

    expect(response.json().email).toBe('kim@example.com');
    await expect(signIn(harness, 'kim@example.com')).resolves.toBeTruthy();
  });

  it('reports a duplicate as already here rather than failing', async () => {
    const response = await add({ email: adminUser.email, name: 'Another Alva' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('email-taken');
  });

  it('refuses an address that is not one', async () => {
    expect((await add({ email: 'not-an-address', name: 'Kim' })).statusCode).toBe(400);
  });

  it('refuses a blank name', async () => {
    expect((await add({ email: 'kim@example.com', name: '   ' })).statusCode).toBe(400);
  });

  it('is not for operators', async () => {
    const response = await add({ email: 'kim@example.com', name: 'Kim' }, operatorToken);
    expect(response.statusCode).toBe(403);
  });

  it('writes an audit entry naming the administrator who did it', async () => {
    await add({ email: 'kim@example.com', name: 'Kim' });

    const entry = harness.state.audit.find((row) => row.action === 'user.create');
    expect(entry).toBeDefined();
    expect(entry?.actorUserId).toBe(adminUser.id);
  });
});

describe('changing somebody', () => {
  function patch(id: string, payload: Record<string, unknown>, token = adminToken) {
    return harness.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${id}`,
      headers: bearer(token),
      payload,
    });
  }

  it('promotes an operator', async () => {
    const response = await patch(operatorId(), { role: 'admin' });

    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('admin');
  });

  it('disables somebody, and the disabled cannot sign in', async () => {
    const response = await patch(operatorId(), { disabled: true });

    expect(response.json().disabled).toBe(true);
    // `requestMagicLink` refuses a disabled user, and says nothing about why — see auth/service.
    const before = harness.mail.sent.length;
    await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: operatorUser.email },
    });
    expect(harness.mail.sent.length).toBe(before);
  });

  it('re-enables somebody, clearing the date rather than keeping it', async () => {
    await patch(operatorId(), { disabled: true });
    const response = await patch(operatorId(), { disabled: false });

    expect(response.json().disabled).toBe(false);
    const person = await harness.repos.users.findById(operatorId());
    expect(person?.disabledAt).toBeNull();
  });

  /**
   * The invariant an organisation cannot be talked out of. Disabling or demoting the final
   * administrator locks everybody out of their own account, recoverable only by somebody with
   * database access — so it is refused at the write, not discouraged in the interface.
   */
  describe('the last administrator', () => {
    it('cannot be demoted', async () => {
      const response = await patch(adminUser.id, { role: 'operator' });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('last-admin');
      // And nothing changed.
      expect((await harness.repos.users.findById(adminUser.id))?.role).toBe('admin');
    });

    it('cannot be disabled', async () => {
      const response = await patch(adminUser.id, { disabled: true });

      expect(response.statusCode).toBe(409);
      expect((await harness.repos.users.findById(adminUser.id))?.disabledAt).toBeNull();
    });

    it('can be demoted once somebody else is promoted', async () => {
      await patch(operatorId(), { role: 'admin' });

      expect((await patch(adminUser.id, { role: 'operator' })).statusCode).toBe(200);
    });

    /**
     * A disabled administrator does not count as one. Two admins where one is already disabled is
     * one administrator, and demoting the other still empties the organisation.
     */
    it('does not count a disabled administrator as cover', async () => {
      await patch(operatorId(), { role: 'admin' });
      await patch(operatorId(), { disabled: true });

      expect((await patch(adminUser.id, { role: 'operator' })).statusCode).toBe(409);
    });
  });

  it('refuses a body that asks for nothing', async () => {
    expect((await patch(operatorId(), {})).statusCode).toBe(400);
  });

  it('answers 404 for somebody who does not exist', async () => {
    const response = await patch('44444444-4444-4444-8444-444444444444', { role: 'admin' });
    expect(response.statusCode).toBe(404);
  });

  it('is not for operators', async () => {
    expect((await patch(operatorId(), { role: 'admin' }, operatorToken)).statusCode).toBe(403);
  });

  it('writes an audit entry with what changed', async () => {
    await patch(operatorId(), { role: 'admin' });

    const entry = harness.state.audit.find((row) => row.action === 'user.update');
    expect(entry?.before).toMatchObject({ role: 'operator' });
    expect(entry?.after).toMatchObject({ role: 'admin' });
  });
});

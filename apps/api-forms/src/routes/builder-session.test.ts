import { beforeEach, describe, expect, it } from 'vitest';
import { forms as formSchemas } from '@tp/shared';
import {
  BUILDER_GRAPH,
  answer,
  begin,
  fromSession,
  toSession,
  type BuilderSession,
} from '@tp/shared/builder';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  type TestHarness,
} from '../test-support.js';

/**
 * `GET/PUT /v1/forms/:id/builder-session` — `CAVEATS.md` #45 (`never-lose-work`), the API half:
 * a conversation saved after an answer comes back after a refresh at the same question with the
 * same trail, one per form and person, and a second tab cannot silently overwrite the first.
 * The Drizzle implementation is held to the same on PGlite (`db/pglite.test.ts`) and on Postgres
 * (`db/database.test.ts`).
 */

let harness: TestHarness;
let adminToken: string;
let operatorToken: string;

beforeEach(async () => {
  harness = await createTestHarness();
  adminToken = (await signIn(harness, adminUser.email)).accessToken;
  operatorToken = (await signIn(harness, operatorUser.email)).accessToken;
});

async function createForm(token = adminToken) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/forms',
    headers: bearer(token),
    payload: { slug: 'mat', title: { 'sv-SE': 'Mat' } },
  });
  return response.json().id as string;
}

/** A real conversation, two answers in. */
function conversation(): BuilderSession {
  let c = begin(BUILDER_GRAPH, {
    definition: formSchemas.emptyDefinition,
    title: { 'sv-SE': 'Mat' },
  });
  c = answer(BUILDER_GRAPH, c, { kind: 'option', optionId: 'signup' }, { locale: 'sv-SE' });
  c = answer(BUILDER_GRAPH, c, { kind: 'option', optionId: 'later' }, { locale: 'sv-SE' });
  return toSession(BUILDER_GRAPH, c);
}

const read = (id: string, token = adminToken) =>
  harness.app.inject({
    method: 'GET',
    url: `/v1/forms/${id}/builder-session`,
    headers: bearer(token),
  });

const save = (id: string, version: number, session: unknown, token = adminToken) =>
  harness.app.inject({
    method: 'PUT',
    url: `/v1/forms/${id}/builder-session`,
    headers: bearer(token),
    payload: { version, session },
  });

describe('the builder session', () => {
  it('starts as nothing: version 0, no session', async () => {
    const id = await createForm();
    const response = await read(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 0, session: null });
  });

  it('comes back after a refresh at the same question, with the same trail', async () => {
    const id = await createForm();
    const session = conversation();
    const saved = await save(id, 0, session);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ version: 1 });

    const back = (await read(id)).json();
    expect(back.version).toBe(1);
    const resumed = fromSession(back.session);
    expect(resumed.state.cursor).toBe('text.label');
    expect(resumed.log.map((entry) => entry.nodeId)).toEqual(['flow.start', 'brand.start']);
    expect(back.session).toEqual(session);
  });

  it('refuses a save over a version it did not read — a second tab reads again instead', async () => {
    const id = await createForm();
    expect((await save(id, 0, conversation())).json()).toEqual({ version: 1 });
    expect((await save(id, 1, conversation())).json()).toEqual({ version: 2 });

    for (const stale of [0, 1, 3]) {
      const conflict = await save(id, stale, conversation());
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.code).toBe('session-conflict');
    }
    expect((await read(id)).json().version).toBe(2);
  });

  it('keeps one conversation per person: two people on one form do not share one', async () => {
    const id = await createForm();
    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/shares`,
      headers: bearer(adminToken),
      payload: { email: operatorUser.email, role: 'editor' },
    });
    await save(id, 0, conversation());
    expect((await read(id, operatorToken)).json()).toEqual({ version: 0, session: null });
    expect((await save(id, 0, conversation(), operatorToken)).statusCode).toBe(200);
    expect(harness.state.builderSessions).toHaveLength(2);
  });

  it('is only for someone who may change the form', async () => {
    const id = await createForm();
    // Not shared at all: the form does not exist, as far as they can tell.
    expect((await read(id, operatorToken)).statusCode).toBe(404);
    expect((await save(id, 0, conversation(), operatorToken)).statusCode).toBe(404);

    await harness.app.inject({
      method: 'PUT',
      url: `/v1/forms/${id}/shares`,
      headers: bearer(adminToken),
      payload: { email: operatorUser.email, role: 'viewer' },
    });
    expect((await read(id, operatorToken)).statusCode).toBe(403);
    expect((await save(id, 0, conversation(), operatorToken)).statusCode).toBe(403);
    expect(
      (await harness.app.inject({ method: 'GET', url: `/v1/forms/${id}/builder-session` }))
        .statusCode,
    ).toBe(401);
  });

  it.each<[string, (s: Record<string, unknown>) => unknown]>([
    ['not a session at all', () => ({ hello: 'world' })],
    ['a version this build does not read', (s) => ({ ...s, sessionVersion: 99 })],
    [
      'a draft the form schema refuses',
      (s) => ({
        ...s,
        base: { ...(s['base'] as object), draft: { definition: { schemaVersion: 2 }, title: {} } },
      }),
    ],
  ])('refuses %s, before anything is stored', async (_name, spoil) => {
    const id = await createForm();
    const response = await save(id, 0, spoil(conversation() as unknown as Record<string, unknown>));
    expect(response.statusCode).toBe(400);
    expect(harness.state.builderSessions).toHaveLength(0);
  });
});

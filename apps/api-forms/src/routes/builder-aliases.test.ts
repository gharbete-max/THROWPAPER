import { beforeEach, describe, expect, it } from 'vitest';
import { AliasFile, type AliasEntry } from '@tp/shared/interpret';
import {
  adminUser,
  bearer,
  createTestHarness,
  operatorUser,
  signIn,
  testOrganisation,
  type TestHarness,
} from '../test-support.js';

/**
 * `/v1/builder/aliases` — `INTENT-LADDER.md`, "Aliases" (S6): a phrase is remembered only when a
 * person presses "Remember", never overrides a built-in or an earlier learned alias, and an
 * administrator can list, delete, export and import them — an import showing what it would do
 * before it does it (rule 7). The Drizzle implementation is held to the same on PGlite
 * (`db/pglite.test.ts`) and on Postgres (`db/database.test.ts`).
 */

let harness: TestHarness;
let admin: string;
let operator: string;

beforeEach(async () => {
  harness = await createTestHarness();
  admin = (await signIn(harness, adminUser.email)).accessToken;
  operator = (await signIn(harness, operatorUser.email)).accessToken;
});

const remember = (
  phrase: string,
  optionId = 'pill',
  token = operator,
  over: Record<string, string> = {},
) =>
  harness.app.inject({
    method: 'POST',
    url: '/v1/builder/aliases',
    headers: bearer(token),
    payload: { phrase, nodeId: 'choice.shape', optionId, locale: 'en', ...over },
  });

const list = (token = operator) =>
  harness.app.inject({ method: 'GET', url: '/v1/builder/aliases', headers: bearer(token) });

const entry = (phrase: string, optionId: string): AliasEntry => ({
  phrase,
  nodeId: 'choice.shape',
  optionId,
  locale: 'en',
  source: 'user-confirmed',
  createdAt: '2026-01-02',
  count: 3,
  notes: '',
});

const importing = (file: unknown, confirm: boolean, token = admin) =>
  harness.app.inject({
    method: 'POST',
    url: '/v1/builder/aliases/import',
    headers: bearer(token),
    payload: { file, confirm },
  });

describe('remembering a phrase', () => {
  it('stores it exactly as typed, for anyone who builds forms to read', async () => {
    const response = await remember('Blobby!');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      created: true,
      alias: { phrase: 'Blobby!', optionId: 'pill', source: 'user-confirmed', count: 1 },
    });
    const listed = (await list()).json().aliases;
    expect(listed).toHaveLength(1);
    // A date and nothing more: no person, no time.
    expect(listed[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(listed[0]).sort()).toEqual(
      [
        'count',
        'createdAt',
        'id',
        'locale',
        'nodeId',
        'notes',
        'optionId',
        'phrase',
        'source',
      ].sort(),
    );
  });

  it('counts it again when it is remembered again, however it is written', async () => {
    await remember('blobby');
    const again = await remember('  BLOBBY ');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, alias: { phrase: 'blobby', count: 2 } });
    expect((await list()).json().aliases).toHaveLength(1);
  });

  it('refuses a phrase that already means another answer, and says which', async () => {
    const builtIn = await remember('pills', 'square');
    expect(builtIn.statusCode).toBe(409);
    expect(builtIn.json().error).toMatchObject({
      code: 'alias-refused',
      reason: 'collision',
      means: 'pill',
    });
    await remember('blobby', 'pill');
    const learned = await remember('blobby', 'square');
    expect(learned.json().error).toMatchObject({ reason: 'collision', means: 'pill' });
    expect((await remember('square', 'pill')).json().error.reason).toBe('shadows-id');
    expect((await remember('pills', 'pill')).json().error.reason).toBe('present');
  });

  it('refuses what is not a phrase, a question or an answer', async () => {
    expect((await remember('x'.repeat(81))).statusCode).toBe(400);
    expect((await remember('?!')).json().error.reason).toBe('empty');
    expect((await remember('blobby', 'star')).json().error.reason).toBe('unknown-option');
    expect(
      (await remember('blobby', 'pill', operator, { nodeId: 'no.such' })).json().error.reason,
    ).toBe('unknown-node');
    expect((await remember('blobby', 'pill', operator, { locale: 'pt' })).statusCode).toBe(400);
  });

  it('needs someone signed in', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/builder/aliases' });
    expect(response.statusCode).toBe(401);
  });
});

describe('an administrator', () => {
  it('deletes one, or all of them — and nobody else may', async () => {
    const id = (await remember('blobby')).json().alias.id as string;
    await remember('capsuley');
    const byOperator = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/builder/aliases/${id}`,
      headers: bearer(operator),
    });
    expect(byOperator.statusCode).toBe(403);
    const one = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/builder/aliases/${id}`,
      headers: bearer(admin),
    });
    expect(one.json()).toEqual({ removed: 1 });
    const gone = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/builder/aliases/${id}`,
      headers: bearer(admin),
    });
    expect(gone.statusCode).toBe(404);
    const all = await harness.app.inject({
      method: 'DELETE',
      url: '/v1/builder/aliases',
      headers: bearer(admin),
    });
    expect(all.json()).toEqual({ removed: 1 });
    expect((await list()).json().aliases).toEqual([]);
    const audited = (await harness.repos.audit.list(testOrganisation.id)).map((a) => a.action);
    expect(audited).toEqual(
      expect.arrayContaining(['builder-alias.delete', 'builder-alias.clear']),
    );
  });

  it('exports the alias file, in the shipped files’ own shape', async () => {
    await remember('blobby');
    await remember('shiny rectangle', 'square');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/builder/aliases/export',
      headers: bearer(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('aliases.json');
    const file = AliasFile.parse(JSON.parse(response.body));
    expect(file.entries.map((e) => [e.phrase, e.optionId])).toEqual([
      ['blobby', 'pill'],
      ['shiny rectangle', 'square'],
    ]);
    expect(response.body.endsWith('}\n')).toBe(true);
    const byOperator = await harness.app.inject({
      method: 'GET',
      url: '/v1/builder/aliases/export',
      headers: bearer(operator),
    });
    expect(byOperator.statusCode).toBe(403);
  });

  it('sees what an import would do, and nothing is stored until it is confirmed', async () => {
    await remember('blobby', 'pill');
    const file = {
      aliasesVersion: 1,
      entries: [entry('blobby', 'pill'), entry('blobby', 'square'), entry('shiny', 'square')],
    };
    const preview = await importing(file, false);
    expect(preview.statusCode).toBe(200);
    const diff = preview.json();
    expect(diff.stored).toBe(false);
    expect(diff.added.map((e: AliasEntry) => [e.phrase, e.source, e.count])).toEqual([
      ['shiny', 'imported', 1],
    ]);
    expect(diff.present.map((e: AliasEntry) => e.phrase)).toEqual(['blobby']);
    expect(diff.refused).toEqual([
      { entry: entry('blobby', 'square'), reason: 'collision', means: 'pill' },
    ]);
    expect((await list()).json().aliases).toHaveLength(1);

    const confirmed = await importing(file, true);
    expect(confirmed.json().stored).toBe(true);
    expect((await list()).json().aliases.map((a: AliasEntry) => a.phrase)).toEqual([
      'blobby',
      'shiny',
    ]);
  });

  it('is told what is wrong with a file that is not an alias file, which stores nothing', async () => {
    const response = await importing({ aliasesVersion: 1, entries: [{ phrase: 'x' }] }, true);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('invalid-alias-file');
    expect((await importing({ aliases: [] }, true, operator)).statusCode).toBe(403);
    expect((await list()).json().aliases).toEqual([]);
  });
});

describe('another organisation', () => {
  it('never sees, counts or deletes these', async () => {
    const other = '99999999-9999-4999-8999-999999999999';
    const [added] = await harness.repos.builderAliases.add(other, [
      {
        phrase: 'blobby',
        key: 'blobby',
        nodeId: 'choice.shape',
        optionId: 'square',
        locale: 'en',
        source: 'user-confirmed',
        createdAt: '2026-01-02',
        count: 1,
        notes: '',
      },
    ]);
    // The same phrase, meaning something else there, is no collision here.
    expect((await remember('blobby', 'pill')).statusCode).toBe(201);
    expect((await list()).json().aliases.map((a: AliasEntry) => a.optionId)).toEqual(['pill']);
    const cross = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/builder/aliases/${added!.id}`,
      headers: bearer(admin),
    });
    expect(cross.statusCode).toBe(404);
  });
});

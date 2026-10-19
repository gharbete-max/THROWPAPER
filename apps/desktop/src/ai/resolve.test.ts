import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEXT_MODEL } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateFile, locateModel, type ResolveContext } from './resolve.js';

const weights = TEXT_MODEL.files[0]!;
const upstream = weights.name;
const kind = TEXT_MODEL.kind;

let root = '';
let context: ResolveContext;
const put = async (...segments: string[]) => {
  const path = join(root, ...segments);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'x');
  return path;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loppa-resolve-'));
  context = {
    env: {},
    repoRoot: join(root, 'repo'),
    packDir: join(root, 'resources', 'ai-pack'),
    userDataModels: join(root, 'userdata', 'models'),
    remembered: {},
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('where a model file is looked for', () => {
  it('finds nothing where nothing is', async () => {
    expect(await locateFile(weights, kind, context)).toBeNull();
  });

  it('LOPPA_AI_DIR beats everything, directly or under the kind folder', async () => {
    const own = await put('userdata', 'models', weights.name);
    await put('repo', 'local-models', kind, weights.name);
    await put('repo', upstream);
    const direct = await put('ai', weights.name);
    context.env = { LOPPA_AI_DIR: join(root, 'ai') };
    expect(await locateFile(weights, kind, context)).toEqual({ path: direct, source: 'env' });
    await rm(direct);
    const nested = await put('ai', kind, weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({ path: nested, source: 'env' });
    expect(own).toBeTruthy();
  });

  it('then <repo>/local-models/<kind>/, then the repository root, then the user-data folder', async () => {
    const own = await put('userdata', 'models', weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({ path: own, source: 'user-data' });

    const atRoot = await put('repo', upstream);
    const found = await locateFile(weights, kind, context);
    // Windows does not tell the two spellings apart.
    expect([found?.path.toLowerCase(), found?.source]).toEqual([atRoot.toLowerCase(), 'repo-root']);

    const local = await put('repo', 'local-models', kind, weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({
      path: local,
      source: 'local-models',
    });
  });

  it('local-models is per kind: a file in another kind folder is not found', async () => {
    await put('repo', 'local-models', 'other', weights.name);
    expect(await locateFile(weights, kind, context)).toBeNull();
    const there = await put('repo', 'local-models', kind, weights.name);
    expect((await locateFile(weights, kind, context))?.path).toBe(there);
  });

  it('the AI pack beside the app is read by a packaged app, after the checkout and before the user-data folder', async () => {
    context.repoRoot = null;
    const own = await put('userdata', 'models', weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({ path: own, source: 'user-data' });
    const pack = await put('resources', 'ai-pack', weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({ path: pack, source: 'ai-pack' });
    await rm(pack);
    const nested = await put('resources', 'ai-pack', kind, weights.name);
    expect(await locateFile(weights, kind, context)).toEqual({ path: nested, source: 'ai-pack' });
  });

  it('a packaged app without a pack reads only the user-data folder and what the person opened', async () => {
    await put('repo', upstream);
    await put('repo', 'local-models', kind, weights.name);
    context.repoRoot = null;
    context.packDir = null;
    expect(await locateFile(weights, kind, context)).toBeNull();

    const mine = await put('elsewhere', 'mine.gguf');
    context.remembered = { [weights.name]: mine };
    expect(await locateFile(weights, kind, context)).toEqual({
      path: mine,
      source: 'remembered',
    });
  });

  it('a location the person gave beats the user-data folder, and a vanished one is ignored', async () => {
    const own = await put('userdata', 'models', weights.name);
    const mine = await put('elsewhere', 'mine.gguf');
    context.remembered = { [weights.name]: mine };
    expect((await locateFile(weights, kind, context))?.source).toBe('remembered');
    await rm(mine);
    expect(await locateFile(weights, kind, context)).toEqual({ path: own, source: 'user-data' });
  });

  it('finds every file of a model separately', async () => {
    await put('repo', weights.name);
    const found = await locateModel(TEXT_MODEL, context);
    expect(found.map((f) => [f.file.role, f.found?.source ?? null])).toEqual([
      ['weights', 'repo-root'],
      ['projector', null],
      ['projector-lite', null],
    ]);
  });
});

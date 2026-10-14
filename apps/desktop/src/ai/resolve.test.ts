import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEXT_MODEL, findModel } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateFile, locateModel, type ResolveContext } from './resolve.js';

const weights = TEXT_MODEL.files[0]!;
const upstream = weights.aliases![0]!;

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
    userDataModels: join(root, 'userdata', 'models'),
    remembered: {},
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('where a model file is looked for', () => {
  it('finds nothing where nothing is', async () => {
    expect(await locateFile(weights, 'text', context)).toBeNull();
  });

  it('LOPPA_AI_DIR beats everything, directly or under the kind folder', async () => {
    const own = await put('userdata', 'models', weights.name);
    await put('repo', 'local-models', 'text', weights.name);
    await put('repo', upstream);
    const direct = await put('ai', weights.name);
    context.env = { LOPPA_AI_DIR: join(root, 'ai') };
    expect(await locateFile(weights, 'text', context)).toEqual({ path: direct, source: 'env' });
    await rm(direct);
    const nested = await put('ai', 'text', weights.name);
    expect(await locateFile(weights, 'text', context)).toEqual({ path: nested, source: 'env' });
    expect(own).toBeTruthy();
  });

  it('then <repo>/local-models/<kind>/, then the repository root, then the user-data folder', async () => {
    const own = await put('userdata', 'models', weights.name);
    expect(await locateFile(weights, 'text', context)).toEqual({ path: own, source: 'user-data' });

    const atRoot = await put('repo', upstream);
    const found = await locateFile(weights, 'text', context);
    // Windows does not tell the two spellings apart.
    expect([found?.path.toLowerCase(), found?.source]).toEqual([atRoot.toLowerCase(), 'repo-root']);

    const local = await put('repo', 'local-models', 'text', weights.name);
    expect(await locateFile(weights, 'text', context)).toEqual({
      path: local,
      source: 'local-models',
    });
  });

  it('local-models is per kind: a vision file is not found in the text folder', async () => {
    await put('repo', 'local-models', 'text', 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf');
    const vision = findModel('qwen2.5-vl-3b-instruct-q4_k_m')!;
    expect(await locateFile(vision.files[0]!, vision.kind, context)).toBeNull();
    const there = await put('repo', 'local-models', 'vision', 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf');
    expect((await locateFile(vision.files[0]!, vision.kind, context))?.path).toBe(there);
  });

  it('a packaged app reads only the user-data folder and what the person opened', async () => {
    await put('repo', upstream);
    await put('repo', 'local-models', 'text', weights.name);
    context.repoRoot = null;
    expect(await locateFile(weights, 'text', context)).toBeNull();

    const mine = await put('elsewhere', 'mine.gguf');
    context.remembered = { [weights.name]: mine };
    expect(await locateFile(weights, 'text', context)).toEqual({
      path: mine,
      source: 'remembered',
    });
  });

  it('a location the person gave beats the user-data folder, and a vanished one is ignored', async () => {
    const own = await put('userdata', 'models', weights.name);
    const mine = await put('elsewhere', 'mine.gguf');
    context.remembered = { [weights.name]: mine };
    expect((await locateFile(weights, 'text', context))?.source).toBe('remembered');
    await rm(mine);
    expect(await locateFile(weights, 'text', context)).toEqual({ path: own, source: 'user-data' });
  });

  it('finds every file of a model separately', async () => {
    const vision = findModel('qwen2.5-vl-3b-instruct-q4_k_m')!;
    await put('repo', 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf');
    const found = await locateModel(vision, context);
    expect(found.map((f) => [f.file.role, f.found?.source ?? null])).toEqual([
      ['weights', 'repo-root'],
      ['projector', null],
    ]);
  });
});

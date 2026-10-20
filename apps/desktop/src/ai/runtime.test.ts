import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeManifest, LLAMA_SERVER } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolveContext } from './resolve.js';
import {
  createRuntimeChecker,
  describeFolder,
  locateRuntime,
  verifyRuntimeFolder,
} from './runtime.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let root = '';
let context: ResolveContext;
let manifest: RuntimeManifest;

/** A tiny runtime for linux-x64, so the test does not depend on the 50 MB one. */
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loppa-runtime-'));
  await mkdir(join(root, 'pack'), { recursive: true });
  await writeFile(join(root, 'pack', 'llama-server'), 'program');
  await writeFile(join(root, 'pack', 'libggml.so'), 'library');
  const base = LLAMA_SERVER.assets[0]!;
  manifest = RuntimeManifest.parse({
    ...LLAMA_SERVER,
    assets: [
      {
        ...base,
        platform: 'linux-x64',
        entry: 'llama-server',
        verified: true,
        contents: [
          { bytes: 7, name: 'llama-server', sha256: sha('program') },
          { bytes: 7, name: 'libggml.so', sha256: sha('library') },
        ],
      },
    ],
  });
  context = {
    env: {},
    repoRoot: null,
    packDir: join(root, 'pack'),
    userDataModels: join(root, 'userdata', 'models'),
    remembered: {},
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('the runtime folder', () => {
  it('is found in the AI pack, where its program is', async () => {
    const found = await locateRuntime(context, manifest, 'linux', 'x64');
    expect(found).toMatchObject({ dir: join(root, 'pack'), source: 'ai-pack' });
    expect(await locateRuntime(context, manifest, 'darwin', 'arm64')).toBeNull(); // nothing pinned
    context.packDir = null;
    expect(await locateRuntime(context, manifest, 'linux', 'x64')).toBeNull();
  });

  it('is found in ai-pack/runtime too, which is where the packaged app has it', async () => {
    await rename(join(root, 'pack'), join(root, 'moved'));
    await mkdir(join(root, 'pack'), { recursive: true });
    await rename(join(root, 'moved'), join(root, 'pack', 'runtime'));
    const found = await locateRuntime(context, manifest, 'linux', 'x64');
    expect(found).toMatchObject({ dir: join(root, 'pack', 'runtime'), source: 'ai-pack' });
  });

  it('is checked file by file against the manifest', async () => {
    const asset = manifest.assets[0]!;
    expect(await verifyRuntimeFolder(join(root, 'pack'), asset)).toBe('ok');
    await writeFile(join(root, 'pack', 'libggml.so'), 'tamper!');
    expect(await verifyRuntimeFolder(join(root, 'pack'), asset)).toBe('damaged');
    await rm(join(root, 'pack', 'libggml.so'));
    expect(await verifyRuntimeFolder(join(root, 'pack'), asset)).toBe('damaged');
  });

  it('an asset nobody has run is only unpinned, never ok', async () => {
    const asset = { ...manifest.assets[0]!, verified: false, contents: [] };
    expect(await verifyRuntimeFolder(join(root, 'pack'), asset)).toBe('unpinned');
  });

  it('describes a folder the way the manifest lists it', async () => {
    expect(await describeFolder(join(root, 'pack'))).toEqual([
      { bytes: 7, name: 'libggml.so', sha256: sha('library') },
      { bytes: 7, name: 'llama-server', sha256: sha('program') },
    ]);
  });
});

describe('what the engine and the panel ask', () => {
  const checker = () =>
    createRuntimeChecker({ context: () => context, manifest, platform: 'linux', arch: 'x64' });

  it('gives the program when the folder is whole, and says verified', async () => {
    expect(await checker().entry()).toBe(join(root, 'pack', 'llama-server'));
    expect(await checker().status()).toMatchObject({
      role: 'runtime',
      name: 'llama.cpp llama-server b11741',
      path: join(root, 'pack'),
      source: 'ai-pack',
      hash: 'verified',
    });
  });

  it('refuses a changed file as damaged, and a missing program as cannot-start', async () => {
    await writeFile(join(root, 'pack', 'libggml.so'), 'tamper!');
    await expect(checker().entry()).rejects.toMatchObject({ problem: 'damaged' });
    expect((await checker().status()).hash).toBe('damaged');
    context.packDir = null;
    await expect(checker().entry()).rejects.toMatchObject({ problem: 'cannot-start' });
    expect(await checker().status()).toMatchObject({ path: null, hash: 'missing' });
  });
});

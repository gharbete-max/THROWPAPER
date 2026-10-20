import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelManifest, TEXT_MODEL, UNPUBLISHED } from '@tp/shared/ai';
import type { ModelEvent } from '@tp/shared/summary';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator, type CoordinatorDeps } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';
import { createModelAdapter, type ModelService } from './model-adapter.js';
import type { FakeBehaviour } from './text/fake-text-engine.js';

/**
 * The summary centre's `window.loppaModel` behaviour, as it was before the coordinator existed
 * (this file is `service.test.ts` moved, not rewritten): the same cases, answered by the adapter
 * over a coordinator, around the fake engine (the same pipeline, a fake language model).
 */
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The engines the coordinator made, counted: one per load of the model. */
function memoryEngines(behaviour: FakeBehaviour = {}) {
  const spawned: FakeEngine[] = [];
  const make = () => {
    const engine = new FakeEngine({ behaviour });
    spawned.push(engine);
    return engine;
  };
  return { make, spawned };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-adapter-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const small = (published = true) => {
  const bytes = randomBytes(30_000);
  const parts = [bytes.subarray(0, 10_000), bytes.subarray(10_000)];
  const manifest = ModelManifest.parse({
    ...TEXT_MODEL,
    files: [
      {
        bytes: bytes.length,
        name: 'small.gguf',
        parts: parts.map((part, i) => ({
          bytes: part.length,
          name: `a.part${i + 1}`,
          sha256: sha(part),
          url: published
            ? `https://huggingface.co/x/resolve/r/${i + 1}`
            : `${UNPUBLISHED}the release has not been cut yet`,
        })),
        role: 'weights',
        sha256: sha(bytes),
      },
    ],
  });
  return { bytes, manifest };
};

function setup(
  overrides: Partial<CoordinatorDeps> & { behaviour?: FakeBehaviour; published?: boolean } = {},
) {
  const { manifest, bytes } = small(overrides.published);
  const events: ModelEvent[] = [];
  const memory = memoryEngines(overrides.behaviour);
  const chosen = { path: null as string | null };
  const coordinator = createCoordinator({
    registry: [manifest],
    engines: { [manifest.id]: memory.make },
    dir: join(dir, 'models'),
    env: {},
    repoRoot: null,
    freeMemory: () => manifest.requiredMemoryBytes * 2,
    chooseFile: () => Promise.resolve(chosen.path),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    cache: new ResultCache(join(dir, 'cache.json')),
    ...overrides,
  });
  const service: ModelService = createModelAdapter(coordinator, {
    emit: (e) => events.push(e),
    modelId: manifest.id,
  });
  const until = async (match: (e: ModelEvent) => boolean) => {
    await vi.waitFor(() => expect(events.some(match)).toBe(true), { timeout: 5000 });
    return events.find(match)!;
  };
  return { service, coordinator, events, memory, chosen, manifest, bytes, until };
}

const JOB = {
  kind: 'summarise',
  text: 'The fee is 120 kronor.',
  into: 'en-GB',
  shape: 'document',
} as const;

describe('the model file', () => {
  it('is not there at first, and nothing downloads on its own', async () => {
    const { service, memory } = setup();
    const status = await service.status();
    expect(status).toMatchObject({ installed: false, verified: false, activity: 'idle' });
    expect(await service.start('a', JOB)).toEqual({ ok: false, problem: 'not-installed' });
    expect(memory.spawned).toHaveLength(0);
  });

  it('opened from disk is verified against the manifest and used where it is', async () => {
    const { service, chosen, bytes, until, events } = setup();
    chosen.path = join(dir, 'mine.gguf');
    await writeFile(chosen.path, bytes);
    expect(await service.openFromDisk()).toEqual({ ok: true, id: 'install' });
    await until((e) => e.kind === 'installed');
    expect(events.some((e) => e.kind === 'install' && e.phase === 'verify')).toBe(true);
    expect(await service.status()).toMatchObject({
      installed: true,
      verified: true,
      damaged: false,
      location: chosen.path,
    });
  });

  it('a file that is not the model is refused and not remembered', async () => {
    const { service, chosen, until } = setup();
    chosen.path = join(dir, 'other.gguf');
    await writeFile(chosen.path, randomBytes(30_000));
    await service.openFromDisk();
    expect(await until((e) => e.kind === 'install-failed')).toMatchObject({
      problem: 'not-a-model-file',
    });
    expect((await service.status()).installed).toBe(false);
  });

  it('closing the dialog changes nothing', async () => {
    const { service } = setup();
    expect(await service.openFromDisk()).toEqual({ ok: false, problem: 'cancelled' });
  });

  it('forgetting a file opened from disk does not delete the person file', async () => {
    const { service, chosen, bytes, until } = setup();
    chosen.path = join(dir, 'mine.gguf');
    await writeFile(chosen.path, bytes);
    await service.openFromDisk();
    await until((e) => e.kind === 'installed');
    expect((await service.remove()).installed).toBe(false);
    expect(await readdir(dir)).toContain('mine.gguf');
  });
});

describe('downloading', () => {
  it('is off, with a reason, while the release has no address', async () => {
    const { service, events } = setup({ published: false });
    expect((await service.status()).downloadBlocked).toBe('the release has not been cut yet');
    expect(await service.install()).toEqual({ ok: false, problem: 'download-unavailable' });
    expect(events).toEqual([]);
  });

  it('fetches the parts, joins and verifies them, and the file is then installed and deletable', async () => {
    // The bytes are drawn by `setup`; the server is told about them just after.
    const served: Record<string, Uint8Array> = {};
    const ctx = setup({
      fetch: (async (url: string) =>
        new Response(served[String(url)] ? new Blob([served[String(url)] as BlobPart]) : 'no', {
          status: served[String(url)] ? 200 : 404,
        })) as typeof fetch,
    });
    served['https://huggingface.co/x/resolve/r/1'] = ctx.bytes.subarray(0, 10_000);
    served['https://huggingface.co/x/resolve/r/2'] = ctx.bytes.subarray(10_000);
    expect(await ctx.service.install()).toEqual({ ok: true, id: 'install' });
    await ctx.until((e) => e.kind === 'installed');
    expect(await ctx.service.status()).toMatchObject({ installed: true, verified: true });
    expect(await readdir(join(dir, 'models'))).toEqual(['consents.jsonl', 'small.gguf']);
    expect((await ctx.service.remove()).installed).toBe(false);
    expect(await readdir(join(dir, 'models'))).toEqual(['consents.jsonl']);
  });
});

async function installed(ctx: ReturnType<typeof setup>) {
  ctx.chosen.path = join(dir, 'mine.gguf');
  await writeFile(ctx.chosen.path, ctx.bytes);
  await ctx.service.openFromDisk();
  await ctx.until((e) => e.kind === 'installed');
}

describe('a job', () => {
  it('goes through the engine and ends with done, then the engine is released when idle', async () => {
    const ctx = setup({ idleMs: 30 });
    await installed(ctx);
    expect(await ctx.service.start('job-1', JOB)).toEqual({ ok: true, id: 'job-1' });
    await ctx.until((e) => e.kind === 'done' && e.id === 'job-1');
    const kinds = ctx.events.filter((e) => e.id === 'job-1').map((e) => e.kind);
    expect(kinds.indexOf('step')).toBeLessThan(kinds.indexOf('text'));
    expect(kinds.at(-1)).toBe('done');
    expect(ctx.memory.spawned).toHaveLength(1);
    await vi.waitFor(() => expect(ctx.memory.spawned[0]!.disposed).toBe(true), { timeout: 2000 });
  });

  it('loads the model once for several jobs', async () => {
    const ctx = setup();
    await installed(ctx);
    for (const id of ['a', 'b']) {
      await ctx.service.start(id, JOB);
      await ctx.until((e) => e.kind === 'done' && e.id === id);
    }
    expect(ctx.memory.spawned).toHaveLength(1);
    expect(ctx.memory.spawned[0]!.loaded).toBe(true);
  });

  it('refuses a second job while one runs', async () => {
    const ctx = setup({ behaviour: { delayMs: 20 } });
    await installed(ctx);
    await ctx.service.start('one', JOB);
    expect(await ctx.service.start('two', JOB)).toEqual({ ok: false, problem: 'busy' });
    await ctx.until((e) => e.kind === 'done' && e.id === 'one');
  });

  it('can be cancelled in the middle', async () => {
    const ctx = setup({ behaviour: { delayMs: 30 } });
    await installed(ctx);
    await ctx.service.start('c', {
      ...JOB,
      text: Array.from({ length: 30 }, (_, i) => `Line number ${i}`).join('\n'),
    });
    await ctx.until((e) => e.id === 'c' && e.kind === 'text');
    await ctx.service.cancel('c');
    expect(
      await ctx.until((e) => e.id === 'c' && (e.kind === 'error' || e.kind === 'done')),
    ).toMatchObject({ kind: 'error', problem: 'cancelled' });
    await vi.waitFor(async () => expect((await ctx.service.status()).activity).toBe('idle'));
  });

  it('refuses to load a file that does not match, deleting nothing', async () => {
    const ctx = setup();
    await installed(ctx);
    // The person edits the file after it was accepted: a different size and mtime.
    const damagedBytes = Buffer.from(ctx.bytes);
    damagedBytes[10] = damagedBytes[10]! ^ 1;
    await writeFile(ctx.chosen.path!, damagedBytes);
    await ctx.service.start('d', JOB);
    expect(await ctx.until((e) => e.id === 'd' && e.kind === 'error')).toMatchObject({
      problem: 'damaged',
    });
    expect(ctx.memory.spawned).toHaveLength(0);
    expect(await readdir(dir)).toContain('mine.gguf');
    expect(await ctx.service.status()).toMatchObject({ damaged: true, verified: false });
  });

  it('does not even try to load with too little memory, and says so first', async () => {
    const ctx = setup({ freeMemory: () => 1_000_000_000 });
    await installed(ctx);
    expect(await ctx.service.start('m', JOB)).toEqual({ ok: false, problem: 'too-little-memory' });
    expect(ctx.memory.spawned).toHaveLength(0);
    expect((await ctx.service.status()).freeMemoryBytes).toBe(1_000_000_000);
  });

  it('reports an engine that cannot load the model', async () => {
    const ctx = setup();
    await installed(ctx);
    const events: ModelEvent[] = [];
    const failing = createModelAdapter(
      createCoordinator({
        registry: [ctx.manifest],
        engines: {
          [ctx.manifest.id]: () => new FakeEngine({ loadError: 'cannot-start' }),
        },
        dir: join(dir, 'models'),
        env: {},
        repoRoot: null,
        freeMemory: () => ctx.manifest.requiredMemoryBytes * 2,
        chooseFile: () => Promise.resolve(null),
        fetch,
        cache: new ResultCache(join(dir, 'cache2.json')),
        fake: true,
      }),
      { emit: (e) => events.push(e), modelId: ctx.manifest.id },
    );
    await failing.start('x', JOB);
    await vi.waitFor(() =>
      expect(events.some((e) => e.id === 'x' && e.kind === 'error')).toBe(true),
    );
    expect(events.find((e) => e.id === 'x' && e.kind === 'error')).toMatchObject({
      problem: 'cannot-start',
    });
    expect((await failing.status()).activity).toBe('idle');
  });
});

describe('what the adapter does not pass on', () => {
  it('a task another caller runs through the coordinator is not on the legacy channel', async () => {
    const ctx = setup();
    await installed(ctx);
    await ctx.coordinator.run('theirs', JOB);
    await vi.waitFor(() => expect(ctx.coordinator.state().running).toBeNull());
    await vi.waitFor(() => expect(ctx.coordinator.state().activity).toBe('idle'));
    expect(ctx.events.filter((e) => e.id === 'theirs')).toEqual([]);
  });

  it('queued events do not exist on the legacy channel', async () => {
    const ctx = setup({ behaviour: { delayMs: 10 } });
    await installed(ctx);
    await ctx.service.start('a', JOB);
    await ctx.until((e) => e.id === 'a' && e.kind === 'done');
    expect(ctx.events.every((e) => e.kind !== ('queued' as string))).toBe(true);
  });
});

describe('the fake mode CI runs', () => {
  it('needs no file, no hash and no memory, and still runs the whole path', async () => {
    const events: ModelEvent[] = [];
    const service = createModelAdapter(
      createCoordinator({
        registry: [TEXT_MODEL],
        engines: { [TEXT_MODEL.id]: () => new FakeEngine({ behaviour: { delayMs: 1 } }) },
        dir: join(dir, 'models'),
        env: {},
        repoRoot: null,
        freeMemory: () => 0,
        chooseFile: () => Promise.resolve(null),
        fetch,
        cache: new ResultCache(join(dir, 'cache3.json')),
        fake: true,
      }),
      { emit: (e) => events.push(e) },
    );
    expect(await service.status()).toMatchObject({
      installed: true,
      verified: true,
      location: null,
      downloadBlocked: null,
    });
    await service.start('f', JOB);
    await vi.waitFor(() =>
      expect(events.some((e) => e.kind === 'done' && e.id === 'f')).toBe(true),
    );
  });
});

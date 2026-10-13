import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_MANIFEST, UNPUBLISHED, WeightsManifest, type ModelEvent } from '@tp/shared/summary';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEngine, type FakeBehaviour } from './fake-engine.js';
import {
  REQUIRED_MEMORY_BYTES,
  createModelService,
  type ModelService,
  type ServiceDeps,
  type WorkerHandle,
} from './service.js';
import { createWorker, type FromWorker, type ToWorker } from './worker-core.js';

/** The shipped manifest with its release addresses unset, as before the release was cut. */
const unpublishedManifest = () =>
  WeightsManifest.parse({
    ...MODEL_MANIFEST,
    parts: MODEL_MANIFEST.parts.map((p) => ({
      ...p,
      url: `${UNPUBLISHED}the release has not been cut yet`,
    })),
  });

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The worker process, in memory, around a fake engine: the same message protocol as the real one. */
function memoryWorker(behaviour: FakeBehaviour = {}) {
  const spawned: Array<{ killed: boolean; messages: ToWorker[] }> = [];
  const spawn = (): WorkerHandle => {
    const listeners: Array<(m: FromWorker) => void> = [];
    const record = { killed: false, messages: [] as ToWorker[] };
    spawned.push(record);
    const handle = createWorker({ post: (m) => listeners.forEach((l) => l(m)) }, () =>
      Promise.resolve(new FakeEngine(behaviour)),
    );
    return {
      post: (m) => {
        record.messages.push(m);
        void handle(m);
      },
      onMessage: (l) => listeners.push(l),
      onExit: () => undefined,
      kill: () => {
        record.killed = true;
      },
    };
  };
  return { spawn, spawned };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-service-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const small = () => {
  const bytes = randomBytes(30_000);
  const manifest = WeightsManifest.parse({
    ...MODEL_MANIFEST,
    bytes: bytes.length,
    sha256: sha(bytes),
    parts: [
      {
        bytes: 10_000,
        name: 'a.part1',
        sha256: sha(bytes.subarray(0, 10_000)),
        url: 'https://example.test/1',
      },
      {
        bytes: 20_000,
        name: 'a.part2',
        sha256: sha(bytes.subarray(10_000)),
        url: 'https://example.test/2',
      },
    ],
  });
  return { bytes, manifest };
};

function setup(overrides: Partial<ServiceDeps> & { behaviour?: FakeBehaviour } = {}) {
  const { manifest, bytes } = small();
  const events: ModelEvent[] = [];
  const memory = memoryWorker(overrides.behaviour);
  const chosen = { path: null as string | null };
  const service: ModelService = createModelService({
    manifest,
    dir: join(dir, 'models'),
    spawn: memory.spawn,
    freeMemory: () => REQUIRED_MEMORY_BYTES * 2,
    chooseFile: () => Promise.resolve(chosen.path),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    emit: (e) => events.push(e),
    ...overrides,
  });
  /** Waits for an event of this kind. */
  const until = async (match: (e: ModelEvent) => boolean) => {
    await vi.waitFor(() => expect(events.some(match)).toBe(true), { timeout: 5000 });
    return events.find(match)!;
  };
  return { service, events, memory, chosen, manifest, bytes, until };
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
    const events: ModelEvent[] = [];
    const service = createModelService({
      dir: join(dir, 'models'),
      spawn: memoryWorker().spawn,
      freeMemory: () => REQUIRED_MEMORY_BYTES * 2,
      chooseFile: () => Promise.resolve(null),
      fetch: (() => Promise.reject(new Error('must not be called'))) as typeof fetch,
      emit: (e) => events.push(e),
      manifest: unpublishedManifest(),
    });
    expect((await service.status()).downloadBlocked).toBe('the release has not been cut yet');
    expect(await service.install()).toEqual({ ok: false, problem: 'download-unavailable' });
    expect(events).toEqual([]);
  });

  it('fetches the parts, joins and verifies them, and the file is then installed and deletable', async () => {
    const { manifest, bytes } = small();
    const files: Record<string, Uint8Array> = {
      'https://example.test/1': bytes.subarray(0, 10_000),
      'https://example.test/2': bytes.subarray(10_000),
    };
    const { service, until } = setup({
      manifest,
      fetch: (async (url: string) =>
        new Response(files[String(url)] ? new Blob([files[String(url)] as BlobPart]) : 'no', {
          status: files[String(url)] ? 200 : 404,
        })) as typeof fetch,
    });
    expect(await service.install()).toEqual({ ok: true, id: 'install' });
    await until((e) => e.kind === 'installed');
    expect(await service.status()).toMatchObject({ installed: true, verified: true });
    expect(await readdir(join(dir, 'models'))).toEqual([`${manifest.id}.gguf`]);
    expect((await service.remove()).installed).toBe(false);
    expect(await readdir(join(dir, 'models'))).toEqual([]);
  });
});

async function installed(ctx: ReturnType<typeof setup>) {
  ctx.chosen.path = join(dir, 'mine.gguf');
  await writeFile(ctx.chosen.path, ctx.bytes);
  await ctx.service.openFromDisk();
  await ctx.until((e) => e.kind === 'installed');
}

describe('a job', () => {
  it('goes through the worker and ends with done, then the worker is released when idle', async () => {
    const ctx = setup({ idleMs: 30 });
    await installed(ctx);
    expect(await ctx.service.start('job-1', JOB)).toEqual({ ok: true, id: 'job-1' });
    await ctx.until((e) => e.kind === 'done' && e.id === 'job-1');
    const kinds = ctx.events.filter((e) => e.id === 'job-1').map((e) => e.kind);
    expect(kinds.indexOf('step')).toBeLessThan(kinds.indexOf('text'));
    expect(kinds.at(-1)).toBe('done');
    expect(ctx.memory.spawned).toHaveLength(1);
    await vi.waitFor(() => expect(ctx.memory.spawned[0]!.killed).toBe(true), { timeout: 2000 });
    expect(ctx.memory.spawned[0]!.messages.map((m) => m.type)).toContain('dispose');
  });

  it('loads the model once for several jobs', async () => {
    const ctx = setup();
    await installed(ctx);
    for (const id of ['a', 'b']) {
      await ctx.service.start(id, JOB);
      await ctx.until((e) => e.kind === 'done' && e.id === id);
    }
    expect(ctx.memory.spawned).toHaveLength(1);
    expect(ctx.memory.spawned[0]!.messages.filter((m) => m.type === 'load')).toHaveLength(1);
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
    expect((await ctx.service.status()).activity).toBe('idle');
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

  it('reports a worker that cannot load the model', async () => {
    const ctx = setup();
    await installed(ctx);
    const spawn = (): WorkerHandle => {
      const listeners: Array<(m: FromWorker) => void> = [];
      return {
        post: (m) => {
          if (m.type === 'load')
            listeners.forEach((l) =>
              l({ type: 'load-failed', problem: 'cannot-start', detail: 'no binary' }),
            );
        },
        onMessage: (l) => listeners.push(l),
        onExit: () => undefined,
        kill: () => undefined,
      };
    };
    const failing = createModelService({
      manifest: ctx.manifest,
      dir: join(dir, 'models'),
      spawn,
      freeMemory: () => REQUIRED_MEMORY_BYTES * 2,
      chooseFile: () => Promise.resolve(null),
      fetch: fetch,
      emit: (e) => ctx.events.push(e),
      fake: true,
    });
    await failing.start('x', JOB);
    expect(await ctx.until((e) => e.id === 'x' && e.kind === 'error')).toMatchObject({
      problem: 'cannot-start',
    });
    expect((await failing.status()).activity).toBe('idle');
  });
});

describe('the fake mode CI runs', () => {
  it('needs no file, no hash and no memory, and still runs the whole path', async () => {
    const ctx = setup({ fake: true, freeMemory: () => 0 });
    expect(await ctx.service.status()).toMatchObject({ installed: true, verified: true });
    await ctx.service.start('f', JOB);
    await ctx.until((e) => e.kind === 'done' && e.id === 'f');
  });
});

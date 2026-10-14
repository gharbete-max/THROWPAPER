import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelManifest, type AiEvent, type AiTask } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import {
  IDLE_MS,
  PRIORITY,
  createCoordinator,
  type Coordinator,
  type CoordinatorDeps,
  type Transition,
} from './coordinator.js';
import { AiError, type Engine, type EngineEvent, type RunResult } from './engine.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A model of real, tiny files, so the coordinator hashes something. */
function tiny(id: string, capability: 'text' | 'vision', sizes: number[]) {
  const contents = sizes.map((n) => randomBytes(n));
  const manifest = ModelManifest.parse({
    capabilities: [capability],
    distributable: true,
    evaluationOnly: false,
    files: contents.map((bytes, index) => {
      const name = `${id}-${index}.gguf`;
      return {
        bytes: bytes.length,
        name,
        parts: [
          { bytes: bytes.length, name, sha256: sha(bytes), url: `https://example.test/${name}` },
        ],
        role: index === 0 ? 'weights' : 'projector',
        sha256: sha(bytes),
      };
    }),
    id,
    kind: capability,
    licence: 'Apache-2.0',
    licenceUrl: 'https://example.test/licence',
    name: id,
    requiredMemoryBytes: 1000,
    retrievedAt: '2026-10-14',
    source: 'https://example.test/source',
    sourceRevision: 'x',
  });
  return { manifest, contents };
}

const TEXT_TASK: AiTask = { kind: 'translate', text: 'Hi', into: 'sv-SE' };
const PAGE_TASK: AiTask = {
  kind: 'read-page',
  fileSha256: 'a'.repeat(64),
  page: 1,
  png: new Uint8Array(1),
  language: null,
};

/**
 * An engine the test steers: a task runs until the test finishes it (or aborts it), and the
 * number of engines alive at once is counted across all of them.
 */
class TestEngine implements Engine {
  alive = false;
  tasks: AiTask[] = [];
  aborted: boolean[] = [];
  private finish: ((result: RunResult | AiError) => void) | null = null;

  constructor(
    readonly name: string,
    private readonly counter: { alive: number; maxAlive: number },
    private readonly options: { loadError?: AiError; autoFinish?: boolean } = {},
  ) {}

  load(): Promise<void> {
    if (this.options.loadError) return Promise.reject(this.options.loadError);
    this.alive = true;
    this.counter.alive += 1;
    this.counter.maxAlive = Math.max(this.counter.maxAlive, this.counter.alive);
    return Promise.resolve();
  }

  run(task: AiTask, onEvent: (e: EngineEvent) => void, signal: AbortSignal): Promise<RunResult> {
    this.tasks.push(task);
    onEvent({ kind: 'text', mode: 'replace', text: `from ${this.name}` });
    if (this.options.autoFinish) return Promise.resolve({ warnings: [] });
    return new Promise<RunResult>((resolve, reject) => {
      this.finish = (result) => (result instanceof AiError ? reject(result) : resolve(result));
      signal.addEventListener('abort', () => {
        this.aborted.push(true);
        reject(new AiError('cancelled'));
      });
    });
  }

  /** Lets the running task end well. */
  complete(): void {
    this.finish?.({ warnings: [] });
  }

  /** Makes the running task fail the way a dead runtime does. */
  crash(): void {
    this.finish?.(new AiError('cannot-start'));
  }

  dispose(): Promise<void> {
    if (this.alive) this.counter.alive -= 1;
    this.alive = false;
    return Promise.resolve();
  }
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-coordinator-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function setup(
  overrides: Partial<CoordinatorDeps> & {
    engineOptions?: { loadError?: AiError; autoFinish?: boolean };
    withVision?: boolean;
    writeFiles?: boolean;
  } = {},
) {
  const text = tiny('text-a', 'text', [3000]);
  const vision = tiny('vision-b', 'vision', [2000, 500]);
  const engines: TestEngine[] = [];
  const counter = { alive: 0, maxAlive: 0 };
  const events: AiEvent[] = [];
  const transitions: Transition[] = [];
  const factory = (name: string) => () => {
    const engine = new TestEngine(name, counter, overrides.engineOptions);
    engines.push(engine);
    return engine;
  };
  const coordinator: Coordinator = createCoordinator({
    registry: [text.manifest, vision.manifest],
    engines: {
      [text.manifest.id]: factory('text'),
      ...(overrides.withVision === false ? {} : { [vision.manifest.id]: factory('vision') }),
    },
    dir: join(dir, 'models'),
    env: {},
    repoRoot: null,
    freeMemory: () => 1e12,
    chooseFile: () => Promise.resolve(null),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    cache: new ResultCache(join(dir, 'cache.json')),
    ...overrides,
  });
  coordinator.onEvent((e) => events.push(e));
  coordinator.onTransition((t) => transitions.push(t));
  const until = async (match: (e: AiEvent) => boolean) => {
    await vi.waitFor(() => expect(events.some(match)).toBe(true), { timeout: 5000 });
    return events.find(match)!;
  };
  const settled = (id: string) =>
    until((e) => e.id === id && (e.kind === 'done' || e.kind === 'error'));
  const install = async (which: { contents: Buffer[]; manifest: ModelManifest }) => {
    await Promise.all(
      which.manifest.files.map((file, i) =>
        writeFile(join(dir, 'models', file.name), which.contents[i]!).catch(async () => {
          const { mkdir } = await import('node:fs/promises');
          await mkdir(join(dir, 'models'), { recursive: true });
          await writeFile(join(dir, 'models', file.name), which.contents[i]!);
        }),
      ),
    );
  };
  return {
    coordinator,
    counter,
    text,
    vision,
    engines,
    events,
    transitions,
    until,
    settled,
    install,
  };
}

const kinds = (events: AiEvent[], id: string) =>
  events.filter((e) => e.id === id).map((e) => e.kind);
const types = (transitions: Transition[]) => transitions.map((t) => `${t.type}:${t.model}`);

describe('a task', () => {
  it('is refused where no model has its capability, and where the files are not there', async () => {
    const ctx = setup({ withVision: false });
    expect(await ctx.coordinator.run('v', PAGE_TASK)).toEqual({
      ok: false,
      problem: 'not-available',
    });
    expect(await ctx.coordinator.run('t', TEXT_TASK)).toEqual({
      ok: false,
      problem: 'not-installed',
    });
    expect(ctx.engines).toHaveLength(0);
  });

  it('goes to the engine, streams, ends with done, and the model loads once for several', async () => {
    const ctx = setup({ engineOptions: { autoFinish: true } });
    await ctx.install(ctx.text);
    for (const id of ['a', 'b']) {
      expect(await ctx.coordinator.run(id, TEXT_TASK)).toEqual({ ok: true, id });
      await ctx.settled(id);
    }
    const first = kinds(ctx.events, 'a');
    expect(first.indexOf('step')).toBeLessThan(first.indexOf('text'));
    expect(first.at(-1)).toBe('done');
    expect(ctx.engines).toHaveLength(1);
    expect(types(ctx.transitions)).toEqual([
      'loading:text-a',
      'loaded:text-a',
      'start:text-a',
      'end:text-a',
      'start:text-a',
      'end:text-a',
    ]);
  });

  it('refuses an id that is reserved, empty or already in use', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    expect(await ctx.coordinator.run('install:x', TEXT_TASK)).toEqual({
      ok: false,
      problem: 'failed',
    });
    expect(await ctx.coordinator.run('', TEXT_TASK)).toEqual({ ok: false, problem: 'failed' });
    await ctx.coordinator.run('same', TEXT_TASK);
    expect(await ctx.coordinator.run('same', TEXT_TASK)).toEqual({ ok: false, problem: 'failed' });
  });
});

describe('the single-resident lock', () => {
  it('releases the loaded model before the next one loads, and never has two alive', async () => {
    const ctx = setup({ engineOptions: { autoFinish: true } });
    await ctx.install(ctx.text);
    await ctx.install(ctx.vision);
    await ctx.coordinator.run('t1', TEXT_TASK);
    await ctx.settled('t1');
    expect(ctx.coordinator.state().resident).toBe('text-a');

    await ctx.coordinator.run('v1', PAGE_TASK);
    await ctx.settled('v1');
    expect(ctx.coordinator.state().resident).toBe('vision-b');

    await ctx.coordinator.run('t2', TEXT_TASK);
    await ctx.settled('t2');

    expect(types(ctx.transitions)).toEqual([
      'loading:text-a',
      'loaded:text-a',
      'start:text-a',
      'end:text-a',
      'released:text-a',
      'loading:vision-b',
      'loaded:vision-b',
      'start:vision-b',
      'end:vision-b',
      'released:vision-b',
      'loading:text-a',
      'loaded:text-a',
      'start:text-a',
      'end:text-a',
    ]);
    expect(
      ctx.transitions.filter((t) => t.type === 'released').map((t) => 'reason' in t && t.reason),
    ).toEqual(['swap', 'swap']);
    expect(ctx.counter.maxAlive).toBe(1);
    expect(ctx.engines[0]!.alive).toBe(false);
  });

  it('makes a task for the other model wait for the running one, then swaps', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.install(ctx.vision);
    await ctx.coordinator.run('t', TEXT_TASK);
    await ctx.until((e) => e.id === 't' && e.kind === 'text');
    await ctx.coordinator.run('v', PAGE_TASK);

    expect(ctx.coordinator.state()).toMatchObject({
      resident: 'text-a',
      running: 't',
      queued: ['v'],
    });
    expect(ctx.events.find((e) => e.id === 'v')).toMatchObject({ kind: 'queued', position: 1 });
    // Nothing of the vision model exists yet.
    expect(ctx.engines).toHaveLength(1);

    ctx.engines[0]!.complete();
    await ctx.until((e) => e.id === 'v' && e.kind === 'text');
    expect(ctx.coordinator.state()).toMatchObject({
      resident: 'vision-b',
      running: 'v',
      queued: [],
    });
    expect(ctx.engines[0]!.alive).toBe(false);
    expect(ctx.counter.maxAlive).toBe(1);
    ctx.engines[1]!.complete();
    await ctx.settled('v');
  });
});

describe('the queue', () => {
  it('runs the highest priority first, and the oldest first among equals', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('first', TEXT_TASK);
    await ctx.until((e) => e.id === 'first' && e.kind === 'text');
    await ctx.coordinator.run('normal-1', TEXT_TASK);
    await ctx.coordinator.run('background', TEXT_TASK, { priority: PRIORITY.background });
    await ctx.coordinator.run('interactive', TEXT_TASK, { priority: PRIORITY.interactive });
    await ctx.coordinator.run('normal-2', TEXT_TASK);
    expect(ctx.coordinator.state().queued.sort()).toEqual(
      ['background', 'interactive', 'normal-1', 'normal-2'].sort(),
    );

    const order: string[] = [];
    for (const id of ['first', 'interactive', 'normal-1', 'normal-2', 'background']) {
      await vi.waitFor(() => expect(ctx.coordinator.state().running).toBe(id));
      order.push(id);
      ctx.engines[0]!.complete();
      await ctx.settled(id);
    }
    expect(order).toEqual(['first', 'interactive', 'normal-1', 'normal-2', 'background']);
    expect(ctx.coordinator.state()).toMatchObject({ running: null, queued: [], activity: 'idle' });
  });
});

describe('cancelling', () => {
  it('reaches the engine of a running task', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('c', TEXT_TASK);
    await ctx.until((e) => e.id === 'c' && e.kind === 'text');
    await ctx.coordinator.cancel('c');
    expect(await ctx.settled('c')).toMatchObject({ kind: 'error', problem: 'cancelled' });
    expect(ctx.engines[0]!.aborted).toEqual([true]);
    await vi.waitFor(() => expect(ctx.coordinator.state().activity).toBe('idle'));
  });

  it('takes a waiting task out of the queue without ever running it', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('a', TEXT_TASK);
    await ctx.until((e) => e.id === 'a' && e.kind === 'text');
    await ctx.coordinator.run('b', TEXT_TASK);
    await ctx.coordinator.cancel('b');
    expect(ctx.events.find((e) => e.id === 'b' && e.kind === 'error')).toMatchObject({
      problem: 'cancelled',
    });
    expect(ctx.coordinator.state().queued).toEqual([]);
    ctx.engines[0]!.complete();
    await ctx.settled('a');
    expect(ctx.engines[0]!.tasks).toHaveLength(1);
  });

  it('can stop a task that is still being checked, before the engine exists', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('early', TEXT_TASK);
    await ctx.coordinator.cancel('early');
    expect(await ctx.settled('early')).toMatchObject({ problem: 'cancelled' });
    expect(ctx.engines.every((e) => e.tasks.length === 0)).toBe(true);
  });
});

describe('idle unload', () => {
  it('disposes the engine after idleMs, and not before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate'] });
    const ctx = setup({ engineOptions: { autoFinish: true }, idleMs: 1000, fake: true });
    await ctx.coordinator.run('a', TEXT_TASK);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.events.some((e) => e.id === 'a' && e.kind === 'done')).toBe(true);
    expect(ctx.coordinator.state().resident).toBe('text-a');

    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.coordinator.state().resident).toBe('text-a');
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.coordinator.state().resident).toBeNull();
    expect(ctx.engines[0]!.alive).toBe(false);
    expect(ctx.transitions.at(-1)).toEqual({ type: 'released', model: 'text-a', reason: 'idle' });
  });

  it('starts counting again after every task, and never unloads under a running one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate'] });
    const ctx = setup({ engineOptions: { autoFinish: true }, idleMs: 1000, fake: true });
    await ctx.coordinator.run('a', TEXT_TASK);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(800);
    await ctx.coordinator.run('b', TEXT_TASK);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(ctx.coordinator.state().resident).toBe('text-a');
    expect(ctx.engines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.coordinator.state().resident).toBeNull();
  });

  it('defaults to ten minutes', () => {
    expect(IDLE_MS).toBe(10 * 60 * 1000);
  });
});

describe('free memory', () => {
  it('is checked against the manifest before anything is loaded, and says so up front', async () => {
    const ctx = setup({ freeMemory: () => 999 });
    await ctx.install(ctx.text);
    expect(await ctx.coordinator.run('m', TEXT_TASK)).toEqual({
      ok: false,
      problem: 'too-little-memory',
    });
    expect(ctx.engines).toHaveLength(0);
    expect((await ctx.coordinator.status()).freeMemoryBytes).toBe(999);
  });

  it('is checked after the loaded model is released, for a swap', async () => {
    let free = 1e12;
    const ctx = setup({ engineOptions: { autoFinish: true }, freeMemory: () => free });
    await ctx.install(ctx.text);
    await ctx.install(ctx.vision);
    await ctx.coordinator.run('t', TEXT_TASK);
    await ctx.settled('t');
    free = 999;
    // Accepted: the loaded model will be gone when this one's turn comes...
    expect(await ctx.coordinator.run('v', PAGE_TASK)).toEqual({ ok: true, id: 'v' });
    // ...and then there is not room, so it says so and loads nothing.
    expect(await ctx.settled('v')).toMatchObject({ kind: 'error', problem: 'too-little-memory' });
    expect(ctx.coordinator.state().resident).toBeNull();
    expect(ctx.counter.alive).toBe(0);
  });
});

describe('the files', () => {
  it('are hashed before the first use and refused when they do not match, deleting nothing', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    const bad = Buffer.from(ctx.text.contents[0]!);
    bad[10] = bad[10]! ^ 1;
    await writeFile(join(dir, 'models', ctx.text.manifest.files[0]!.name), bad);
    await ctx.coordinator.run('d', TEXT_TASK);
    expect(await ctx.settled('d')).toMatchObject({ kind: 'error', problem: 'damaged' });
    expect(ctx.engines).toHaveLength(0);
    expect(await readdir(join(dir, 'models'))).toContain(ctx.text.manifest.files[0]!.name);
    const status = (await ctx.coordinator.status()).models.find((m) => m.id === 'text-a')!;
    expect(status).toMatchObject({ state: 'damaged' });
    expect(status.files[0]).toMatchObject({ hash: 'damaged' });
  });

  it('are hashed once: the status says verified, and a second task does not hash again', async () => {
    const ctx = setup({ engineOptions: { autoFinish: true } });
    await ctx.install(ctx.text);
    expect((await ctx.coordinator.status()).models[0]!.files[0]!.hash).toBe('unchecked');
    await ctx.coordinator.run('a', TEXT_TASK);
    await ctx.settled('a');
    expect((await ctx.coordinator.status()).models[0]!.files[0]!.hash).toBe('verified');
    await ctx.coordinator.run('b', TEXT_TASK);
    await ctx.settled('b');
    // Step events with progress come from hashing; there was one burst, for the first task.
    expect(ctx.events.filter((e) => e.id === 'b' && e.kind === 'step' && e.done < e.total)).toEqual(
      [],
    );
  });

  it('of a model with a projector must all be there', async () => {
    const ctx = setup({ engineOptions: { autoFinish: true } });
    // Only the weights are on disk; the projector is not.
    await ctx.install({
      manifest: { ...ctx.vision.manifest, files: ctx.vision.manifest.files.slice(0, 1) },
      contents: ctx.vision.contents.slice(0, 1),
    });
    expect(await ctx.coordinator.run('v', PAGE_TASK)).toEqual({
      ok: false,
      problem: 'not-installed',
    });
    const status = (await ctx.coordinator.status()).models.find((m) => m.id === 'vision-b')!;
    expect(status.state).toBe('missing');
    expect(status.files.map((f) => f.hash)).toEqual(['unchecked', 'missing']);
  });
});

describe('an engine that fails', () => {
  it('to load is reported, and nothing stays loaded', async () => {
    const ctx = setup({ engineOptions: { loadError: new AiError('cannot-start') } });
    await ctx.install(ctx.text);
    await ctx.coordinator.run('x', TEXT_TASK);
    expect(await ctx.settled('x')).toMatchObject({ problem: 'cannot-start' });
    expect(ctx.coordinator.state()).toMatchObject({ resident: null, activity: 'idle' });
  });

  it('in the middle of a task is released, so the next task gets a fresh one', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('x', TEXT_TASK);
    await ctx.until((e) => e.id === 'x' && e.kind === 'text');
    ctx.engines[0]!.crash();
    expect(await ctx.settled('x')).toMatchObject({ problem: 'cannot-start' });
    expect(ctx.transitions.at(-1)).toEqual({
      type: 'released',
      model: 'text-a',
      reason: 'crashed',
    });
    await ctx.coordinator.run('y', TEXT_TASK);
    await ctx.until((e) => e.id === 'y' && e.kind === 'text');
    expect(ctx.engines).toHaveLength(2);
    ctx.engines[1]!.complete();
  });
});

describe('getting a model', () => {
  const served = (manifest: ModelManifest, contents: Buffer[]): typeof fetch =>
    (async (url: string | URL | Request) => {
      const index = manifest.files.findIndex((f) => String(url).endsWith(f.name));
      return index < 0
        ? new Response('no', { status: 404 })
        : new Response(new Blob([contents[index] as BlobPart]));
    }) as typeof fetch;

  it('does nothing without the explicit consent flag', async () => {
    const fetchSpy = vi.fn();
    const ctx = setup({ fetch: fetchSpy as unknown as typeof fetch });
    expect(await ctx.coordinator.install('vision-b', false)).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.events).toEqual([]);
  });

  it('fetches every file of a model, reports file by file, and the model is then installed', async () => {
    const probe = setup();
    const own = createCoordinator({
      registry: [probe.vision.manifest],
      engines: {},
      dir: join(dir, 'own'),
      env: {},
      repoRoot: null,
      freeMemory: () => 1e12,
      chooseFile: () => Promise.resolve(null),
      fetch: served(probe.vision.manifest, probe.vision.contents),
      cache: new ResultCache(join(dir, 'own-cache.json')),
    });
    const events: AiEvent[] = [];
    own.onEvent((e) => events.push(e));
    expect(await own.install('vision-b', true)).toEqual({ ok: true, id: 'install:vision-b' });
    await vi.waitFor(() => expect(events.some((e) => e.kind === 'installed')).toBe(true));
    const files = events.filter((e) => e.kind === 'install').map((e) => 'file' in e && e.file);
    expect(new Set(files)).toEqual(new Set([1, 2]));
    const status = (await own.status()).models[0]!;
    expect(status).toMatchObject({ state: 'installed', available: false });
    expect(status.files.map((f) => f.source)).toEqual(['user-data', 'user-data']);
    expect(status.files.map((f) => f.hash)).toEqual(['verified', 'verified']);

    // Removing deletes what Loppa downloaded.
    expect((await own.remove('vision-b')).models[0]!.state).toBe('missing');
    expect(await readdir(join(dir, 'own'))).toEqual([]);
  });

  it('is busy while another download runs, and a task waits for nothing it cannot have', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = (async () => {
      await gate;
      return new Response('x', { status: 503 });
    }) as unknown as typeof fetch;
    const ctx = setup({ fetch: slow });
    await ctx.install(ctx.text);
    expect(await ctx.coordinator.install('vision-b', true)).toEqual({
      ok: true,
      id: 'install:vision-b',
    });
    expect(await ctx.coordinator.install('text-a', true)).toEqual({ ok: false, problem: 'busy' });
    expect(await ctx.coordinator.run('t', TEXT_TASK)).toEqual({ ok: false, problem: 'busy' });
    release();
    expect(await ctx.until((e) => e.kind === 'install-failed')).toMatchObject({
      problem: 'download-failed',
    });
  });

  it('can be cancelled by the id of the install', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const stop = () => reject(new DOMException('x', 'AbortError'));
        if (init?.signal?.aborted) stop();
        init?.signal?.addEventListener('abort', stop);
      })) as unknown as typeof fetch;
    const ctx = setup({ fetch: hang });
    await ctx.coordinator.install('vision-b', true);
    await ctx.coordinator.cancel('install:vision-b');
    expect(await ctx.until((e) => e.kind === 'install-failed')).toMatchObject({
      problem: 'cancelled',
    });
    expect(ctx.coordinator.state().activity).toBe('idle');
  });

  it('opens a file from disk by its hash, per file, and uses it where it is', async () => {
    const chosen = { path: null as string | null };
    const ctx = setup({ chooseFile: () => Promise.resolve(chosen.path) });
    const mine = join(dir, 'mine.bin');
    await writeFile(mine, ctx.vision.contents[1]!);
    chosen.path = mine;
    expect(await ctx.coordinator.openFromDisk('vision-b')).toEqual({
      ok: true,
      id: 'install:vision-b',
    });
    await ctx.until((e) => e.kind === 'installed');
    const status = (await ctx.coordinator.status()).models.find((m) => m.id === 'vision-b')!;
    expect(status.files.map((f) => [f.role, f.source, f.hash])).toEqual([
      ['weights', null, 'missing'],
      ['projector', 'remembered', 'verified'],
    ]);
    // Forgetting it does not delete the person's file.
    await ctx.coordinator.remove('vision-b');
    expect(await readdir(dir)).toContain('mine.bin');
  });

  it('refuses a file that is none of the model, and remembers nothing', async () => {
    const ctx = setup({ chooseFile: () => Promise.resolve(join(dir, 'other.bin')) });
    await writeFile(join(dir, 'other.bin'), randomBytes(2000));
    await ctx.coordinator.openFromDisk('text-a');
    expect(await ctx.until((e) => e.kind === 'install-failed')).toMatchObject({
      problem: 'not-a-model-file',
    });
    expect((await ctx.coordinator.status()).models[0]!.state).toBe('missing');
  });

  it('closing the dialog changes nothing', async () => {
    const ctx = setup();
    expect(await ctx.coordinator.openFromDisk('text-a')).toEqual({
      ok: false,
      problem: 'cancelled',
    });
  });
});

describe('an evaluation-only model', () => {
  const evaluation = (bytes: Buffer) =>
    ModelManifest.parse({
      capabilities: ['vision'],
      distributable: false,
      evaluationOnly: true,
      files: [{ bytes: bytes.length, name: 'eval.gguf', parts: [], role: 'weights' }],
      id: 'eval-v',
      kind: 'vision',
      licence: 'Qwen-Research',
      licenceUrl: 'https://example.test/licence',
      name: 'eval',
      requiredMemoryBytes: 1000,
      retrievedAt: '2026-10-14',
      source: 'https://example.test/source',
      sourceRevision: 'x',
    });

  it('is labelled, accepted where it is, never fetched, and never made available by being there', async () => {
    const bytes = randomBytes(600);
    const manifest = evaluation(bytes);
    const fetchSpy = vi.fn();
    const coordinator = createCoordinator({
      registry: [manifest],
      engines: {},
      dir: join(dir, 'models'),
      env: { LOPPA_AI_DIR: dir },
      repoRoot: null,
      freeMemory: () => 1e12,
      chooseFile: () => Promise.resolve(null),
      fetch: fetchSpy as unknown as typeof fetch,
      cache: new ResultCache(join(dir, 'c.json')),
    });
    expect(await coordinator.install('eval-v', true)).toEqual({
      ok: false,
      problem: 'download-unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await writeFile(join(dir, 'eval.gguf'), bytes);
    const [status] = (await coordinator.status()).models;
    expect(status).toMatchObject({
      state: 'evaluation-only',
      label: 'unverified-licence',
      downloadBlocked: 'evaluation-only',
      distributable: false,
      available: false,
    });
    expect(status!.files[0]).toMatchObject({ source: 'env', hash: 'unpinned' });
    // Nothing to run it with yet.
    expect(await coordinator.run('v', PAGE_TASK)).toEqual({ ok: false, problem: 'not-available' });
  });
});

describe('the fake mode CI runs', () => {
  it('needs no file, no hash and no memory, and still runs the whole path', async () => {
    const ctx = setup({ fake: true, freeMemory: () => 0, engineOptions: { autoFinish: true } });
    const status = await ctx.coordinator.status();
    expect(status.models.map((m) => [m.id, m.state, m.available])).toEqual([
      ['text-a', 'installed', true],
      ['vision-b', 'installed', true],
    ]);
    await ctx.coordinator.run('f', TEXT_TASK);
    await ctx.settled('f');
  });
});

describe('closing', () => {
  it('cancels what is waiting, aborts what is running and releases the engine', async () => {
    const ctx = setup();
    await ctx.install(ctx.text);
    await ctx.coordinator.run('a', TEXT_TASK);
    await ctx.until((e) => e.id === 'a' && e.kind === 'text');
    await ctx.coordinator.run('b', TEXT_TASK);
    await ctx.coordinator.close();
    expect(ctx.events.find((e) => e.id === 'b' && e.kind === 'error')).toMatchObject({
      problem: 'cancelled',
    });
    expect(await ctx.settled('a')).toMatchObject({ problem: 'cancelled' });
    expect(ctx.engines[0]!.alive).toBe(false);
  });

  it('clears the result cache on request', async () => {
    const ctx = setup();
    const cache = new ResultCache(join(dir, 'cc.json'));
    await cache.set('k', 1);
    const coordinator = createCoordinator({
      registry: [ctx.text.manifest],
      engines: {},
      dir: join(dir, 'models'),
      env: {},
      repoRoot: null,
      freeMemory: () => 1e12,
      chooseFile: () => Promise.resolve(null),
      fetch,
      cache,
    });
    expect((await coordinator.status()).cache.entries).toBe(1);
    expect((await coordinator.clearCache()).cache.entries).toBe(0);
  });
});

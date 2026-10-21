import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consentFor, type AiEvent, type AiTask } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator, type Coordinator, type Transition } from './coordinator.js';
import type { Engine } from './engine.js';
import { ServerEngine } from './engines/server-engine.js';
import { defaultSpawn } from './server/llama-server.js';
import { tinyModel, writeTinyModel } from './test-support/tiny-model.js';

/**
 * The AI stack's failure modes, driven through the real coordinator, the real `ServerEngine`, the
 * real process supervision and real (tiny) model files, with a scriptable stand-in for
 * `llama-server` as the child (`server/test-support/fake-llama-server.mjs`). What a real model adds
 * is in `reliability.real.test.ts` (opt-in). The table of scenarios is in
 * `docs/reviews/2026-10-desktop-ai.md`.
 */
const SCRIPT = join(import.meta.dirname, 'server/test-support/fake-llama-server.mjs');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const TEXT_TASK: AiTask = { kind: 'translate', text: 'Hej på dig', into: 'en-GB' };
const page = (n: number): AiTask => ({
  kind: 'read-page',
  fileSha256: 'a'.repeat(64),
  page: n,
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  longEdge: 1000,
  turn: 0,
  language: null,
});

interface Spawned {
  pid: number;
  model: string;
  args: string[];
  log: string[];
}

let root = '';
let rigs: Array<() => Promise<void>> = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loppa-reliability-'));
});
afterEach(async () => {
  for (const done of rigs.reverse()) await done();
  rigs = [];
  await rm(root, { recursive: true, force: true });
});

interface RigOptions {
  /** FAKE_LLAMA for the next process started; change it between tasks. */
  modes?: string;
  idleMs?: number;
  /** The engine takes this long to let go of its process, as a busy computer does. */
  disposeDelayMs?: number;
  /** Free memory is what a computer with no process of ours alive would have. */
  memoryFollowsProcesses?: boolean;
  modelsDir?: string;
  write?: boolean;
}

async function rig(options: RigOptions = {}) {
  const text = tinyModel('t-text', 'text', [3000, 500]);
  const vision = tinyModel('t-vision', 'vision', [2000, 500]);
  const state = { modes: options.modes ?? '', free: 1e12 };
  const spawned: Spawned[] = [];
  const modelsDir = options.modelsDir ?? join(root, 'models');
  if (options.write !== false) {
    await writeTinyModel(modelsDir, text);
    await writeTinyModel(modelsDir, vision);
  }

  const aliveCount = () => spawned.filter((p) => alive(p.pid)).length;
  const factory = (model: string) => (files: ConstructorParameters<typeof ServerEngine>[0]) => {
    const engine = new ServerEngine(files, {
      locateRuntime: () => Promise.resolve('/runtime/llama-server'),
      totalMemory: () => 32e9,
      readyTimeoutMs: 15_000,
      settings: { threads: 2, contextTokens: 2048 },
      spawn: (_command, args) => {
        const real = defaultSpawn({ ...process.env, FAKE_LLAMA: state.modes }, ['FAKE_LLAMA']);
        const handle = real(process.execPath, [SCRIPT, ...args], process.cwd());
        const entry: Spawned = { pid: handle.pid!, model, args, log: [] };
        handle.onLog((line) => entry.log.push(line));
        spawned.push(entry);
        return handle;
      },
    });
    if (!options.disposeDelayMs) return engine;
    const slow: Engine = {
      load: (signal) => engine.load(signal),
      run: (task, onEvent, signal) => engine.run(task, onEvent, signal),
      dispose: async () => {
        await sleep(options.disposeDelayMs!);
        await engine.dispose();
      },
    };
    return slow;
  };

  const events: AiEvent[] = [];
  const transitions: Transition[] = [];
  const coordinator: Coordinator = createCoordinator({
    registry: [text.manifest, vision.manifest],
    engines: { [text.manifest.id]: factory('text'), [vision.manifest.id]: factory('vision') },
    dir: modelsDir,
    env: {},
    repoRoot: null,
    freeMemory: () => (options.memoryFollowsProcesses && aliveCount() > 0 ? 0 : state.free),
    chooseFile: () => Promise.resolve(null),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    cache: new ResultCache(join(root, 'cache.json')),
    ...(options.idleMs ? { idleMs: options.idleMs } : {}),
  });
  coordinator.onEvent((e) => events.push(e));
  coordinator.onTransition((t) => transitions.push(t));

  const until = async (match: (e: AiEvent) => boolean, timeout = 10_000) => {
    await vi.waitFor(() => expect(events.some(match)).toBe(true), { timeout, interval: 10 });
    return events.find(match)!;
  };
  const settled = (id: string) =>
    until((e) => e.id === id && (e.kind === 'done' || e.kind === 'error'));
  const sampler = () => {
    let max = 0;
    const timer = setInterval(() => (max = Math.max(max, aliveCount())), 5);
    return {
      stop: () => {
        clearInterval(timer);
        return max;
      },
    };
  };

  rigs.push(async () => {
    await coordinator.close();
    // After `close` no process of ours may be left, whatever the test did to it.
    const orphans = spawned.filter((p) => alive(p.pid));
    for (const p of orphans) process.kill(p.pid, 'SIGKILL');
    expect(orphans.map((p) => p.pid)).toEqual([]);
  });

  return {
    text,
    vision,
    state,
    spawned,
    events,
    transitions,
    coordinator,
    until,
    settled,
    sampler,
    aliveCount,
    modelsDir,
    /** The stand-in has written its `n`th piece of the answer: the task is truly mid-stream. */
    piece: (n = 0, process = 0) =>
      vi.waitFor(() => expect(spawned[process]?.log).toContain(`fake: piece ${n}`), {
        timeout: 10_000,
        interval: 10,
      }),
    run: (id: string, task: AiTask) => coordinator.run(id, task),
    of: (id: string) => events.filter((e) => e.id === id).map((e) => e.kind),
  };
}

describe('cancelling, at every phase of a task', () => {
  it('while it waits in the queue: it never starts, and the running task is not disturbed', async () => {
    const r = await rig({ modes: 'slow-stream' });
    await r.run('one', TEXT_TASK);
    await r.run('two', TEXT_TASK);
    await r.until((e) => e.id === 'two' && e.kind === 'queued');
    await r.coordinator.cancel('two');
    await expect(r.settled('two')).resolves.toMatchObject({ problem: 'cancelled' });
    await expect(r.settled('one')).resolves.toMatchObject({ kind: 'done' });
    expect(
      r.transitions.filter((t) => t.type === 'start').map((t) => t.type === 'start' && t.id),
    ).toEqual(['one']);
  });

  it('while the model loads: the process is ended, nothing stays resident, and the next task starts afresh', async () => {
    const r = await rig({ modes: 'slow-load' });
    await r.run('one', TEXT_TASK);
    await r.until(() => r.spawned.length === 1);
    await r.coordinator.cancel('one');
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'cancelled' });
    expect(alive(r.spawned[0]!.pid)).toBe(false);
    expect(r.coordinator.state().resident).toBeNull();

    r.state.modes = '';
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    expect(r.spawned).toHaveLength(2);
    expect(alive(r.spawned[0]!.pid)).toBe(false);
  });

  it('while the prompt is being processed (the request sent, nothing back yet): the request is closed, the process stays for the next task', async () => {
    const r = await rig({ modes: 'hang-prompt' });
    await r.run('one', TEXT_TASK);
    await vi.waitFor(() => expect(r.spawned[0]?.log).toContain('fake: request'), {
      timeout: 10_000,
    });
    await r.coordinator.cancel('one');
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'cancelled' });
    await vi.waitFor(() => expect(r.spawned[0]!.log).toContain('fake: client closed'));

    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    expect(r.spawned).toHaveLength(1); // the same, still loaded, process
  });

  it('in the middle of the answer: stops, keeps the process, and says nothing more for the id', async () => {
    const r = await rig({ modes: 'slow-stream' });
    await r.run('one', TEXT_TASK);
    await r.piece();
    await r.coordinator.cancel('one');
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'cancelled' });
    await sleep(400);
    expect(r.of('one').filter((k) => k === 'done' || k === 'error')).toHaveLength(1);
    expect(r.coordinator.state()).toMatchObject({ running: null, activity: 'idle' });
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    expect(r.spawned).toHaveLength(1);
  });

  it('after it is done: nothing happens, to it or to the next task', async () => {
    const r = await rig();
    await r.run('one', TEXT_TASK);
    await r.settled('one');
    const before = r.events.length;
    await r.coordinator.cancel('one');
    await r.coordinator.cancel('never-existed');
    expect(r.events).toHaveLength(before);
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
  });
});

describe('one model resident at a time', () => {
  it('two tasks of different capabilities queued together: they run in turn and two processes are never alive together', async () => {
    const r = await rig({ modes: 'slow-stream' });
    const sample = r.sampler();
    await r.run('t1', TEXT_TASK);
    await r.run('p1', page(1));
    await r.run('t2', TEXT_TASK);
    for (const id of ['t1', 'p1', 't2']) {
      await expect(r.settled(id)).resolves.toMatchObject({ kind: 'done' });
    }
    expect(sample.stop()).toBe(1);
    expect(r.spawned.map((p) => p.model)).toEqual(['text', 'vision', 'text']);
    const slot = r.transitions.map((t) => `${t.type}:${t.model}`);
    expect(slot.indexOf('released:t-text')).toBeLessThan(slot.indexOf('loading:t-vision'));
    expect(r.spawned.filter((p) => alive(p.pid))).toHaveLength(1); // only the last is resident
  });

  it('a task that arrives while the idle timer is letting go of the process waits for it: no overlap, no false out-of-memory', async () => {
    const r = await rig({ idleMs: 120, disposeDelayMs: 400, memoryFollowsProcesses: true });
    const sample = r.sampler();
    await r.run('one', TEXT_TASK);
    await r.settled('one');
    await r.until(
      () => false || r.transitions.some((t) => t.type === 'released' && t.reason === 'idle'),
    );
    // The process is still ending (the engine takes 400 ms); this is the moment a person presses Summarise.
    expect(r.aliveCount()).toBe(1);
    const started = await r.run('two', TEXT_TASK);
    expect(started).toEqual({ ok: true, id: 'two' });
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    expect(sample.stop()).toBe(1);
    expect(r.spawned).toHaveLength(2);
  });

  it('closing waits for a release in progress, so no process outlives the app', async () => {
    const r = await rig({ idleMs: 100, disposeDelayMs: 300 });
    await r.run('one', TEXT_TASK);
    await r.settled('one');
    await r.until(() => false || r.transitions.some((t) => t.type === 'released'));
    await r.coordinator.close();
    expect(r.aliveCount()).toBe(0);
  });
});

describe('the child process dies', () => {
  it('killed (kill -9) in the middle of an answer: cannot-start, the slot is cleared, the next task restarts it', async () => {
    const r = await rig({ modes: 'slow-stream' });
    await r.run('one', TEXT_TASK);
    await r.piece();
    process.kill(r.spawned[0]!.pid, 'SIGKILL');
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'cannot-start' });
    expect(r.transitions).toContainEqual({ type: 'released', model: 't-text', reason: 'crashed' });
    expect(r.coordinator.state().resident).toBeNull();

    r.state.modes = '';
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    expect(r.spawned).toHaveLength(2);
    expect(alive(r.spawned[0]!.pid)).toBe(false);
  });

  it('killed while a page is being read (nothing back yet): the same', async () => {
    const r = await rig({ modes: 'hang-prompt' });
    await r.run('p1', page(1));
    await vi.waitFor(() => expect(r.spawned[0]?.log).toContain('fake: request'), {
      timeout: 10_000,
    });
    process.kill(r.spawned[0]!.pid, 'SIGKILL');
    await expect(r.settled('p1')).resolves.toMatchObject({ problem: 'cannot-start' });
    expect(r.coordinator.state().resident).toBeNull();
    r.state.modes = '';
    await r.run('p2', page(2));
    await expect(r.settled('p2')).resolves.toMatchObject({ kind: 'done' });
  });

  it('killed while idle: the next task says so once, and the one after it works', async () => {
    const r = await rig();
    await r.run('one', TEXT_TASK);
    await r.settled('one');
    process.kill(r.spawned[0]!.pid, 'SIGKILL');
    await vi.waitFor(() => expect(alive(r.spawned[0]!.pid)).toBe(false));
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ problem: 'cannot-start' });
    await r.run('three', TEXT_TASK);
    await expect(r.settled('three')).resolves.toMatchObject({ kind: 'done' });
    expect(r.spawned).toHaveLength(2);
  });

  it('a stream that stops without its end marker is a failure, never a finished answer', async () => {
    const r = await rig({ modes: 'truncate-stream' });
    await r.run('one', TEXT_TASK);
    const verdict = await r.settled('one');
    expect(verdict.kind).toBe('error');
    expect(r.of('one')).not.toContain('done');
  });

  it('a start that crashes leaves no process, and a later start works', async () => {
    const r = await rig({ modes: 'crash-on-start' });
    await r.run('one', TEXT_TASK);
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'cannot-start' });
    expect(r.aliveCount()).toBe(0);
    r.state.modes = '';
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
  });
});

describe('too little memory', () => {
  it("under the model's requirement: refused up front, nothing started", async () => {
    const r = await rig();
    r.state.free = 10;
    await expect(r.run('one', TEXT_TASK)).resolves.toEqual({
      ok: false,
      problem: 'too-little-memory',
    });
    expect(r.spawned).toHaveLength(0);
  });

  it('the program itself running out of memory while loading: too-little-memory, no process left, and it works when memory is back', async () => {
    const r = await rig({ modes: 'oom' });
    await r.run('one', TEXT_TASK);
    await expect(r.settled('one')).resolves.toMatchObject({ problem: 'too-little-memory' });
    expect(r.aliveCount()).toBe(0);
    r.state.modes = '';
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
  });
});

describe('missing, damaged and partial files', () => {
  type Damage = (paths: string[], r: Awaited<ReturnType<typeof rig>>) => Promise<void>;
  const cases: Array<[string, Damage, string]> = [
    ['truncated by one byte', async ([w]) => truncate(w!, (await stat(w!)).size - 1), 'damaged'],
    [
      'one byte flipped in the projector',
      async ([, p]) => {
        const bytes = await readFile(p!);
        bytes[bytes.length >> 1] = bytes[bytes.length >> 1]! ^ 0xff;
        await writeFile(p!, bytes);
      },
      'damaged',
    ],
    [
      'the manifest names another hash than the file has',
      async ([w], r) => {
        // Same size, different bytes: a file that is not the one the manifest means.
        await writeFile(w!, Buffer.alloc(r.text.contents[0]!.length, 7));
      },
      'damaged',
    ],
    ['empty', async ([w]) => writeFile(w!, ''), 'damaged'],
    [
      'a pack part never copied (the projector is missing)',
      async ([, p]) => rm(p!),
      'not-installed',
    ],
    ['the weights are missing', async ([w]) => rm(w!), 'not-installed'],
  ];

  it.each(cases)(
    '%s: refused, nothing started, nothing deleted, and mended by putting the file back',
    async (_name, damage, problem) => {
      const r = await rig({ write: false });
      const paths = await writeTinyModel(r.modelsDir, r.text);
      await writeTinyModel(r.modelsDir, r.vision);
      const originals = await Promise.all(paths.map((p) => readFile(p)));
      await damage(paths, r);
      const damagedBytes = await Promise.all(paths.map((p) => readFile(p).catch(() => null)));

      const start = await r.run('one', TEXT_TASK);
      if (start.ok) {
        await expect(r.settled('one')).resolves.toMatchObject({ problem });
      } else {
        expect(start.problem).toBe(problem);
      }
      expect(r.spawned).toHaveLength(0);
      // Nothing was deleted or rewritten by the refusal.
      expect(await Promise.all(paths.map((p) => readFile(p).catch(() => null)))).toEqual(
        damagedBytes,
      );

      // The person puts the right file back; no restart of the app is needed.
      await Promise.all(paths.map((p, i) => writeFile(p, originals[i]!)));
      const status = await r.coordinator.status();
      expect(status.models.find((m) => m.id === 't-text')!.files.map((f) => f.hash)).not.toContain(
        'damaged',
      );
      await r.run('two', TEXT_TASK);
      await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
    },
  );

  it('a folder where the weights should be is not a model', async () => {
    const r = await rig({ write: false });
    await writeTinyModel(r.modelsDir, r.vision);
    await mkdir(join(r.modelsDir, r.text.manifest.files[0]!.name), { recursive: true });
    await writeTinyModel(r.modelsDir, {
      ...r.text,
      manifest: { ...r.text.manifest, files: r.text.manifest.files.slice(1) },
    });
    const start = await r.run('one', TEXT_TASK);
    if (start.ok) await expect(r.settled('one')).resolves.toMatchObject({ kind: 'error' });
    else expect(['damaged', 'not-installed']).toContain(start.problem);
    expect(r.spawned).toHaveLength(0);
  });
});

describe('long input', () => {
  it('ten pages of text: progress only moves forward, memory stays bounded, and the answer comes', async () => {
    const r = await rig();
    const sentence = (i: number) =>
      `Paragraph ${i}: the board discussed item ${i} and agreed to review it at the next meeting.`;
    const text = Array.from({ length: 10 * 40 }, (_, i) => sentence(i)).join(' ');
    const heap = process.memoryUsage().heapUsed;
    await r.run('long', { kind: 'summarise', text, into: 'en-GB', shape: 'document' });
    await expect(r.settled('long')).resolves.toMatchObject({ kind: 'done' });
    const steps = r.events.filter((e) => e.id === 'long' && e.kind === 'step');
    expect(steps.length).toBeGreaterThan(0);
    const byStep = new Map<string, number>();
    for (const e of steps) {
      if (e.kind !== 'step') continue;
      expect(e.done).toBeGreaterThanOrEqual(byStep.get(e.step) ?? 0);
      expect(e.done).toBeLessThanOrEqual(e.total);
      byStep.set(e.step, e.done);
    }
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(150 * 1024 * 1024);
  });

  it('cancelled in the middle of a long text: ends at once and the server is not left working', async () => {
    const r = await rig({ modes: 'slow-stream' });
    const text = Array.from(
      { length: 400 },
      (_, i) => `Item ${i} was agreed after a long discussion.`,
    ).join(' ');
    await r.run('long', { kind: 'summarise', text, into: 'en-GB', shape: 'document' });
    await r.piece();
    const cancelledAt = Date.now();
    await r.coordinator.cancel('long');
    await expect(r.settled('long')).resolves.toMatchObject({ problem: 'cancelled' });
    expect(Date.now() - cancelledAt).toBeLessThan(2000);
    await vi.waitFor(() => expect(r.spawned[0]!.log).toContain('fake: client closed'));
  });

  it('thirty pages queued, the third running: cancelling them all leaves a clean slot and one verdict each', async () => {
    const r = await rig({ modes: 'slow-stream' });
    const ids = Array.from({ length: 30 }, (_, i) => `page-${i + 1}`);
    for (const [i, id] of ids.entries()) await r.run(id, page(i + 1));
    await r.until((e) => e.id === 'page-1' && e.kind === 'done', 20_000);
    await r.until((e) => e.id === 'page-2' && e.kind === 'done', 20_000);
    await r.until((e) => e.id === 'page-3' && e.kind === 'text', 20_000);
    for (const id of [...ids].reverse()) await r.coordinator.cancel(id);
    for (const id of ids) await r.settled(id);
    expect(r.coordinator.state()).toMatchObject({ running: null, queued: [], activity: 'idle' });
    for (const id of ids.slice(3))
      expect(r.of(id).filter((k) => k === 'text' || k === 'step' || k === 'done')).toEqual([]);
    expect(r.spawned).toHaveLength(1);
  });
});

describe('two windows', () => {
  it('start tasks together: each is answered on its own id, and a repeated id is refused', async () => {
    const r = await rig();
    const [a, b, again] = await Promise.all([
      r.run('window-a-1', TEXT_TASK),
      r.run('window-b-1', page(1)),
      r.run('window-a-1', TEXT_TASK),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(again).toEqual({ ok: false, problem: 'failed' });
    await expect(r.settled('window-a-1')).resolves.toMatchObject({ kind: 'done' });
    await expect(r.settled('window-b-1')).resolves.toMatchObject({ kind: 'done' });
    expect(r.of('window-a-1').filter((k) => k === 'done')).toHaveLength(1);
  });
});

describe('quitting', () => {
  it('while the model loads: the process is gone when close() returns, and the task is told', async () => {
    const r = await rig({ modes: 'slow-load' });
    await r.run('one', TEXT_TASK);
    await r.until(() => r.spawned.length === 1);
    await r.coordinator.close();
    expect(alive(r.spawned[0]!.pid)).toBe(false);
    await expect(r.settled('one')).resolves.toMatchObject({ kind: 'error' });
  });

  it('while a task runs: ended, no process left', async () => {
    const r = await rig({ modes: 'slow-stream' });
    await r.run('one', TEXT_TASK);
    await r.piece();
    await r.coordinator.close();
    expect(r.aliveCount()).toBe(0);
  });

  it("a window that is gone does not stop the queue: a listener that throws is not the task's failure", async () => {
    const r = await rig();
    r.coordinator.onEvent(() => {
      throw new Error('Object has been destroyed');
    });
    await r.run('one', TEXT_TASK);
    await expect(r.settled('one')).resolves.toMatchObject({ kind: 'done' });
    await r.run('two', TEXT_TASK);
    await expect(r.settled('two')).resolves.toMatchObject({ kind: 'done' });
  });
});

describe('where the files are', () => {
  it('a folder with spaces, accents, other scripts and a path past 260 characters works from end to end', async () => {
    const deep = join(
      root,
      'OneDrive – Företaget AB',
      'Mina dokument åäö 日本語',
      'x'.repeat(120),
      'y'.repeat(120),
      'models',
    );
    expect(deep.length).toBeGreaterThan(260);
    const r = await rig({ modelsDir: deep });
    await r.run('one', TEXT_TASK);
    await expect(r.settled('one')).resolves.toMatchObject({ kind: 'done' });
    const args = r.spawned[0]!.args;
    expect(args[args.indexOf('-m') + 1]).toBe(join(deep, 't-text-0.gguf'));
  });
});

describe('the consent record', () => {
  it('a model with a consent that names its real host is what the app offers to download', () => {
    const m = tinyModel('c', 'text', [10]).manifest;
    expect(consentFor(m)?.host).toBe('huggingface.co');
  });
});

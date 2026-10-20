import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiTask, GraphicsFailure } from '@tp/shared/ai';
import { AiError, type EngineEvent } from '../engine.js';
import { MIN_FREE_MIB, parseDevices, type GpuDevice } from '../server/gpu.js';
import { defaultSpawn, serverArgs, type SpawnFn } from '../server/llama-server.js';
import { ServerEngine, type GpuHook } from './server-engine.js';

/**
 * The optional graphics card, on the stand-in server (`fake-llama-server.mjs`, which acts like the
 * Vulkan build when it is started with `--device`): the setting off, on, and every way the card can
 * fail, each ending on the processor with the failure remembered, never a failed task.
 */
const SCRIPT = join(import.meta.dirname, '../server/test-support/fake-llama-server.mjs');
const FILES = { weights: '/models/m.gguf', projector: '/models/p.gguf' };
const TRANSLATE: AiTask = { kind: 'translate', text: 'Hej på dig', into: 'en-GB' };
const never = new AbortController().signal;
const CARD: GpuDevice = { id: 'Vulkan0', name: 'Test GPU', totalMiB: 12000, freeMiB: 11000 };

function standIn(modes: string, spawned: string[][]): SpawnFn {
  const real = defaultSpawn({ ...process.env, FAKE_LLAMA: modes }, ['FAKE_LLAMA']);
  return (_command, args) => {
    spawned.push(args);
    return real(process.execPath, [SCRIPT, ...args], process.cwd());
  };
}

function setup(modes = '', over: { hook?: Partial<GpuHook>; devices?: readonly GpuDevice[] } = {}) {
  const spawned: string[][] = [];
  const failures: GraphicsFailure[] = [];
  const ran: Array<[string | null, string | null]> = [];
  const entries: string[] = [];
  const hook: GpuHook = {
    entry: () => Promise.resolve('/runtime-vulkan/llama-server'),
    devices: () => Promise.resolve([...(over.devices ?? [CARD])]),
    failed: (reason) => void failures.push(reason),
    ranOn: (on, device) => void ran.push([on, device]),
    ...over.hook,
  };
  const engine = new ServerEngine(FILES, {
    locateRuntime: () => {
      entries.push('cpu');
      return Promise.resolve('/runtime/llama-server');
    },
    totalMemory: () => 32e9,
    spawn: standIn(modes, spawned),
    readyTimeoutMs: 15_000,
    settings: { threads: 3, contextTokens: 4096 },
    gpu: hook,
  });
  return { engine, spawned, failures, ran, entries };
}

const textOf = (events: EngineEvent[]) =>
  events.map((e) => (e.kind === 'text' ? e.text : '')).join('');
const onCard = (args: string[]) => args.includes('--device');

describe('the graphics card setting in the engine', () => {
  it('is not used when the setting is off: the processor program, no device argument', async () => {
    const { engine, spawned, failures, ran, entries } = setup('', {
      hook: { entry: () => Promise.resolve(null) },
    });
    await engine.load(never);
    await engine.run(TRANSLATE, () => undefined, never);
    await engine.dispose();
    expect(spawned).toHaveLength(1);
    expect(onCard(spawned[0]!)).toBe(false);
    expect(spawned[0]![spawned[0]!.indexOf('-ngl') + 1]).toBe('0');
    expect(entries).toEqual(['cpu']);
    expect(failures).toEqual([]);
    expect(ran[0]).toEqual(['processor', null]);
  });

  it('is used when on: one chosen card, the program fits the layers, the name is reported', async () => {
    const { engine, spawned, failures, ran, entries } = setup();
    await engine.load(never);
    const events: EngineEvent[] = [];
    await engine.run(TRANSLATE, (e) => events.push(e), never);
    expect(textOf(events)).toContain('ok');
    await engine.dispose();
    const args = spawned[0]!;
    expect(args[args.indexOf('--device') + 1]).toBe('Vulkan0');
    expect(args[args.indexOf('-ngl') + 1]).toBe('auto');
    // the same guarantees as the processor path
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args).toContain('--no-webui');
    expect(args).toContain('--offline');
    expect(args[args.indexOf('--api-key') + 1]).toMatch(/^[0-9a-f]{48}$/);
    expect(entries).toEqual([]); // the processor program was never asked for
    expect(failures).toEqual([]);
    expect(ran).toEqual([
      ['graphics', 'Test GPU'],
      [null, null], // released: nothing is running on anything
    ]);
  });

  it('keeps ServerSettings.gpuLayers when someone sets it', () => {
    const args = serverArgs(
      { weights: 'w' },
      { contextTokens: 1, threads: 1, imageMaxTokens: 1, gpuLayers: 12, device: 'Vulkan0' },
      1,
      'k',
    );
    expect(args[args.indexOf('-ngl') + 1]).toBe('12');
  });

  it.each([
    ['finds no device', '', { devices: [] }, 'no-device'],
    ['cannot start the program', 'card-crash-start', {}, 'start-failed'],
    ['runs out of memory while loading', 'card-oom', {}, 'out-of-memory'],
  ] as const)(
    'falls back to the processor when the card %s, and remembers it',
    async (_n, modes, over, reason) => {
      const { engine, spawned, failures, ran } = setup(modes, over);
      await engine.load(never);
      const events: EngineEvent[] = [];
      await engine.run(TRANSLATE, (e) => events.push(e), never);
      expect(textOf(events)).toContain('ok'); // the task did not fail
      await engine.dispose();
      expect(failures).toEqual([reason]);
      expect(onCard(spawned.at(-1)!)).toBe(false);
      expect(ran).toContainEqual(['processor', null]);
    },
  );

  it('answers a card that crashes on its first request from the processor, then remembers', async () => {
    const { engine, spawned, failures, ran } = setup('card-crash-request');
    await engine.load(never);
    expect(failures).toEqual([]); // not known yet
    const events: EngineEvent[] = [];
    const result = await engine.run(TRANSLATE, (e) => events.push(e), never);
    expect(textOf(events)).toContain('ok');
    expect(result.warnings).toBeDefined();
    expect(spawned.map(onCard)).toEqual([true, false]);
    expect(failures).toEqual(['request-failed']);
    expect(ran).toContainEqual(['processor', null]);
    await engine.dispose();
  });

  it('does not blame the card when the processor fails the same task', async () => {
    const { engine, failures } = setup('die-mid-stream');
    await engine.load(never);
    await expect(engine.run(TRANSLATE, () => undefined, never)).rejects.toBeInstanceOf(AiError);
    expect(failures).toEqual([]);
    await engine.dispose();
  });

  it('leaves a card that is busy alone this time without remembering a failure', async () => {
    const { engine, spawned, failures } = setup('', {
      devices: [{ ...CARD, freeMiB: MIN_FREE_MIB - 1 }],
    });
    await engine.load(never);
    await engine.dispose();
    expect(spawned.map(onCard)).toEqual([false]);
    expect(failures).toEqual([]);
  });

  it('goes to the processor, remembering nothing, when none of the model would fit on the card', async () => {
    const { engine, spawned, failures } = setup('card-empty');
    await engine.load(never);
    await engine.dispose();
    expect(spawned.map(onCard)).toEqual([true, false]);
    expect(failures).toEqual([]);
  });

  it('stops waiting when cancelled while the card loads, and does not blame it', async () => {
    const { engine, failures } = setup('slow-load');
    const abort = new AbortController();
    const loading = engine.load(abort.signal);
    setTimeout(() => abort.abort(), 100);
    await expect(loading).rejects.toMatchObject({ problem: 'cancelled' });
    expect(failures).toEqual([]);
  });
});

describe('the program’s device list', () => {
  it('is read as the program prints it, free memory included', () => {
    expect(
      parseDevices(
        'Available devices:\n  Vulkan0: NVIDIA GeForce RTX 4070 (12010 MiB, 11242 MiB free)\n  Vulkan1: Intel(R) UHD Graphics 770 (16268 MiB, 15500 MiB free)\n',
      ),
    ).toEqual([
      { id: 'Vulkan0', name: 'NVIDIA GeForce RTX 4070', totalMiB: 12010, freeMiB: 11242 },
      { id: 'Vulkan1', name: 'Intel(R) UHD Graphics 770', totalMiB: 16268, freeMiB: 15500 },
    ]);
    expect(parseDevices('Available devices:\n')).toEqual([]);
  });
});

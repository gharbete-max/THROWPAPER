import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiTask } from '@tp/shared/ai';
import { AiError, type EngineEvent } from '../engine.js';
import {
  chooseThreads,
  defaultSpawn,
  lacksAvx2,
  serverArgs,
  type SpawnFn,
} from '../server/llama-server.js';
import { estimateTokens } from '../server/server-text-engine.js';
import { MIN_TOTAL_MEMORY_BYTES, ServerEngine, pickProjector } from './server-engine.js';

const SCRIPT = join(import.meta.dirname, '../server/test-support/fake-llama-server.mjs');
const FILES = { weights: '/models/m.gguf', projector: '/models/p.gguf' };
const TRANSLATE: AiTask = { kind: 'translate', text: 'Hej på dig', into: 'en-GB' };
const never = new AbortController().signal;
const PAGE: AiTask = {
  kind: 'read-page',
  fileSha256: 'a'.repeat(64),
  page: 2,
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  longEdge: 1000,
  turn: 0,
  language: 'sv',
};

/** The real process plumbing, running the stand-in instead of llama-server. */
function standIn(modes = '', seen: { args?: string[]; pid?: number } = {}): SpawnFn {
  const real = defaultSpawn({ ...process.env, FAKE_LLAMA: modes }, ['FAKE_LLAMA']);
  return (_command, args) => {
    seen.args = args;
    const handle = real(process.execPath, [SCRIPT, ...args], process.cwd());
    seen.pid = handle.pid;
    return handle;
  };
}

const engineWith = (
  modes = '',
  over: Partial<ConstructorParameters<typeof ServerEngine>[1]> = {},
) =>
  new ServerEngine(FILES, {
    locateRuntime: () => Promise.resolve('/runtime/llama-server'),
    totalMemory: () => 32e9,
    spawn: standIn(modes),
    readyTimeoutMs: 15_000,
    settings: { threads: 3, contextTokens: 4096 },
    ...over,
  });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('the engine around llama-server', () => {
  it('starts the program, waits until it is ready, and runs a text task through the pipeline', async () => {
    const seen: { args?: string[]; pid?: number } = {};
    const engine = engineWith('slow-load', { spawn: standIn('slow-load', seen) });
    const started = Date.now();
    await engine.load(never);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500); // it did wait for /health

    const events: EngineEvent[] = [];
    const result = await engine.run(TRANSLATE, (e) => events.push(e), never);
    const text = events
      .filter((e) => e.kind === 'text')
      .map((e) => (e.kind === 'text' ? e.text : ''))
      .join('');
    expect(text).toContain('ok');
    expect(result.warnings).toBeDefined();
    await engine.dispose();
    expect(alive(seen.pid!)).toBe(false);
  });

  it('listens on this computer only, behind a key made for the run, with no web page and no network', async () => {
    const seen: { args?: string[]; pid?: number } = {};
    const engine = engineWith('', { spawn: standIn('', seen) });
    await engine.load(never);
    const args = seen.args!;
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(at('--host')).toBe('127.0.0.1');
    expect(args).toContain('--no-webui');
    expect(args).toContain('--offline');
    expect(at('--api-key')).toMatch(/^[0-9a-f]{48}$/);
    expect(at('-m')).toBe(FILES.weights);
    expect(at('--mmproj')).toBe(FILES.projector);
    expect(at('-c')).toBe('4096');
    expect(at('-t')).toBe('3');
    expect(at('-ngl')).toBe('0');
    expect(args).not.toContain('-hf');
    expect(args.join(' ')).not.toMatch(/https?:/);

    const port = at('--port');
    const refused = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST' });
    expect(refused.status).toBe(401);
    await engine.dispose();
  });

  it('reads a page from a picture into a structured page on that page', async () => {
    const engine = engineWith();
    await engine.load(never);
    const events: EngineEvent[] = [];
    await engine.run(PAGE, (e) => events.push(e), never);
    const last = events.filter((e) => e.kind === 'text').at(-1);
    const page = JSON.parse(last && last.kind === 'text' ? last.text : '{}');
    expect(page).toMatchObject({ page: 2, status: 'ok', reason: null });
    expect(page.blocks[0]).toMatchObject({ type: 'paragraph', page: 2, language: 'en', box: null });
    await engine.dispose();
  });

  it('stops reading a page when cancelled', async () => {
    const engine = engineWith('slow-stream');
    await engine.load(never);
    const abort = new AbortController();
    const run = engine.run(PAGE, (e) => e.kind === 'text' && abort.abort(), abort.signal);
    await expect(run).rejects.toMatchObject({ problem: 'cancelled' });
    await engine.dispose();
  });

  it('proofreads under a grammar and keeps only issues that stand in the text', async () => {
    const engine = engineWith();
    await engine.load(never);
    const events: EngineEvent[] = [];
    await engine.run(
      { kind: 'proofread', text: 'Teh board met.', source: '', into: 'en-GB' },
      (e) => events.push(e),
      never,
    );
    const last = events.filter((e) => e.kind === 'text').at(-1);
    const answer = JSON.parse(last && last.kind === 'text' ? last.text : '{}');
    expect(answer.issues).toEqual([
      { id: 1, kind: 'spelling', span: 'Teh', start: 0, end: 3, fix: 'The' },
    ]);
    await engine.dispose();
  });

  it('asks for a grammar-constrained answer when choosing passages', async () => {
    const engine = engineWith();
    await engine.load(never);
    const events: EngineEvent[] = [];
    await engine.run(
      { kind: 'select', passages: ['One.', 'Two.'], language: 'en-GB' },
      (e) => events.push(e),
      never,
    );
    expect(events).toContainEqual({ kind: 'selected', numbers: [1] });
    await engine.dispose();
  });

  it('stops at the next token when cancelled, and the request is closed', async () => {
    const engine = engineWith('slow-stream');
    await engine.load(never);
    const abort = new AbortController();
    const run = engine.run(
      { kind: 'summarise', text: 'one two three four five six', into: 'en-GB', shape: 'document' },
      (e) => e.kind === 'text' && abort.abort(),
      abort.signal,
    );
    await expect(run).rejects.toMatchObject({ problem: 'cancelled' });
    await engine.dispose();
  });

  it('refuses a picture that is not a picture, and a second task while one runs', async () => {
    const engine = engineWith('slow-stream');
    await engine.load(never);
    await expect(
      engine.run({ ...PAGE, png: new Uint8Array(4) }, () => undefined, never),
    ).rejects.toMatchObject({ problem: 'failed' });
    const first = engine.run(TRANSLATE, () => undefined, never);
    await expect(engine.run(TRANSLATE, () => undefined, never)).rejects.toMatchObject({
      problem: 'busy',
    });
    await first;
    await engine.dispose();
  });

  it('ends the process on dispose, waits for it, and is safe twice', async () => {
    const seen: { args?: string[]; pid?: number } = {};
    const engine = engineWith('', { spawn: standIn('', seen) });
    await engine.load(never);
    expect(alive(seen.pid!)).toBe(true);
    await engine.dispose();
    expect(alive(seen.pid!)).toBe(false);
    await engine.dispose();
    await expect(engine.run(TRANSLATE, () => undefined, never)).rejects.toMatchObject({
      problem: 'not-installed',
    });
  });

  it('fails the task, as cannot-start, when the process dies under it', async () => {
    const engine = engineWith('die-mid-stream');
    await engine.load(never);
    const run = engine.run(TRANSLATE, () => undefined, never);
    await expect(run).rejects.toBeInstanceOf(AiError);
    await expect(run).rejects.toMatchObject({ problem: 'cannot-start' });
    await engine.dispose();
  });
});

describe('a computer that cannot run the model', () => {
  it('under 12 GB of memory in all: too-little-memory, and nothing is started', async () => {
    let started = false;
    const engine = engineWith('', {
      totalMemory: () => 8e9,
      spawn: () => {
        started = true;
        throw new Error('must not start');
      },
    });
    await expect(engine.load(never)).rejects.toMatchObject({ problem: 'too-little-memory' });
    expect(started).toBe(false);
    expect(MIN_TOTAL_MEMORY_BYTES).toBeLessThan(12 * 1024 ** 3);
    expect(MIN_TOTAL_MEMORY_BYTES).toBeGreaterThan(11e9);
  });

  it('no program on the computer: cannot-start', async () => {
    const engine = engineWith('', {
      locateRuntime: () => Promise.reject(new AiError('cannot-start', 'llama-server is not here')),
    });
    await expect(engine.load(never)).rejects.toMatchObject({ problem: 'cannot-start' });
  });

  it('a processor without AVX2: cannot-start, and the process is ended', async () => {
    const seen: { args?: string[]; pid?: number } = {};
    const engine = engineWith('no-avx2', { spawn: standIn('no-avx2', seen) });
    const error = await engine.load(never).catch((e: unknown) => e as AiError);
    expect(error).toMatchObject({ problem: 'cannot-start' });
    expect((error as AiError).message).toContain('cannot run the on-device model');
    expect(alive(seen.pid!)).toBe(false);
  });

  it("a crash while loading: cannot-start with the program's last words", async () => {
    const error = await engineWith('crash-on-start')
      .load(never)
      .catch((e: unknown) => e as AiError);
    expect(error).toMatchObject({ problem: 'cannot-start' });
    expect((error as AiError).message).toContain('could not load the model');
  });

  it('running out of memory while loading: too-little-memory', async () => {
    await expect(engineWith('oom').load(never)).rejects.toMatchObject({
      problem: 'too-little-memory',
    });
  });

  it('a load that is aborted ends the process and says cancelled', async () => {
    const seen: { args?: string[]; pid?: number } = {};
    const engine = engineWith('slow-load', { spawn: standIn('slow-load', seen) });
    const abort = new AbortController();
    const loading = engine.load(abort.signal);
    setTimeout(() => abort.abort(), 200);
    await expect(loading).rejects.toMatchObject({ problem: 'cancelled' });
    expect(alive(seen.pid!)).toBe(false);
  });

  it('a program that never becomes ready: cannot-start after the timeout', async () => {
    const engine = engineWith('slow-load', { readyTimeoutMs: 100 });
    await expect(engine.load(never)).rejects.toMatchObject({ problem: 'cannot-start' });
  });
});

describe('the settings of the process', () => {
  it('threads are physical cores minus one, between 2 and 8', () => {
    expect(chooseThreads(28, 'win32')).toBe(8);
    expect(chooseThreads(8, 'win32')).toBe(3);
    expect(chooseThreads(4, 'win32')).toBe(2);
    expect(chooseThreads(2, 'win32')).toBe(2);
    expect(chooseThreads(8, 'darwin')).toBe(7);
  });

  it('knows the processor line of llama-server', () => {
    const line = (avx2: number) =>
      `system_info: CPU : SSE3 = 1 | AVX = 1 | AVX2 = ${avx2} | F16C = 1 |`;
    expect(lacksAvx2(line(0), 'x64')).toBe(true);
    expect(lacksAvx2(line(1), 'x64')).toBe(false);
    expect(lacksAvx2(line(0), 'arm64')).toBe(false);
    expect(lacksAvx2('slot update_slots: id 0', 'x64')).toBe(false);
  });

  it('gives no projector flags to a model without one', () => {
    const args = serverArgs(
      { weights: 'w' },
      { contextTokens: 1, threads: 2, imageMaxTokens: 3 },
      9,
      'k',
    );
    expect(args).not.toContain('--mmproj');
  });

  it('keeps every layer on the processor unless graphics-card layers are asked for', () => {
    const args = (gpuLayers?: number) =>
      serverArgs(
        { weights: 'w' },
        { contextTokens: 1, threads: 2, imageMaxTokens: 3, ...(gpuLayers ? { gpuLayers } : {}) },
        9,
        'k',
      );
    expect(args()[args().indexOf('-ngl') + 1]).toBe('0');
    expect(args(99)[args(99).indexOf('-ngl') + 1]).toBe('99');
  });

  it('counts tokens high, never low, so a cut text fits', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('1234567890')).toBeGreaterThanOrEqual(10);
    expect(
      estimateTokens('The garden club meets on the first Tuesday of every month.'),
    ).toBeGreaterThanOrEqual(12);
    expect(estimateTokens('日本語のテキスト')).toBeGreaterThanOrEqual(8);
  });
});

describe('the choice of projector', () => {
  const both = { weights: 'w', projector: 'full', 'projector-lite': 'lite' };
  it('prefers the lighter one, takes f16 only when asked', () => {
    expect(pickProjector(both, 'auto')).toBe('lite');
    expect(pickProjector(both, 'lite')).toBe('lite');
    expect(pickProjector(both, 'full')).toBe('full');
  });
  it('uses whichever exists when only one does', () => {
    expect(pickProjector({ weights: 'w', projector: 'full' }, 'lite')).toBe('full');
    expect(pickProjector({ weights: 'w', 'projector-lite': 'lite' }, 'full')).toBe('lite');
    expect(pickProjector({ weights: 'w' }, 'auto')).toBeUndefined();
  });
});

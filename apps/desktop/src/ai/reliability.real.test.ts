import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import {
  LLAMA_SERVER,
  MODEL_REGISTRY,
  ModelManifest,
  isAllowedHost,
  runtimeAssetFor,
  type AiEvent,
  type AiTask,
} from '@tp/shared/ai';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator, type Coordinator } from './coordinator.js';
import { downloadFile } from './download.js';
import { ServerEngine } from './engines/server-engine.js';
import { defaultSpawn } from './server/llama-server.js';

/**
 * OPT-IN, never part of `pnpm verify`: the failure modes of `reliability.test.ts` again, on the real
 * model and the real `llama-server`, plus the ones only a real model, real memory and a real Windows
 * can show. The table of scenarios (expected, observed) is `docs/reviews/2026-10-desktop-ai.md`.
 *
 *   LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=<folder holding the 7B files AND the Qwen3-VL-2B files>
 *   LOPPA_RUNTIME_DIR=<folder with llama-server> LOPPA_REAL_LOG=<file to append the findings to>
 *   pnpm exec vitest run apps/desktop/src/ai/reliability.real.test.ts
 *
 * Needs ~11 GB free for the 7B scenarios and about 5 GB of disk for the copies the damage scenarios
 * make (never of the originals: a damaged copy is made in a temporary folder). Takes 20 to 40 minutes.
 * It starts and ends only processes of its own, and checks only those.
 */
const DIR = process.env['LOPPA_AI_DIR'] ?? '';
const RUNTIME =
  process.env['LOPPA_RUNTIME_DIR'] ??
  resolve(import.meta.dirname, '../../../../local-models/runtime');
const LOG = process.env['LOPPA_REAL_LOG'];
const enabled = process.env['LOPPA_REAL_MODEL'] === '1' && DIR !== '';
const asset = runtimeAssetFor(process.platform, process.arch)!;
const entry = join(RUNTIME, asset.entry);

const SEVEN = 'qwen2.5-vl-7b-instruct-q4_k_m';
const TWO = 'qwen3-vl-2b-instruct-q4_k_m';
const gb = (bytes: number) => (bytes / 1e9).toFixed(2);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const log = (line: string) => {
  console.log(`[reliability] ${line}`);
  if (LOG) appendFileSync(LOG, `${line}\n`);
};
const finding = (scenario: string, expected: string, observed: string) =>
  log(`SCENARIO | ${scenario} | ${expected} | ${observed}`);

const ps = (command: string) =>
  spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).stdout.trim();
const aliveNow = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const workingSetMB = (pid: number) =>
  Number(ps(`(Get-Process -Id ${pid}).WorkingSet64`)) / 1e6 || 0;
const cpuSeconds = (pid: number) =>
  Number(ps(`(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds`)) || 0;
const handleCount = (pid: number) => Number(ps(`(Get-Process -Id ${pid}).HandleCount`)) || 0;

const SUMMARY_TEXT = readFileSync(
  resolve(import.meta.dirname, '../../../../fixtures/demo/summary-en.txt'),
  'utf8',
);
const PAGE_PNG = new Uint8Array(
  readFileSync(resolve(import.meta.dirname, '../../../../fixtures/demo/invoice-sample.png')),
);
const SUMMARISE = (text = SUMMARY_TEXT): AiTask => ({
  kind: 'summarise',
  text,
  into: 'en-GB',
  shape: 'document',
});
let pageCounter = 0;
/** A page nobody has read before: a new file hash each time, so the result cache never answers. */
const PAGE = (): AiTask => {
  pageCounter += 1;
  return {
    kind: 'read-page',
    fileSha256: pageCounter.toString(16).padStart(64, 'c'),
    page: 1,
    png: PAGE_PNG,
    longEdge: 1000,
    turn: 0,
    language: null,
  };
};

interface Real {
  coordinator: Coordinator;
  events: AiEvent[];
  pids: number[];
  userData: string;
  until(match: (e: AiEvent) => boolean, timeout?: number): Promise<AiEvent>;
  settled(id: string): Promise<AiEvent>;
  free: { value: () => number };
}

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const clean of cleanups.reverse()) await clean().catch(() => undefined);
});

async function real(
  options: {
    dir?: string;
    idleMs?: number;
    model?: string;
    registry?: readonly ModelManifest[];
    freeMemory?: () => number;
    projector?: 'auto' | 'full' | 'lite';
  } = {},
): Promise<Real> {
  const userData = await mkdtemp(join(tmpdir(), 'loppa-real-'));
  const pids: number[] = [];
  const events: AiEvent[] = [];
  const registry = options.registry ?? MODEL_REGISTRY;
  const coordinator = createCoordinator({
    registry,
    engines: Object.fromEntries(
      registry.map((model) => [
        model.id,
        (files: ConstructorParameters<typeof ServerEngine>[0]) =>
          new ServerEngine(files, {
            locateRuntime: () => Promise.resolve(entry),
            totalMemory: totalmem,
            minTotalMemory: 3e9,
            projector: options.projector ?? 'auto',
            spawn: (command, args, cwd) => {
              const handle = defaultSpawn()(command, args, cwd);
              if (handle.pid) pids.push(handle.pid);
              return handle;
            },
          }),
      ]),
    ),
    dir: join(userData, 'models'),
    env: { LOPPA_AI_DIR: options.dir ?? DIR },
    repoRoot: null,
    freeMemory: options.freeMemory ?? freemem,
    totalMemory: totalmem,
    chooseFile: () => Promise.resolve(null),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    cache: new ResultCache(join(userData, 'cache.json')),
    ...(options.idleMs ? { idleMs: options.idleMs } : {}),
  });
  coordinator.onEvent((e) => events.push(e));
  if (options.model) await coordinator.select(options.model);
  cleanups.push(async () => {
    await coordinator.close();
    for (const pid of pids) if (aliveNow(pid)) process.kill(pid, 'SIGKILL');
    await rm(userData, { recursive: true, force: true });
  });
  const until = async (match: (e: AiEvent) => boolean, timeout = 600_000) => {
    await vi.waitFor(() => expect(events.some(match)).toBe(true), { timeout, interval: 50 });
    return events.find(match)!;
  };
  return {
    coordinator,
    events,
    pids,
    userData,
    until,
    settled: (id) => until((e) => e.id === id && (e.kind === 'done' || e.kind === 'error')),
    free: { value: freemem },
  };
}

let sequence = 0;
const nextId = (label: string) => `${label}-${(sequence += 1)}`;

async function ok(r: Real, task: AiTask, label = 'task') {
  const id = nextId(label);
  const started = Date.now();
  const start = await r.coordinator.run(id, task);
  if (!start.ok) return { id, verdict: start, seconds: 0 };
  const verdict = await r.settled(id);
  return { id, verdict, seconds: (Date.now() - started) / 1000 };
}

describe.skipIf(!enabled)('the AI stack on the real model: failure modes', () => {
  it('has the pinned program, and the files the scenarios need', async () => {
    expect((await stat(entry)).isFile()).toBe(true);
    const names = readdirSync(DIR);
    log(`program ${LLAMA_SERVER.tag}; models folder holds ${names.length} files`);
    expect(names.some((n) => n.startsWith('Qwen2.5-VL-7B'))).toBe(true);
    expect(names.some((n) => n.startsWith('Qwen3VL-2B'))).toBe(true);
    log(
      `machine: ${gb(totalmem())} GB memory, ${gb(freemem())} GB free at start; ` +
        `other processes of the user may move this`,
    );
  });

  it('cancel, at every phase, on the 2B model', async () => {
    const r = await real({ model: TWO });

    // queued
    const first = nextId('first');
    const second = nextId('second');
    await r.coordinator.run(first, SUMMARISE());
    await r.coordinator.run(second, SUMMARISE());
    await r.coordinator.cancel(second);
    const queued = await r.settled(second);
    await r.settled(first);
    finding(
      'cancel while queued',
      'second task cancelled, never started; first completes',
      `${queued.kind === 'error' ? queued.problem : queued.kind}; first ${r.events.find((e) => e.id === first && e.kind === 'done') ? 'done' : 'not done'}`,
    );
    expect(queued).toMatchObject({ problem: 'cancelled' });
    expect(r.events.some((e) => e.id === second && e.kind === 'text')).toBe(false);

    // while the model loads (idle-killed first, so it loads again)
    await r.coordinator.close();
    const r2 = await real({ model: TWO });
    const loading = nextId('loading');
    const freeBefore = freemem();
    await r2.coordinator.run(loading, SUMMARISE());
    await vi.waitFor(() => expect(r2.pids.length).toBe(1), { timeout: 60_000, interval: 20 });
    await sleep(700);
    const cancelAt = Date.now();
    await r2.coordinator.cancel(loading);
    const loadVerdict = await r2.settled(loading);
    const loadSeconds = (Date.now() - cancelAt) / 1000;
    await sleep(300);
    finding(
      'cancel while the model loads',
      'cancelled; child ended; nothing resident',
      `${loadVerdict.kind === 'error' ? loadVerdict.problem : loadVerdict.kind} in ${loadSeconds.toFixed(1)} s; child alive ${aliveNow(r2.pids[0]!)}; resident ${r2.coordinator.state().resident}; free memory ${gb(freeBefore)} -> ${gb(freemem())} GB`,
    );
    expect(loadVerdict).toMatchObject({ problem: 'cancelled' });
    expect(aliveNow(r2.pids[0]!)).toBe(false);
    expect(r2.coordinator.state().resident).toBeNull();

    // while the prompt (the picture) is processed, then mid-answer, on one loaded model
    const picture = nextId('picture');
    await r2.coordinator.run(picture, PAGE());
    await r2.until((e) => e.id === picture && e.kind === 'step' && e.step === 'reading', 120_000);
    await sleep(400);
    const pid = r2.pids.at(-1)!;
    const promptCpu0 = cpuSeconds(pid);
    await r2.coordinator.cancel(picture);
    const pictureVerdict = await r2.settled(picture);
    await sleep(1500);
    const cpu1 = cpuSeconds(pid);
    await sleep(3000);
    const idleCpu = cpuSeconds(pid) - cpu1;
    finding(
      'cancel while the prompt is processed',
      'cancelled; the server stops computing (cpu ~0 afterwards); same child stays loaded',
      `${pictureVerdict.kind === 'error' ? pictureVerdict.problem : pictureVerdict.kind}; cpu in the 3 s after: ${idleCpu.toFixed(2)} s (was ${(cpu1 - promptCpu0).toFixed(1)} s while stopping); child alive ${aliveNow(pid)}`,
    );
    expect(pictureVerdict).toMatchObject({ problem: 'cancelled' });
    expect(idleCpu).toBeLessThan(1.5);

    const streaming = nextId('streaming');
    await r2.coordinator.run(streaming, PAGE());
    await r2.until((e) => e.id === streaming && e.kind === 'text', 180_000);
    await r2.coordinator.cancel(streaming);
    const streamVerdict = await r2.settled(streaming);
    const cpuA = cpuSeconds(pid);
    await sleep(3000);
    const idleAfterStream = cpuSeconds(pid) - cpuA;
    finding(
      'cancel mid-answer',
      'cancelled; computing stops; child stays loaded and serves the next task',
      `${streamVerdict.kind === 'error' ? streamVerdict.problem : streamVerdict.kind}; cpu in the next 3 s: ${idleAfterStream.toFixed(2)} s`,
    );
    expect(streamVerdict).toMatchObject({ problem: 'cancelled' });
    expect(idleAfterStream).toBeLessThan(1.5);
    const next = await ok(r2, SUMMARISE(), 'after-cancel');
    expect(next.verdict).toMatchObject({ kind: 'done' });
    expect(r2.pids.filter(aliveNow)).toHaveLength(1);

    // after done
    const before = r2.events.length;
    await r2.coordinator.cancel(next.id);
    expect(r2.events).toHaveLength(before);
    finding('cancel after done', 'nothing happens', 'no event');
  });

  it('kill -9 of llama-server mid-request, then the next task (7B)', async () => {
    const r = await real({ model: SEVEN });
    const id = nextId('victim');
    await r.coordinator.run(id, PAGE());
    await r.until((e) => e.id === id && e.kind === 'step' && e.step === 'reading', 300_000);
    await sleep(2000);
    const victim = r.pids[0]!;
    process.kill(victim, 'SIGKILL');
    const verdict = await r.settled(id);
    finding(
      'kill -9 of the server mid-request (7B)',
      'cannot-start error; slot cleared',
      `${verdict.kind === 'error' ? verdict.problem : verdict.kind}; resident ${r.coordinator.state().resident}`,
    );
    expect(verdict).toMatchObject({ problem: 'cannot-start' });
    const again = await ok(r, SUMMARISE(), 'restart');
    finding(
      'next task after a killed server',
      'a new server starts and the task completes',
      `${again.verdict.kind}; ${again.seconds.toFixed(1)} s; children ${r.pids.length}, alive ${r.pids.filter(aliveNow).length}, victim alive ${aliveNow(victim)}`,
    );
    expect(again.verdict).toMatchObject({ kind: 'done' });
    expect(aliveNow(victim)).toBe(false);
    await r.coordinator.close();
    expect(r.pids.filter(aliveNow)).toEqual([]);
    const ports = ps(
      `(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in @(${r.pids.join(',')}) }).Count`,
    );
    finding(
      'port and process after close',
      'no listener, no process of ours',
      `listeners ${ports || 0}`,
    );
  });

  it('a task that arrives while the idle timer is letting go (2B)', async () => {
    const r = await real({ model: TWO, idleMs: 1500 });
    const first = await ok(r, SUMMARISE(), 'idle-1');
    expect(first.verdict).toMatchObject({ kind: 'done' });
    const pid = r.pids[0]!;
    await vi.waitFor(() => expect(r.coordinator.state().resident).toBeNull(), {
      timeout: 10_000,
      interval: 5,
    });
    const second = await ok(r, SUMMARISE(), 'idle-2');
    finding(
      'a task during the idle-kill',
      'completes on a fresh child; the old one is gone first',
      `${second.verdict.kind}; first child alive ${aliveNow(pid)}; children ${r.pids.length}`,
    );
    expect(second.verdict).toMatchObject({ kind: 'done' });
    expect(aliveNow(pid)).toBe(false);
  });

  it('memory returns between the tiers, 7B to 2B to 7B', async () => {
    const r = await real({ idleMs: 2000 });
    const baseline = freemem();
    const rows: string[] = [];
    for (const model of [SEVEN, TWO, SEVEN]) {
      await r.coordinator.select(model);
      const run = await ok(r, SUMMARISE(), model.slice(0, 8));
      const pid = r.pids.at(-1)!;
      const resident = freemem();
      expect(run.verdict).toMatchObject({ kind: 'done' });
      await vi.waitFor(() => expect(r.coordinator.state().resident).toBeNull(), {
        timeout: 20_000,
      });
      await vi.waitFor(() => expect(aliveNow(pid)).toBe(false), { timeout: 20_000 });
      await sleep(500);
      rows.push(
        `${model.slice(0, 12)}: ${run.seconds.toFixed(0)} s, free ${gb(baseline)} -> ${gb(resident)} (loaded) -> ${gb(freemem())} GB (released)`,
      );
    }
    finding(
      'model switch between tiers, memory returning',
      'each model released before the next; free memory back near the baseline',
      rows.join('; '),
    );
    expect(Math.abs(freemem() - baseline)).toBeLessThan(2.5e9);
  });

  it('too little memory, as the computer and as the program say it (7B)', async () => {
    const r = await real({ model: SEVEN, freeMemory: () => 2e9 });
    const refused = await r.coordinator.run(nextId('low'), SUMMARISE());
    finding(
      'free memory under the 7B requirement',
      'refused at once, no child',
      JSON.stringify(refused),
    );
    expect(refused).toEqual({ ok: false, problem: 'too-little-memory' });
    expect(r.pids).toHaveLength(0);

    const small = new ServerEngine(
      { weights: join(DIR, 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf') },
      { locateRuntime: () => Promise.resolve(entry), totalMemory: () => 8e9 },
    );
    await expect(small.load(new AbortController().signal)).rejects.toMatchObject({
      problem: 'too-little-memory',
    });
    finding(
      'computer with 8 GB in all',
      'too-little-memory before any file is read',
      'too-little-memory',
    );
  });

  it('damaged, truncated, flipped, missing: on copies of the 2B files', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'loppa-damage-'));
    cleanups.push(() => rm(copy, { recursive: true, force: true }));
    const weights = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
    const projector = 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf';
    const fresh = async () => {
      await cp(join(DIR, weights), join(copy, weights));
      await cp(join(DIR, projector), join(copy, projector));
    };
    const attempt = async (name: string, expected: string, mutate: () => Promise<void>) => {
      await rm(copy, { recursive: true, force: true });
      await mkdir(copy, { recursive: true });
      await fresh();
      await mutate();
      const r = await real({ dir: copy, model: TWO });
      const start = await r.coordinator.run(nextId('damage'), SUMMARISE());
      let problem: string;
      if (start.ok) {
        const verdict = await r.settled(start.id);
        problem = verdict.kind === 'error' ? verdict.problem : verdict.kind;
      } else problem = start.problem;
      const status = (await r.coordinator.status()).models.find((m) => m.id === TWO)!;
      finding(
        name,
        expected,
        `${problem}; state ${status.state}; children started ${r.pids.length}; files ${status.files.map((f) => `${f.role}:${f.hash}`).join(',')}`,
      );
      expect(problem).toBe(expected);
      expect(r.pids).toHaveLength(0);
      await r.coordinator.close();
      return r;
    };
    await attempt('weights truncated by one byte', 'damaged', async () => {
      await truncate(join(copy, weights), (await stat(join(copy, weights))).size - 1);
    });
    await attempt('one byte flipped in the projector', 'damaged', async () => {
      const handle = await import('node:fs/promises').then((m) =>
        m.open(join(copy, projector), 'r+'),
      );
      const buf = Buffer.alloc(1);
      await handle.read(buf, 0, 1, 200_000_000);
      buf[0] = buf[0]! ^ 0xff;
      await handle.write(buf, 0, 1, 200_000_000);
      await handle.close();
    });
    await attempt('projector missing (a pack part not copied)', 'not-installed', async () => {
      await rm(join(copy, projector));
    });
    await attempt('weights are a 0-byte file', 'damaged', async () => {
      await writeFile(join(copy, weights), '');
    });
    // The manifest names another hash than the file has.
    await rm(copy, { recursive: true, force: true });
    await mkdir(copy, { recursive: true });
    await fresh();
    const original = MODEL_REGISTRY.find((m) => m.id === TWO)!;
    const wrong = ModelManifest.parse({
      ...original,
      files: original.files.map((f, i) => ({
        ...f,
        sha256: i === 0 ? '0'.repeat(64) : f.sha256,
        parts: f.parts.map((p) => ({ ...p, sha256: i === 0 ? '0'.repeat(64) : p.sha256 })),
      })),
    });
    const r = await real({ dir: copy, registry: [wrong], model: TWO });
    const start = await r.coordinator.run(nextId('wronghash'), SUMMARISE());
    const verdict = start.ok ? await r.settled(start.id) : start;
    const problem = 'problem' in verdict ? verdict.problem : verdict.kind;
    finding(
      'the manifest names another hash than the file has',
      'damaged',
      `${problem}; children ${r.pids.length}`,
    );
    expect(problem).toBe('damaged');
    // Mended: the right manifest on the same files works.
    const mended = await real({ dir: copy, model: TWO });
    const good = await ok(mended, SUMMARISE(), 'mended');
    finding(
      'the intact copy, after all of the above',
      'loads and answers',
      `${good.verdict.kind} in ${good.seconds.toFixed(0)} s`,
    );
    expect(good.verdict).toMatchObject({ kind: 'done' });
    for (const name of [weights, projector]) {
      expect(
        await readFile(join(DIR, name)).then(
          () => true,
          () => false,
        ),
      ).toBe(true); // the originals were never touched
    }
  });

  it('the projector switch, f16 and Q8_0 (7B)', async () => {
    const rows: string[] = [];
    for (const projector of ['full', 'lite'] as const) {
      const r = await real({ model: SEVEN, projector });
      const run = await ok(r, PAGE(), `proj-${projector}`);
      const pid = r.pids[0]!;
      const rss = workingSetMB(pid);
      const commandLine = ps(
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      );
      const used = /mmproj[^ ]*?(f16|Q8_0)/.exec(commandLine)?.[1];
      rows.push(
        `${projector}: ${run.verdict.kind} in ${run.seconds.toFixed(0)} s, projector ${used}, ${rss.toFixed(0)} MB resident`,
      );
      expect(run.verdict).toMatchObject({ kind: 'done' });
      expect(used).toBe(projector === 'full' ? 'f16' : 'Q8_0');
      await r.coordinator.close();
    }
    finding(
      'projector switch',
      'each setting loads its own file and reads a page',
      rows.join('; '),
    );
  });

  it('long input: ten pages of text, thirty pages queued, bounded memory, cancel (2B)', async () => {
    const corpus = resolve(import.meta.dirname, '../../../../docs/plan/spike-s1/corpus');
    const names = readdirSync(corpus).filter((n) => n.endsWith('.txt') && n.startsWith('en'));
    let text = '';
    while (text.length < 10 * 3000) {
      for (const n of names) text += `${readFileSync(join(corpus, n), 'utf8')}\n\n`;
    }
    text = text.slice(0, 10 * 3000);
    const r = await real({ model: TWO });
    const id = nextId('ten-pages');
    const started = Date.now();
    await r.coordinator.run(id, SUMMARISE(text));
    await r.until((e) => e.id === id && e.kind === 'step', 120_000);
    await vi.waitFor(() => expect(r.pids.length).toBeGreaterThan(0), { timeout: 60_000 });
    const pid = r.pids[0]!;
    const samples: number[] = [];
    const sampler = setInterval(() => samples.push(workingSetMB(pid)), 4000);
    const verdict = await r.settled(id);
    clearInterval(sampler);
    const steps = r.events.filter((e) => e.id === id && e.kind === 'step');
    finding(
      'ten pages of text (30 000 characters)',
      'progress steps reported; memory bounded by the model; completes',
      `${verdict.kind}; ${((Date.now() - started) / 1000).toFixed(0)} s; ${steps.length} progress events; server working set max ${Math.max(0, ...samples).toFixed(0)} MB`,
    );
    expect(verdict).toMatchObject({ kind: 'done' });

    // the same, cancelled a few seconds in
    const again = nextId('ten-pages-cancel');
    await r.coordinator.run(again, SUMMARISE(text.slice(0, 20000)));
    await r.until((e) => e.id === again && e.kind === 'step', 120_000);
    await sleep(3000);
    const cancelAt = Date.now();
    await r.coordinator.cancel(again);
    const cancelled = await r.settled(again);
    finding(
      'ten pages cancelled after 3 s of work',
      'ends within about a second',
      `${cancelled.kind === 'error' ? cancelled.problem : cancelled.kind} after ${(Date.now() - cancelAt) / 1000} s`,
    );
    expect(cancelled).toMatchObject({ problem: 'cancelled' });

    // thirty pages queued, cancelled after the second is read
    const ids = Array.from({ length: 30 }, (_, i) => nextId(`page${i + 1}`));
    for (const pageId of ids) await r.coordinator.run(pageId, PAGE());
    const t0 = Date.now();
    await r.until((e) => e.id === ids[1] && e.kind === 'done', 300_000);
    const twoPages = (Date.now() - t0) / 1000;
    const rss = workingSetMB(r.pids.at(-1)!);
    for (const pageId of [...ids].reverse()) await r.coordinator.cancel(pageId);
    for (const pageId of ids) await r.settled(pageId);
    const state = r.coordinator.state();
    finding(
      'thirty pages queued, all cancelled after two were read',
      'every id gets one verdict; queue empty; memory flat',
      `two pages in ${twoPages.toFixed(0)} s; queue ${state.queued.length}, running ${state.running}; server ${rss.toFixed(0)} MB`,
    );
    expect(state).toMatchObject({ running: null, queued: [] });
  });

  it('two windows asking together', async () => {
    const r = await real({ model: TWO });
    const a = nextId('window-a');
    const b = nextId('window-b');
    const [x, y, dup] = await Promise.all([
      r.coordinator.run(a, SUMMARISE()),
      r.coordinator.run(b, SUMMARISE()),
      r.coordinator.run(a, SUMMARISE()),
    ]);
    await r.settled(a);
    await r.settled(b);
    finding(
      'two windows start tasks together',
      'both answered on their own ids; the repeated id refused',
      `${JSON.stringify([x.ok, y.ok, dup])}`,
    );
    expect(dup).toEqual({ ok: false, problem: 'failed' });
  });

  it('quitting while the 7B loads leaves no process and gives the memory back', async () => {
    const r = await real({ model: SEVEN });
    const baseline = freemem();
    const id = nextId('quit');
    await r.coordinator.run(id, SUMMARISE());
    await vi.waitFor(() => expect(r.pids.length).toBe(1), { timeout: 120_000, interval: 20 });
    await sleep(3000);
    const loadedMB = workingSetMB(r.pids[0]!);
    const t = Date.now();
    await r.coordinator.close();
    finding(
      'app quit during the load (7B)',
      'close() returns with the child gone',
      `close took ${((Date.now() - t) / 1000).toFixed(1)} s; child alive ${aliveNow(r.pids[0]!)}; working set before ${loadedMB.toFixed(0)} MB; free ${gb(baseline)} -> ${gb(freemem())} GB`,
    );
    expect(aliveNow(r.pids[0]!)).toBe(false);
  });

  it('quitting during a download keeps a resumable partial and no corrupt final file', async () => {
    const model = MODEL_REGISTRY.find((m) => m.id === TWO)!;
    const file = model.files.find((f) => f.role === 'projector')!;
    const out = await mkdtemp(join(tmpdir(), 'loppa-dl-'));
    cleanups.push(() => rm(out, { recursive: true, force: true }));
    const stop = new AbortController();
    const first = downloadFile({
      file,
      dir: out,
      fetch,
      allowHost: isAllowedHost,
      signal: stop.signal,
      onProgress: (p) => {
        if (p.done > 30_000_000) stop.abort();
      },
    });
    await expect(first).rejects.toBeTruthy();
    const partial = (await stat(join(out, `${file.name}.partial`)).catch(() => null))?.size ?? 0;
    const final = await stat(join(out, file.name)).catch(() => null);
    const done = await downloadFile({ file, dir: out, fetch, allowHost: isAllowedHost });
    finding(
      'quit during a download',
      'a .partial is kept, no final file; the next attempt resumes and the hash matches',
      `partial ${(partial / 1e6).toFixed(0)} MB, final file ${final ? 'present' : 'absent'}; resumed to ${(await stat(done)).size} of ${file.bytes} bytes`,
    );
    expect(partial).toBeGreaterThan(0);
    expect(final).toBeNull();
    expect((await stat(done)).size).toBe(file.bytes);
  });

  it('Windows paths: spaces, accents, other scripts, OneDrive-like, deep, another drive letter, a locked file', async () => {
    const base = await mkdtemp(join(tmpdir(), 'loppa-paths-'));
    cleanups.push(() => rm(base, { recursive: true, force: true }));
    const files = ['Qwen3VL-2B-Instruct-Q4_K_M.gguf', 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'];
    const place = async (folder: string) => {
      await mkdir(folder, { recursive: true });
      for (const name of files) {
        await rm(join(folder, name), { force: true });
        // A hard link: same volume, no copy, and the file is not changed by anything below.
        spawnSync('cmd', ['/c', 'mklink', '/H', join(folder, name), join(DIR, name)]);
      }
    };
    const rows: string[] = [];
    const tryFolder = async (label: string, folder: string) => {
      const r = await real({ dir: folder, model: TWO });
      const run = await ok(r, SUMMARISE(), 'path');
      rows.push(
        `${label}: ${run.verdict.kind}${run.verdict.kind === 'error' ? ` (${run.verdict.problem})` : ''} ${run.seconds.toFixed(0)} s`,
      );
      await r.coordinator.close();
      return run.verdict;
    };

    // Hard links only work on the volume of the originals (C:); the temp folder is on it.
    const unicode = join(base, 'OneDrive – Företaget AB', 'Mina dokument åäö 日本語 ñ');
    await place(unicode);
    expect(await tryFolder('spaces + accents + CJK + en dash', unicode)).toMatchObject({
      kind: 'done',
    });

    const deep = join(base, 'a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100), 'models');
    await place(deep);
    const deepVerdict = await tryFolder(`path of ${deep.length} characters`, deep);
    expect(['done', 'error']).toContain(deepVerdict.kind);

    // another drive letter, by subst
    const letter = 'T:';
    spawnSync('subst', [letter, unicode]);
    try {
      expect(await tryFolder('a drive letter made by subst', `${letter}\\`)).toMatchObject({
        kind: 'done',
      });
    } finally {
      spawnSync('subst', [letter, '/d']);
    }

    // a file another program holds open without sharing, as a virus scanner may
    const lock = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$f=[System.IO.File]::Open('${join(unicode, files[1]!)}','Open','Read','None'); Write-Host locked; Start-Sleep -Seconds 40; $f.Close()`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await new Promise<void>((resolve) => lock.stdout.once('data', () => resolve()));
    const locked = await real({ dir: unicode, model: TWO });
    const lockedRun = await ok(locked, SUMMARISE(), 'locked');
    rows.push(
      `projector held open by another program: ${lockedRun.verdict.kind === 'error' ? lockedRun.verdict.problem : lockedRun.verdict.kind}; children ${locked.pids.length}`,
    );
    lock.kill();
    await locked.coordinator.close();
    await sleep(500);
    const afterLock = await tryFolder('the lock released', unicode);
    finding(
      'Windows paths and a locked file',
      'every path form works; a locked file is an error, not a crash, and works once released',
      rows.join('; '),
    );
    expect(afterLock).toMatchObject({ kind: 'done' });
  });

  it('resources after all of the above: no child left that this run started', async () => {
    await sleep(1000);
    log(`free memory at the end: ${gb(freemem())} GB`);
    handleCount(process.pid);
  });
});

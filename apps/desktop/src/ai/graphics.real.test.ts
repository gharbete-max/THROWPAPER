import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LLAMA_SERVER,
  StructuredPage,
  TEXT_MODEL,
  pageText,
  runtimeAssetFor,
  type GraphicsFailure,
} from '@tp/shared/ai';
import type { EngineEvent } from './engine.js';
import { ServerEngine, type GpuHook } from './engines/server-engine.js';
import { listDevices } from './server/gpu.js';
import { defaultSpawn } from './server/llama-server.js';
import { EXPECTED, squash } from './test-support/pages.js';

/**
 * OPT-IN, never part of `pnpm verify`: the optional graphics card on the real model
 * (docs/plan/VISION-TUNING.md §5). The five-page suite is read with the setting off (the processor
 * build), with it on (the Vulkan build, the layers fitted by the program), and then with the card
 * made to fail in two ways, which must end on the processor with the failure remembered.
 *
 *   LOPPA_REAL_MODEL=1 LOPPA_AI_DIR=<folder with the two gguf files> LOPPA_PAGES_DIR=<folder with
 *   invoice.png table.png form.png text.png photo.jpg> LOPPA_RUNTIME_DIR=<processor build>
 *   LOPPA_VULKAN_DIR=<graphics build> pnpm exec vitest run apps/desktop/src/ai/graphics.real.test.ts
 *
 * Prints, per run: seconds, strings found of the known ones, the card's memory peak when
 * `nvidia-smi` is there, and what the model ended up running on. Asserts only what Loppa promises:
 * a page comes back, and a failed card never fails the task.
 */
const DIR = process.env['LOPPA_AI_DIR'] ?? '';
const PAGES = process.env['LOPPA_PAGES_DIR'] ?? '';
const CPU =
  process.env['LOPPA_RUNTIME_DIR'] ??
  resolve(import.meta.dirname, '../../../../local-models/runtime');
const VULKAN = process.env['LOPPA_VULKAN_DIR'] ?? '';
const enabled =
  process.env['LOPPA_REAL_MODEL'] === '1' && DIR !== '' && PAGES !== '' && VULKAN !== '';
const LOG = process.env['LOPPA_REAL_LOG'];
const log = (line: string) => {
  console.log(`[graphics] ${line}`);
  if (LOG) appendFileSync(LOG, `${line}\n`);
};
const file = (role: 'weights' | 'projector') =>
  join(DIR, TEXT_MODEL.files.find((f) => f.role === role)!.name);
const entryOf = (dir: string, variant?: 'vulkan') =>
  join(dir, runtimeAssetFor(process.platform, process.arch, LLAMA_SERVER, variant)!.entry);

/** Used graphics memory in MiB, or null where `nvidia-smi` is not there. */
const used = () =>
  new Promise<number | null>((done) =>
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      (error, out) => done(error ? null : Number(out.split(/\r?\n/)[0])),
    ),
  );

function scenario(entry: string | null, extra: Partial<GpuHook> = {}) {
  const failures: GraphicsFailure[] = [];
  let ranOn = '(nothing)';
  const hook: GpuHook = {
    entry: () => Promise.resolve(entry),
    failed: (reason) => void failures.push(reason),
    ranOn: (on, device) => {
      if (on) ranOn = `${on}${device ? ` (${device})` : ''}`;
    },
    ...extra,
  };
  return { hook, failures, ranOn: () => ranOn };
}

async function readPages(label: string, hook: GpuHook, names: string[]) {
  const engine = new ServerEngine(
    { weights: file('weights'), projector: file('projector') },
    {
      locateRuntime: () => Promise.resolve(entryOf(CPU)),
      totalMemory: totalmem,
      settings: { threads: 8 },
      // Diagnostics only: what the program says about the layers it put on the card.
      spawn: (command, args, cwd) => {
        const handle = defaultSpawn()(command, args, cwd);
        handle.onLog((line) => {
          if (/offloaded|projected to use|will leave|cannot meet/.test(line))
            log(`  server: ${line.replace(/^[\d.]+ /, '')}`);
        });
        return handle;
      },
      gpu: hook,
    },
  );
  const before = await used();
  let peak = before ?? 0;
  const sampler = setInterval(
    () => void used().then((v) => v !== null && (peak = Math.max(peak, v))),
    500,
  );
  const started = Date.now();
  let found = 0;
  let total = 0;
  try {
    await engine.load(new AbortController().signal);
    log(`${label}: loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const name of names) {
      const events: EngineEvent[] = [];
      const t0 = Date.now();
      await engine.run(
        {
          kind: 'read-page',
          fileSha256: 'a'.repeat(64),
          page: 1,
          png: new Uint8Array(readFileSync(join(PAGES, name))),
          longEdge: 1000,
          turn: 0,
          language: null,
        },
        (e) => events.push(e),
        new AbortController().signal,
      );
      const last = events.filter((e) => e.kind === 'text').at(-1);
      const page = StructuredPage.parse(
        JSON.parse(last && last.kind === 'text' ? last.text : '{}'),
      );
      const text = squash(pageText(page));
      const strings = EXPECTED[name]!;
      const hits = strings.filter((s) => text.includes(squash(s))).length;
      found += hits;
      total += strings.length;
      log(
        `${label}: ${name} ${((Date.now() - t0) / 1000).toFixed(1)} s, strings ${hits}/${strings.length}`,
      );
    }
  } finally {
    clearInterval(sampler);
    await engine.dispose();
  }
  const seconds = (Date.now() - started) / 1000;
  const vram = before === null ? 'n/a' : `${peak - before} MiB over a baseline of ${before} MiB`;
  return { seconds, found, total, vram };
}

/** `LOPPA_REAL_SCENARIOS=off,on,forced` (the default) or any of them; `LOPPA_REAL_PAGES=2` reads that many pages. */
const wanted = (process.env['LOPPA_REAL_SCENARIOS'] ?? 'off,on,forced').split(',');
const pages = Object.keys(EXPECTED).slice(0, Number(process.env['LOPPA_REAL_PAGES'] ?? 99));

describe.skipIf(!enabled)('the graphics card setting on the real model', () => {
  it.skipIf(!wanted.includes('off'))(
    'setting off: the processor build',
    async () => {
      const off = scenario(null);
      const run = await readPages('setting off', off.hook, pages);
      log(
        `SETTING OFF: ${run.seconds.toFixed(1)} s, found ${run.found}/${run.total}, ran on ${off.ranOn()}, card memory ${run.vram}`,
      );
      expect(off.ranOn()).toBe('processor');
    },
    3_600_000,
  );

  it.skipIf(!wanted.includes('on'))(
    'setting on: the graphics build, layers fitted by the program',
    async () => {
      const entry = entryOf(VULKAN, 'vulkan');
      log(`devices before: ${JSON.stringify(await listDevices(entry))}`);
      const on = scenario(entry);
      const run = await readPages('setting on', on.hook, pages);
      log(
        `SETTING ON: ${run.seconds.toFixed(1)} s, found ${run.found}/${run.total}, ran on ${on.ranOn()}, card memory ${run.vram}, failures ${on.failures.join(',') || 'none'}`,
      );
      expect(on.ranOn()).toContain('graphics');
      expect(on.failures).toEqual([]);
    },
    3_600_000,
  );

  it.skipIf(!wanted.includes('forced'))(
    'forced failures end on the processor, remembered',
    async () => {
      // 1: the program is not there, so there is no device to list.
      const missing = scenario(join(VULKAN, 'does-not-exist.exe'));
      const c = await readPages('forced: no device', missing.hook, ['invoice.png']);
      log(
        `FORCED no device: ${c.seconds.toFixed(1)} s, found ${c.found}/${c.total}, ran on ${missing.ranOn()}, remembered ${missing.failures.join(',')}`,
      );
      expect(missing.failures).toEqual(['no-device']);
      expect(c.found).toBeGreaterThan(0);

      // 2: a device is listed but the program ends at once (a stand-in for a bad driver).
      const ends =
        process.platform === 'win32'
          ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'whoami.exe')
          : '/bin/false';
      const crash = scenario(ends, {
        devices: () =>
          Promise.resolve([{ id: 'Vulkan0', name: 'Stand-in', totalMiB: 12000, freeMiB: 11000 }]),
      });
      const d = await readPages('forced: program ends', crash.hook, ['invoice.png']);
      log(
        `FORCED program ends: ${d.seconds.toFixed(1)} s, found ${d.found}/${d.total}, ran on ${crash.ranOn()}, remembered ${crash.failures.join(',')}`,
      );
      expect(crash.failures).toEqual(['start-failed']);
      expect(d.found).toBeGreaterThan(0);
    },
    3_600_000,
  );
});

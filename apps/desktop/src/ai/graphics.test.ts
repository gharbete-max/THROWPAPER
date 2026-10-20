import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LLAMA_SERVER,
  RuntimeManifest,
  TEXT_MODEL,
  graphicsConsentFor,
  type AiEvent,
} from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';
import { createGraphics } from './graphics.js';
import type { ResolveContext } from './resolve.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let root = '';
let dir = '';
let manifest: RuntimeManifest;
let context: ResolveContext;

/** A tiny graphics-card build for win32-x64: one program file, so no test needs the 32 MB one. */
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loppa-graphics-'));
  dir = join(root, 'models');
  await mkdir(dir, { recursive: true });
  const base = LLAMA_SERVER.assets.find((a) => a.variant === 'vulkan')!;
  manifest = RuntimeManifest.parse({
    ...LLAMA_SERVER,
    assets: [
      ...LLAMA_SERVER.assets.filter((a) => a.variant !== 'vulkan'),
      { ...base, contents: [{ bytes: 7, name: base.entry, sha256: sha('program') }] },
    ],
  });
  context = { env: {}, repoRoot: null, packDir: null, userDataModels: dir, remembered: {} };
});
afterEach(() => rm(root, { recursive: true, force: true }));

const make = (platform = 'win32', arch = 'x64') =>
  createGraphics({ dir, context: () => context, manifest, platform, arch });

/** The program put in the folder by hand, as someone offline would. */
async function placeByHand(content = 'program') {
  const entry = manifest.assets.find((a) => a.variant === 'vulkan')!.entry;
  await mkdir(join(dir, 'runtime-vulkan'), { recursive: true });
  await writeFile(join(dir, 'runtime-vulkan', entry), content);
  return join(dir, 'runtime-vulkan', entry);
}

describe('the graphics card setting', () => {
  it('is off by default, and offers the download (github.com, the file, its size) when the program is missing', async () => {
    const status = await make().status();
    expect(status).toMatchObject({ support: 'available', enabled: false, present: false });
    const vulkan = manifest.assets.find((a) => a.variant === 'vulkan')!;
    expect(status.consent).toEqual({
      host: 'github.com',
      files: [vulkan.name],
      totalBytes: vulkan.bytes,
    });
    expect(status.folder).toBe(join(dir, 'runtime-vulkan'));
    expect(await make().hook.entry()).toBeNull();
  });

  it('says "later" on macOS and nothing on a computer with no such build', async () => {
    expect((await make('darwin', 'arm64').status()).support).toBe('later');
    expect((await make('linux', 'x64').status()).support).toBe('none');
    const mac = make('darwin', 'arm64');
    await mac.setEnabled(true);
    expect((await mac.status()).enabled).toBe(false);
  });

  it('does not turn on while the program is missing or damaged', async () => {
    const graphics = make();
    await graphics.setEnabled(true);
    expect((await graphics.status()).enabled).toBe(false);
    await placeByHand('tampered');
    await graphics.setEnabled(true);
    expect(await graphics.status()).toMatchObject({ enabled: false, present: false });
    expect(await graphics.hook.entry()).toBeNull();
  });

  it('accepts the program placed by hand (offline), checked against the pinned hashes, and keeps the choice', async () => {
    const entry = await placeByHand();
    const graphics = make();
    await graphics.setEnabled(true);
    expect(await graphics.status()).toMatchObject({ enabled: true, present: true, consent: null });
    expect(await graphics.hook.entry()).toBe(entry);
    // a new session reads what was chosen
    expect(await make().hook.entry()).toBe(entry);
    await graphics.setEnabled(false);
    expect(await graphics.hook.entry()).toBeNull();
  });

  it('remembers a failure so the card is not tried again, until it is cleared', async () => {
    const entry = await placeByHand();
    const graphics = make();
    await graphics.setEnabled(true);
    await graphics.hook.failed('start-failed');
    expect(await graphics.hook.entry()).toBeNull();
    expect(await make().status()).toMatchObject({ enabled: true, failure: 'start-failed' });
    await graphics.clearFailure();
    expect(await graphics.hook.entry()).toBe(entry);
    expect((await graphics.status()).failure).toBeNull();
  });

  it('reports what it runs on', async () => {
    const graphics = make();
    graphics.hook.ranOn('graphics', 'Test GPU');
    expect(await graphics.status()).toMatchObject({ ranOn: 'graphics', device: 'Test GPU' });
    graphics.hook.ranOn(null, null);
    expect(await graphics.status()).toMatchObject({ ranOn: null, device: null });
  });

  it('only a graphics folder of its own counts: the processor program in a root or pack is not it', async () => {
    const entry = manifest.assets.find((a) => a.variant === 'vulkan')!.entry;
    await mkdir(join(root, 'pack'), { recursive: true });
    await writeFile(join(root, 'pack', entry), 'program'); // same name, same bytes
    context.packDir = join(root, 'pack');
    expect((await make().status()).present).toBe(false);
    await mkdir(join(root, 'pack', 'runtime-vulkan'), { recursive: true });
    await writeFile(join(root, 'pack', 'runtime-vulkan', entry), 'program');
    expect((await make().status()).present).toBe(true);
  });

  it('pins its file in the manifest: the real graphics build lists every file with a hash', () => {
    const real = LLAMA_SERVER.assets.find((a) => a.variant === 'vulkan')!;
    expect(real.verified).toBe(true);
    expect(real.contents).toHaveLength(52);
    expect(graphicsConsentFor('win32', 'x64')).toMatchObject({ host: 'github.com' });
    expect(graphicsConsentFor('darwin', 'arm64')).toBeNull();
  });
});

describe('the download: the network only on a confirmed action', () => {
  function coordinator(fetch: typeof globalThis.fetch) {
    const events: AiEvent[] = [];
    const graphics = make();
    const c = createCoordinator({
      engines: {},
      dir,
      env: {},
      repoRoot: null,
      freeMemory: () => 4e9,
      totalMemory: () => 8e9,
      freeDisk: () => Promise.resolve(1e12),
      chooseFile: () => Promise.resolve(null),
      fetch,
      cache: new ResultCache(join(root, 'cache.json')),
      graphics,
    });
    c.onEvent((e) => events.push(e));
    return { c, events, graphics };
  }
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it('turning it on without the program fetches nothing', async () => {
    const fetch = vi.fn();
    const { c } = coordinator(fetch as never);
    const status = await c.useGraphics(true);
    expect(status.graphics).toMatchObject({ enabled: false, present: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a consent that is not exactly what would be fetched, and fetches nothing', async () => {
    const fetch = vi.fn();
    const { c } = coordinator(fetch as never);
    const wanted = graphicsConsentFor('win32', 'x64', manifest)!;
    for (const bad of [
      { ...wanted, host: 'example.com' },
      { ...wanted, totalBytes: 1 },
      { ...wanted, files: ['other.zip'] },
      { ...wanted, files: [] },
    ]) {
      expect(await c.installGraphics(bad)).toEqual({ ok: false, problem: 'consent-required' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('after the confirmation fetches the pinned address only, and records the consent', async () => {
    const asked: string[] = [];
    const fetch = vi.fn((url: string) => {
      asked.push(url);
      return Promise.resolve(new Response('no', { status: 404 }));
    });
    const { c, events } = coordinator(fetch as never);
    const consent = graphicsConsentFor(process.platform, process.arch, manifest);
    if (!consent) return; // this test machine has no pinned build
    expect(await c.installGraphics(consent)).toMatchObject({ ok: true });
    await settle();
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!).hostname).toBe('github.com');
    expect(events.find((e) => e.kind === 'install-failed')).toMatchObject({
      modelId: 'graphics',
      problem: 'download-failed',
    });
    expect(await readFile(join(dir, 'consents.jsonl'), 'utf8')).toContain('"modelId":"graphics"');
    expect((await c.status()).graphics?.enabled).toBe(false);
    expect((await c.status()).activity).toBe('idle');
  });

  it('a redirect to any other host stops the download, and a wrong file is not put in place', async () => {
    const consent = graphicsConsentFor(process.platform, process.arch, manifest);
    if (!consent) return;
    const away = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://github.com')
          ? new Response(null, { status: 302, headers: { location: 'https://evil.example/x.zip' } })
          : new Response('should never be asked', { status: 200 }),
      ),
    );
    const one = coordinator(away as never);
    await one.c.installGraphics(consent);
    await settle();
    expect(away).toHaveBeenCalledTimes(1);
    expect(one.events.find((e) => e.kind === 'install-failed')).toBeDefined();

    const asset = manifest.assets.find((a) => a.variant === 'vulkan')!;
    const wrong = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array(asset.bytes), { status: 200 })),
    );
    const two = coordinator(wrong as never);
    await two.c.installGraphics(consent);
    await settle();
    await vi.waitFor(() => expect(two.events.some((e) => e.kind === 'install-failed')).toBe(true));
    await expect(stat(join(dir, 'runtime-vulkan'))).rejects.toThrow();
    expect((await two.c.status()).graphics?.enabled).toBe(false);
  });

  it('changing the setting lets go of a loaded model, so it restarts the new way', async () => {
    await placeByHand();
    const graphics = make();
    const c = createCoordinator({
      engines: { [TEXT_MODEL.id]: () => new FakeEngine({ behaviour: { delayMs: 0 } }) },
      fake: true,
      dir,
      env: {},
      repoRoot: null,
      freeMemory: () => 64e9,
      totalMemory: () => 64e9,
      freeDisk: () => Promise.resolve(1e12),
      chooseFile: () => Promise.resolve(null),
      fetch: vi.fn() as never,
      cache: new ResultCache(join(root, 'cache.json')),
      graphics,
    });
    const done = new Promise<void>((resolve) =>
      c.onEvent((e) => e.id === 't1' && e.kind === 'done' && resolve()),
    );
    await c.run('t1', { kind: 'translate', text: 'Hej', into: 'en-GB' });
    await done;
    expect(c.state().resident).toBe(TEXT_MODEL.id);
    await c.useGraphics(true);
    expect(c.state().resident).toBeNull();
    await graphics.hook.failed('no-device');
    expect((await c.clearGraphicsFailure()).graphics).toMatchObject({
      failure: null,
      enabled: true,
    });
  });
});

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModelManifest,
  RuntimeManifest,
  type AddonsEvent,
  type AddonsStatus,
  type AiStatus,
} from '@tp/shared/ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeChecker } from '../ai/runtime.js';
import { createAddons } from './addons.js';
import { makeTarGz } from './test-support/archives.js';

/**
 * Add-ons and updates against a fake GitHub on a local port: the real streams, redirects, Range
 * requests and hashes, with `fetch` rewritten so that every https address of the allow-list lands
 * on the fake (the real code still sees `https://api.github.com/...`, and redirects to
 * `release-assets.githubusercontent.com` or to a host that is not on the list).
 */
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

interface Seen {
  host: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
}
type Handler = (req: Seen, res: ServerResponse, request: IncomingMessage) => void;

let server: Server;
let port = 0;
let handler: Handler = (_req, res) => res.writeHead(404).end();
let seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((request, res) => {
    const entry: Seen = {
      host: String(request.headers['x-fake-host'] ?? ''),
      path: request.url ?? '',
      headers: request.headers,
    };
    seen.push(entry);
    handler(entry, res, request);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Every request goes to the fake, with the host it was meant for in a header. */
const routed: typeof fetch = (input, init) => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  headers.set('x-fake-host', url.host);
  if (url.protocol !== 'https:') throw new Error(`the code asked for ${url.protocol}`);
  return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { ...init, headers });
};

/** Serves `body` honouring Range, the way a CDN does. */
function serveBytes(body: Buffer, options: { cutAfter?: number; slowMs?: number } = {}): Handler {
  return (req, res) => {
    const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''));
    const from = range ? Number(range[1]) : 0;
    const slice = body.subarray(from);
    res.writeHead(range ? 206 : 200, {
      'content-length': slice.length,
      ...(range ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}),
    });
    if (options.cutAfter !== undefined && from === 0) {
      res.write(slice.subarray(0, options.cutAfter));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (options.slowMs) {
      res.write(slice.subarray(0, 1024));
      setTimeout(() => res.end(slice.subarray(1024)), options.slowMs);
      return;
    }
    res.end(slice);
  };
}

let work: string;
let dir: string;
let downloads: string;
let events: AddonsEvent[];

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'loppa-addons-'));
  dir = join(work, 'models');
  downloads = join(work, 'Downloads');
  await mkdir(dir, { recursive: true });
  events = [];
  seen = [];
  handler = (_req, res) => res.writeHead(404).end();
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

// --- the fixtures ----------------------------------------------------------------------------

const INSTALLER = Buffer.from('pretend this is a 180 MB installer '.repeat(4000));
const INSTALLER_NAME = 'Loppa-Windows-Setup.exe';
const TAG = 'desktop-v9.9.9';
const FILES = `/gharbete-max/THROWPAPER/releases/download/${TAG}`;

const releaseJson = (extra: { sums?: boolean; digest?: string | null } = {}) => [
  { tag_name: 'ai-pack-qwen2.5-vl-7b-instruct-q4_k_m', assets: [] },
  { tag_name: 'desktop-v99.0.0', draft: true, assets: [] },
  {
    tag_name: TAG,
    body: 'What is new\r\n- Add-ons and updates',
    html_url: `https://github.com/gharbete-max/THROWPAPER/releases/tag/${TAG}`,
    assets: [
      {
        name: INSTALLER_NAME,
        size: INSTALLER.length,
        ...(extra.digest === undefined ? {} : { digest: extra.digest }),
      },
      { name: 'Loppa-Windows-Portable.exe', size: 1000 },
      ...(extra.sums === false ? [] : [{ name: 'SHA256SUMS.txt', size: 100 }]),
    ],
  },
  { tag_name: 'desktop-v0.2.0', assets: [] },
];

interface World {
  releases?: unknown;
  sums?: string | null;
  installer?: Handler;
  /** Where the installer's address leads. */
  redirectTo?: string;
}

/** A fake GitHub: the list, the checksum file and the installer behind a CDN redirect. */
function github(world: World = {}): Handler {
  const releases = world.releases ?? releaseJson();
  const sums = world.sums === undefined ? `${sha(INSTALLER)}  ${INSTALLER_NAME}\n` : world.sums;
  return (req, res, request) => {
    if (
      req.host === 'api.github.com' &&
      req.path.startsWith('/repos/gharbete-max/THROWPAPER/releases')
    ) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(releases));
      return;
    }
    if (req.host === 'github.com' && req.path.startsWith(`${FILES}/`)) {
      const name = req.path.slice(FILES.length + 1);
      res.writeHead(302, {
        location: world.redirectTo ?? `https://release-assets.githubusercontent.com/blob/${name}`,
      });
      res.end();
      return;
    }
    if (req.host === 'release-assets.githubusercontent.com' && req.path.startsWith('/blob/')) {
      const name = req.path.slice('/blob/'.length);
      if (name === 'SHA256SUMS.txt') {
        if (sums === null) res.writeHead(404).end();
        else res.writeHead(200).end(sums);
        return;
      }
      (world.installer ?? serveBytes(INSTALLER))(req, res, request);
      return;
    }
    res.writeHead(404).end();
  };
}

interface Build {
  platform?: string;
  arch?: string;
  portable?: boolean;
  version?: string;
  freeDisk?: number | null;
  busy?: boolean;
  packDir?: string;
  manifest?: RuntimeManifest;
  model?: ModelManifest;
  aiModels?: Array<{ id: string; state: string }>;
}

function build(options: Build = {}) {
  const opened: string[] = [];
  const platform = options.platform ?? 'win32';
  const arch = options.arch ?? 'x64';
  const manifest = options.manifest ?? RuntimeManifest.parse(MAC_MANIFEST);
  const runtime = createRuntimeChecker({
    manifest,
    platform,
    arch,
    context: () => ({
      env: {},
      repoRoot: null,
      packDir: options.packDir ?? null,
      userDataModels: dir,
      remembered: {},
    }),
  });
  const addons = createAddons({
    version: options.version ?? '0.2.0',
    platform,
    arch,
    portable: options.portable ?? false,
    dir,
    downloads,
    models: {
      status: async () => ({ models: options.aiModels ?? [] }) as unknown as AiStatus,
      busy: () => options.busy ?? false,
    },
    runtime,
    fetch: routed,
    openPath: async (path) => {
      opened.push(path);
      return '';
    },
    emit: (event) => events.push(event),
    manifest,
    ...(options.model ? { model: options.model } : {}),
    freeDisk: async () => (options.freeDisk === undefined ? 1e12 : options.freeDisk),
  });
  return { addons, opened };
}

/** Waits for the event that ends a task. */
async function ended(task: string): Promise<AddonsEvent> {
  for (let i = 0; i < 400; i += 1) {
    const found = events.find((e) => e.task === task && (e.kind === 'done' || e.kind === 'failed'));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${task} did not end`);
}

const consentOf = (status: AddonsStatus) => status.update.consent;
const filesIn = async (path: string) => readdir(path).catch(() => [] as string[]);

// --- the update check ------------------------------------------------------------------------

describe('the update check', () => {
  it('asks only api.github.com, sends no credentials, and finds the newest desktop release', async () => {
    handler = github();
    const { addons } = build();
    const result = await addons.checkUpdate(consentOf(await addons.status()));
    expect(result).toMatchObject({
      ok: true,
      current: '0.2.0',
      latest: '9.9.9',
      newer: true,
      page: `https://github.com/gharbete-max/THROWPAPER/releases/tag/${TAG}`,
      installer: {
        name: INSTALLER_NAME,
        bytes: INSTALLER.length,
        consent: { host: 'github.com', files: [INSTALLER_NAME], totalBytes: INSTALLER.length },
      },
    });
    expect(result.ok && result.notes).toBe('What is new\n- Add-ons and updates');
    expect(seen.map((s) => s.host)).toEqual(['api.github.com']);
    for (const request of seen) {
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
    }
  });

  it('says so when this is the newest version, and offers no installer', async () => {
    handler = github();
    const { addons } = build({ version: '9.9.9' });
    const result = await addons.checkUpdate(consentOf(await addons.status()));
    expect(result).toMatchObject({ ok: true, latest: '9.9.9', newer: false, installer: null });
  });

  it('picks the portable program for a portable copy', async () => {
    handler = github({
      releases: [
        {
          tag_name: TAG,
          assets: [
            { name: INSTALLER_NAME, size: 10 },
            { name: 'Loppa-Windows-Portable.exe', size: 20 },
          ],
        },
      ],
    });
    const { addons } = build({ portable: true });
    const result = await addons.checkUpdate(consentOf(await addons.status()));
    expect(result.ok && result.installer?.name).toBe('Loppa-Windows-Portable.exe');
  });

  it('is not an update when no desktop release exists', async () => {
    handler = github({ releases: [{ tag_name: 'ai-pack-x', assets: [] }] });
    const { addons } = build();
    const result = await addons.checkUpdate(consentOf(await addons.status()));
    expect(result).toMatchObject({ ok: true, latest: null, newer: false, installer: null });
  });

  it('does nothing without the exact consent', async () => {
    handler = github();
    const { addons } = build();
    for (const consent of [
      { host: 'evil.example', files: [], totalBytes: 0 },
      { host: 'api.github.com', files: ['x'], totalBytes: 0 },
      { host: 'api.github.com', files: [], totalBytes: 5 },
    ]) {
      expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'consent-required' });
    }
    expect(seen).toEqual([]);
  });

  it('says plainly when GitHub limits the asking, when it is down and when the answer is not a list', async () => {
    const { addons } = build();
    const consent = consentOf(await addons.status());
    handler = (_req, res) => res.writeHead(403).end('{"message":"rate limit exceeded"}');
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'rate-limited' });
    handler = (_req, res) => res.writeHead(500).end();
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'failed' });
    handler = (_req, res) => res.writeHead(200).end('<html>captive portal</html>');
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'failed' });
    handler = (_req, res) => res.writeHead(200).end('{"message":"x"}');
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'failed' });
    handler = (_req, res) => res.destroy();
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'offline' });
  });

  it('refuses a redirect off the allow-list and an answer larger than the cap', async () => {
    const { addons } = build();
    const consent = consentOf(await addons.status());
    handler = (_req, res) => res.writeHead(302, { location: 'https://evil.example/x' }).end();
    expect((await addons.checkUpdate(consent)).ok).toBe(false);
    expect(seen.map((s) => s.host)).toEqual(['api.github.com']);
    handler = (_req, res) => res.writeHead(200).end('[' + ' '.repeat(3 * 1024 * 1024) + ']');
    expect(await addons.checkUpdate(consent)).toEqual({ ok: false, problem: 'failed' });
  });

  it('is busy while a model is working', async () => {
    const { addons } = build({ busy: true });
    expect(await addons.checkUpdate(consentOf(await addons.status()))).toEqual({
      ok: false,
      problem: 'busy',
    });
  });
});

// --- the installer ---------------------------------------------------------------------------

async function checked(options: Build = {}, world: World = {}) {
  handler = github(world);
  const built = build(options);
  const result = await built.addons.checkUpdate(consentOf(await built.addons.status()));
  if (!result.ok || !result.installer) throw new Error('the check found no installer');
  seen = [];
  return { ...built, consent: result.installer.consent };
}

describe('the installer', () => {
  it('is saved in Downloads under a versioned name after the hash agrees, and only then opened', async () => {
    const { addons, consent, opened } = await checked();
    expect(await addons.downloadInstaller(consent)).toEqual({ ok: true });
    expect(await ended('installer')).toMatchObject({ kind: 'done' });
    const name = 'Loppa-Windows-Setup-9.9.9.exe';
    expect(await filesIn(downloads)).toEqual([name]);
    expect(await readFile(join(downloads, name))).toEqual(INSTALLER);
    expect(seen.map((s) => s.host).sort()).toEqual([
      'github.com',
      'github.com',
      'release-assets.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
    for (const request of seen) {
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
    }
    expect(opened).toEqual([]); // nothing runs by itself
    expect((await addons.status()).update.downloaded).toBe(join(downloads, name));
    expect(await addons.openInstaller()).toEqual({ ok: true });
    expect(opened).toEqual([join(downloads, name)]);
    expect(events.some((e) => e.kind === 'progress' && e.task === 'installer')).toBe(true);
  });

  it('needs a check first, and the exact consent', async () => {
    handler = github();
    const fresh = build();
    expect(
      await fresh.addons.downloadInstaller({
        host: 'github.com',
        files: [INSTALLER_NAME],
        totalBytes: 1,
      }),
    ).toEqual({ ok: false, problem: 'unavailable' });
    const { addons, consent } = await checked();
    for (const bad of [
      { ...consent, totalBytes: consent.totalBytes - 1 },
      { ...consent, host: 'release-assets.githubusercontent.com' },
      { ...consent, files: ['Loppa-Windows-Portable.exe'] },
    ]) {
      expect(await addons.downloadInstaller(bad)).toEqual({
        ok: false,
        problem: 'consent-required',
      });
    }
    expect(seen).toEqual([]);
    expect(await filesIn(downloads)).toEqual([]);
  });

  it('deletes a download whose hash is not the one in SHA256SUMS.txt', async () => {
    const { addons, consent } = await checked(
      {},
      { sums: `${sha('something else')}  ${INSTALLER_NAME}\n` },
    );
    await addons.downloadInstaller(consent);
    expect(await ended('installer')).toEqual({
      kind: 'failed',
      task: 'installer',
      problem: 'not-the-listed-file',
    });
    expect(await filesIn(downloads)).toEqual([]);
    expect((await addons.status()).update.downloaded).toBeNull();
    expect(await addons.openInstaller()).toEqual({ ok: false });
  });

  it('deletes a download of the wrong length', async () => {
    const { addons, consent } = await checked(
      {},
      { installer: serveBytes(Buffer.concat([INSTALLER, Buffer.from('extra')])) },
    );
    await addons.downloadInstaller(consent);
    expect(await ended('installer')).toMatchObject({
      kind: 'failed',
      problem: 'not-the-listed-file',
    });
    expect(await filesIn(downloads)).toEqual([]);
  });

  it.each([
    ['the release has no checksum file', { releases: releaseJson({ sums: false }) }],
    ['the checksum file does not list the installer', { sums: `${sha('x')}  other.exe\n` }],
    [
      'GitHub and the checksum file disagree',
      { releases: releaseJson({ digest: `sha256:${sha('other')}` }) },
    ],
    ['the checksum file is missing', { sums: null }],
  ])('refuses when %s', async (_label, world) => {
    const { addons, consent } = await checked({}, world as World);
    await addons.downloadInstaller(consent);
    const end = await ended('installer');
    expect(end.kind).toBe('failed');
    expect(await filesIn(downloads)).toEqual([]);
  });

  it("accepts when GitHub's own digest agrees with the checksum file", async () => {
    const { addons, consent } = await checked(
      {},
      { releases: releaseJson({ digest: `sha256:${sha(INSTALLER)}` }) },
    );
    await addons.downloadInstaller(consent);
    expect(await ended('installer')).toMatchObject({ kind: 'done' });
  });

  it.each([
    ['a host that is not on the list', 'https://evil.example/Loppa-Windows-Setup.exe'],
    [
      'another GitHub user-content host',
      'https://raw.githubusercontent.com/x/y/z/Loppa-Windows-Setup.exe',
    ],
    ['plain http', 'http://release-assets.githubusercontent.com/blob/Loppa-Windows-Setup.exe'],
    ['a look-alike host', 'https://github.com.evil.example/x'],
  ])('refuses a redirect to %s and writes nothing', async (_label, target) => {
    const { addons, consent } = await checked({}, { redirectTo: target });
    await addons.downloadInstaller(consent);
    // The checksum file is fetched first, through the same redirect, so the first hop already fails.
    expect(await ended('installer')).toEqual({
      kind: 'failed',
      task: 'installer',
      problem: 'download-failed',
    });
    expect(await filesIn(downloads)).toEqual([]);
    expect(seen.map((s) => s.host)).not.toContain('evil.example');
  });

  it('resumes where an interrupted download stopped, and the result still passes the hash', async () => {
    const { addons, consent } = await checked(
      {},
      { installer: serveBytes(INSTALLER, { cutAfter: 50_000 }) },
    );
    await addons.downloadInstaller(consent);
    expect(await ended('installer')).toMatchObject({ kind: 'failed', problem: 'download-failed' });
    const partial = (await filesIn(downloads)).find((n) => n.endsWith('.partial'));
    expect(partial).toBeDefined();
    const kept = (await stat(join(downloads, partial!))).size;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(INSTALLER.length);

    events = [];
    seen = [];
    expect(await addons.downloadInstaller(consent)).toEqual({ ok: true });
    expect(await ended('installer')).toMatchObject({ kind: 'done' });
    expect(seen.some((s) => String(s.headers.range ?? '').startsWith(`bytes=${kept}-`))).toBe(true);
    expect(await readFile(join(downloads, 'Loppa-Windows-Setup-9.9.9.exe'))).toEqual(INSTALLER);
    expect(await filesIn(downloads)).toEqual(['Loppa-Windows-Setup-9.9.9.exe']);
  });

  it('can be cancelled, and is busy beside itself', async () => {
    const { addons, consent } = await checked(
      {},
      { installer: serveBytes(INSTALLER, { slowMs: 600 }) },
    );
    expect(await addons.downloadInstaller(consent)).toEqual({ ok: true });
    expect(await addons.downloadInstaller(consent)).toEqual({ ok: false, problem: 'busy' });
    expect(addons.working()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await addons.cancel();
    expect(await ended('installer')).toEqual({
      kind: 'failed',
      task: 'installer',
      problem: 'cancelled',
    });
    expect(addons.working()).toBe(false);
  });

  it('does not start without room on the disk', async () => {
    const { addons, consent } = await checked({ freeDisk: 1000 });
    expect(await addons.downloadInstaller(consent)).toEqual({
      ok: false,
      problem: 'no-disk-space',
    });
    expect(seen).toEqual([]);
  });

  it('does not open a file that changed after it was checked', async () => {
    const { addons, consent, opened } = await checked();
    await addons.downloadInstaller(consent);
    await ended('installer');
    const path = join(downloads, 'Loppa-Windows-Setup-9.9.9.exe');
    await writeFile(path, Buffer.concat([INSTALLER, Buffer.from('!')]));
    expect(await addons.openInstaller()).toEqual({ ok: false });
    expect(opened).toEqual([]);
  });

  it('writes the consent it was given, and nothing else, to the consent record', async () => {
    const { addons, consent } = await checked();
    await addons.downloadInstaller(consent);
    await ended('installer');
    const lines = (await readFile(join(dir, 'consents.jsonl'), 'utf8')).trim().split('\n');
    const last = JSON.parse(lines.at(-1)!);
    expect(Object.keys(last).sort()).toEqual(['at', 'files', 'host', 'modelId', 'totalBytes']);
    expect(last).toMatchObject({ modelId: 'addon:installer', host: 'github.com' });
  });
});

// --- the program that runs the model ---------------------------------------------------------

const ENTRY = 'llama-b1/llama-server';
const MAC_TAR = makeTarGz([
  { name: 'llama-b1/', type: '5', mode: 0o755 },
  { name: 'llama-b1/llama-server', data: 'a program', mode: 0o755 },
  { name: 'llama-b1/libllama.0.7.0.dylib', data: 'lib' },
  { name: 'llama-b1/libllama.dylib', type: '2', link: 'libllama.0.7.0.dylib' },
]);
const macAsset = (tar: Buffer, over: Record<string, unknown> = {}) => ({
  bytes: tar.length,
  contents: [],
  entry: ENTRY,
  name: 'llama-b1-bin-macos-arm64.tar.gz',
  platform: 'darwin-arm64',
  sha256: sha(tar),
  url: 'https://github.com/ggml-org/llama.cpp/releases/download/b1/llama-b1-bin-macos-arm64.tar.gz',
  verified: false,
  ...over,
});
const manifestOf = (assets: unknown[]) => ({
  assets,
  id: 'llama-server',
  licence: 'MIT',
  licenceUrl: 'https://example.test/licence',
  name: 'llama.cpp llama-server',
  retrievedAt: '2026-10-26',
  source: 'https://example.test/source',
  tag: 'b1',
});
const MAC_MANIFEST = manifestOf([macAsset(MAC_TAR)]);

function llamaCpp(archive: Buffer): Handler {
  return (req, res, request) => {
    if (
      req.host === 'github.com' &&
      req.path.startsWith('/ggml-org/llama.cpp/releases/download/b1/')
    ) {
      res
        .writeHead(302, { location: 'https://release-assets.githubusercontent.com/blob/llama' })
        .end();
      return;
    }
    if (req.host === 'release-assets.githubusercontent.com') {
      serveBytes(archive)(req, res, request);
      return;
    }
    res.writeHead(404).end();
  };
}

describe('the program that runs the model', () => {
  const mac = { platform: 'darwin', arch: 'arm64' } as const;

  it('is offered on a Mac, with the host, the file and the size, and marked as not tested', async () => {
    const { addons } = build(mac);
    const { program } = await addons.status();
    expect(program).toMatchObject({
      state: 'missing',
      tested: false,
      bytes: MAC_TAR.length,
      consent: {
        host: 'github.com',
        files: ['llama-b1-bin-macos-arm64.tar.gz'],
        totalBytes: MAC_TAR.length,
      },
    });
  });

  it('is fetched, checked against the pinned hash, unpacked and found by the resolver', async () => {
    handler = llamaCpp(MAC_TAR);
    const { addons } = build(mac);
    const { program } = await addons.status();
    expect(await addons.installProgram(program.consent!)).toEqual({ ok: true });
    expect(await ended('program')).toMatchObject({ kind: 'done' });
    expect(await readFile(join(dir, 'runtime', ENTRY), 'utf8')).toBe('a program');
    expect(await readFile(join(dir, 'runtime', 'llama-b1/libllama.dylib'), 'utf8')).toBe('lib');
    const after = await addons.status();
    expect(after.program).toMatchObject({ state: 'installed', consent: null, tested: false });
    expect(seen.map((s) => s.host).sort()).toEqual([
      'github.com',
      'release-assets.githubusercontent.com',
    ]);
  });

  it('refuses an archive whose hash is not the pinned one, before opening it', async () => {
    handler = llamaCpp(makeTarGz([{ name: 'llama-b1/llama-server', data: 'a different program' }]));
    const { addons } = build(mac);
    await addons.installProgram((await addons.status()).program.consent!);
    expect(await ended('program')).toMatchObject({
      kind: 'failed',
      problem: 'not-the-listed-file',
    });
    expect(await filesIn(dir)).not.toContain('runtime');
  });

  it('refuses a pinned archive that tries to write outside the folder', async () => {
    const evil = makeTarGz([
      { name: 'llama-b1/llama-server', data: 'x', mode: 0o755 },
      { name: '../../escaped.txt', data: 'owned' },
    ]);
    handler = llamaCpp(evil);
    const { addons } = build({
      ...mac,
      manifest: RuntimeManifest.parse(manifestOf([macAsset(evil)])),
    });
    await addons.installProgram((await addons.status()).program.consent!);
    expect(await ended('program')).toMatchObject({
      kind: 'failed',
      problem: 'not-the-listed-file',
    });
    expect(await filesIn(work)).not.toContain('escaped.txt');
    expect(await filesIn(dir)).not.toContain('runtime');
  });

  it('wants the exact consent and does nothing otherwise', async () => {
    handler = llamaCpp(MAC_TAR);
    const { addons } = build(mac);
    const { consent } = (await addons.status()).program;
    expect(await addons.installProgram({ ...consent!, host: 'evil.example' })).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(await addons.installProgram({ ...consent!, totalBytes: 1 })).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(seen).toEqual([]);
  });

  it('is "included" where the installer carries it, and offers nothing', async () => {
    const pack = join(work, 'ai-pack');
    await mkdir(join(pack, 'llama-b1'), { recursive: true });
    await writeFile(join(pack, ENTRY), 'a program');
    const { addons } = build({ ...mac, packDir: pack });
    expect((await addons.status()).program).toMatchObject({ state: 'included', consent: null });
    expect(await addons.installProgram({ host: 'github.com', files: [], totalBytes: 0 })).toEqual({
      ok: false,
      problem: 'unavailable',
    });
  });

  it('is "unavailable" where no build is pinned', async () => {
    const { addons } = build({ platform: 'freebsd', arch: 'x64' });
    expect((await addons.status()).program).toMatchObject({ state: 'unavailable', consent: null });
  });
});

// --- the AI pack -----------------------------------------------------------------------------

const WEIGHTS = Buffer.from('weights '.repeat(3000));
const PROJECTOR = Buffer.from('projector '.repeat(900));
const cut = (data: Buffer, at: number) => [data.subarray(0, at), data.subarray(at)];
const [W1, W2] = cut(WEIGHTS, 10_000);

const packModel = (over: { weightsSha?: string } = {}) =>
  ModelManifest.parse({
    capabilities: ['text'],
    distributable: true,
    evaluationOnly: false,
    files: [
      {
        bytes: WEIGHTS.length,
        name: 'tiny.gguf',
        parts: [
          {
            bytes: WEIGHTS.length,
            name: 'tiny.gguf',
            sha256: over.weightsSha ?? sha(WEIGHTS),
            url: 'https://huggingface.co/x/y/resolve/z/tiny.gguf',
          },
        ],
        role: 'weights',
        sha256: over.weightsSha ?? sha(WEIGHTS),
      },
      {
        bytes: PROJECTOR.length,
        name: 'mmproj-tiny.gguf',
        optional: true,
        parts: [
          {
            bytes: PROJECTOR.length,
            name: 'mmproj-tiny.gguf',
            sha256: sha(PROJECTOR),
            url: 'https://huggingface.co/x/y/resolve/z/mmproj-tiny.gguf',
          },
        ],
        role: 'projector',
        sha256: sha(PROJECTOR),
      },
    ],
    id: 'tiny-model',
    kind: 'tiny',
    licence: 'Apache-2.0',
    licenceUrl: 'https://example.test/licence',
    name: 'Tiny',
    requiredMemoryBytes: 1000,
    requiredMemoryVerified: true,
    retrievedAt: '2026-10-26',
    source: 'https://example.test/source',
    sourceRevision: 'r1',
    support: { evidence: 'test', state: 'untested' },
    tier: 'light',
  });

const PACK_BASE = '/gharbete-max/THROWPAPER/releases/download/ai-pack-tiny-model';
const packJson = (
  over: { projectorSha?: string; partName?: string; weightsBytes?: number } = {},
) => ({
  format: 1,
  id: 'tiny-model',
  files: [
    {
      name: 'tiny.gguf',
      bytes: over.weightsBytes ?? WEIGHTS.length,
      sha256: sha(WEIGHTS),
      parts: [
        { name: over.partName ?? 'tiny.gguf.part1', bytes: W1!.length, sha256: sha(W1!) },
        { name: 'tiny.gguf.part2', bytes: W2!.length, sha256: sha(W2!) },
      ],
    },
    {
      name: 'mmproj-tiny.gguf',
      bytes: PROJECTOR.length,
      sha256: over.projectorSha ?? sha(PROJECTOR),
      parts: [{ name: 'mmproj-tiny.gguf', bytes: PROJECTOR.length, sha256: sha(PROJECTOR) }],
    },
  ],
});

function packRelease(
  json: unknown,
  parts: Record<string, Buffer>,
  options: { cutPart?: string } = {},
): Handler {
  return (req, res, request) => {
    if (req.host === 'github.com' && req.path.startsWith(`${PACK_BASE}/`)) {
      const name = req.path.slice(PACK_BASE.length + 1);
      res
        .writeHead(302, { location: `https://release-assets.githubusercontent.com/pack/${name}` })
        .end();
      return;
    }
    if (req.host === 'release-assets.githubusercontent.com' && req.path.startsWith('/pack/')) {
      const name = req.path.slice('/pack/'.length);
      if (name === 'PACK.json') {
        res.writeHead(200).end(JSON.stringify(json));
        return;
      }
      const body = parts[name];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      serveBytes(body, name === options.cutPart ? { cutAfter: 3000 } : {})(req, res, request);
      return;
    }
    res.writeHead(404).end();
  };
}

const PARTS = { 'tiny.gguf.part1': W1!, 'tiny.gguf.part2': W2!, 'mmproj-tiny.gguf': PROJECTOR };

describe('the AI pack', () => {
  it('is offered with github.com, every file and the whole size', async () => {
    const { addons } = build({ model: packModel() });
    expect((await addons.status()).pack).toEqual({
      state: 'missing',
      bytes: WEIGHTS.length + PROJECTOR.length,
      consent: {
        host: 'github.com',
        files: ['tiny.gguf', 'mmproj-tiny.gguf'],
        totalBytes: WEIGHTS.length + PROJECTOR.length,
      },
    });
  });

  it("is fetched part by part, joined, and every file matches the app's own hashes", async () => {
    handler = packRelease(packJson(), PARTS);
    const { addons } = build({ model: packModel() });
    const { consent } = (await addons.status()).pack;
    expect(await addons.installPack(consent!)).toEqual({ ok: true });
    expect(await ended('pack')).toMatchObject({ kind: 'done' });
    expect(await readFile(join(dir, 'tiny.gguf'))).toEqual(WEIGHTS);
    expect(await readFile(join(dir, 'mmproj-tiny.gguf'))).toEqual(PROJECTOR);
    expect(await filesIn(dir)).toEqual(['consents.jsonl', 'mmproj-tiny.gguf', 'tiny.gguf']);
    expect(new Set(seen.map((s) => s.host))).toEqual(
      new Set(['github.com', 'release-assets.githubusercontent.com']),
    );
  });

  it('is "present" once the model is installed, and then offers nothing', async () => {
    const { addons } = build({
      model: packModel(),
      aiModels: [{ id: 'tiny-model', state: 'installed' }],
    });
    const { pack } = await addons.status();
    expect(pack).toMatchObject({ state: 'present', consent: null });
    expect(await addons.installPack({ host: 'github.com', files: [], totalBytes: 0 })).toEqual({
      ok: false,
      problem: 'unavailable',
    });
  });

  it("refuses a PACK.json that disagrees with the app's manifest, and writes nothing", async () => {
    handler = packRelease(packJson({ projectorSha: sha('another projector') }), PARTS);
    const { addons } = build({ model: packModel() });
    await addons.installPack((await addons.status()).pack.consent!);
    expect(await ended('pack')).toMatchObject({ kind: 'failed', problem: 'not-the-listed-file' });
    expect(await filesIn(dir)).toEqual(['consents.jsonl']);
  });

  it("refuses a PACK.json whose sizes do not add up or whose part is not the file's", async () => {
    handler = packRelease(packJson({ weightsBytes: WEIGHTS.length + 1 }), PARTS);
    const a = build({ model: packModel() });
    await a.addons.installPack((await a.addons.status()).pack.consent!);
    expect((await ended('pack')).kind).toBe('failed');
    events = [];
    handler = packRelease(packJson({ partName: 'consents.jsonl' }), {
      ...PARTS,
      'consents.jsonl': W1!,
    });
    const b = build({ model: packModel() });
    await b.addons.installPack((await b.addons.status()).pack.consent!);
    expect((await ended('pack')).kind).toBe('failed');
    expect(await readFile(join(dir, 'consents.jsonl'), 'utf8')).not.toContain('weights');
  });

  it('refuses a part whose bytes are not the listed ones', async () => {
    handler = packRelease(packJson(), {
      ...PARTS,
      'tiny.gguf.part2': Buffer.from(W2!.toString().replace(/w/g, 'x')),
    });
    const { addons } = build({ model: packModel() });
    await addons.installPack((await addons.status()).pack.consent!);
    expect(await ended('pack')).toMatchObject({ kind: 'failed', problem: 'not-the-listed-file' });
    expect(await filesIn(dir)).not.toContain('tiny.gguf');
  });

  it('resumes a cut-off part and finishes with verified files', async () => {
    handler = packRelease(packJson(), PARTS, { cutPart: 'tiny.gguf.part2' });
    const { addons } = build({ model: packModel() });
    const { consent } = (await addons.status()).pack;
    await addons.installPack(consent!);
    expect(await ended('pack')).toMatchObject({ kind: 'failed', problem: 'download-failed' });
    expect(await filesIn(dir)).toContain('tiny.gguf.part2.partial');
    events = [];
    seen = [];
    handler = packRelease(packJson(), PARTS);
    await addons.installPack(consent!);
    expect(await ended('pack')).toMatchObject({ kind: 'done' });
    expect(seen.some((s) => /^bytes=\d+-$/.test(String(s.headers.range ?? '')))).toBe(true);
    expect(await readFile(join(dir, 'tiny.gguf'))).toEqual(WEIGHTS);
  });

  it('wants the exact consent and the room (all of it, and the largest file again for the join)', async () => {
    handler = packRelease(packJson(), PARTS);
    const { addons } = build({ model: packModel() });
    const { consent } = (await addons.status()).pack;
    expect(await addons.installPack({ ...consent!, totalBytes: consent!.totalBytes - 1 })).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(await addons.installPack({ ...consent!, files: ['tiny.gguf'] })).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    const tight = build({ model: packModel(), freeDisk: WEIGHTS.length + PROJECTOR.length });
    expect(await tight.addons.installPack(consent!)).toEqual({
      ok: false,
      problem: 'no-disk-space',
    });
    expect(seen).toEqual([]);
  });

  it('does not start beside a model download', async () => {
    const { addons } = build({ model: packModel(), busy: true });
    expect(await addons.installPack((await addons.status()).pack.consent!)).toEqual({
      ok: false,
      problem: 'busy',
    });
  });
});

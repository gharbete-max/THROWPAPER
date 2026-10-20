import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelManifest, consentFor, type AiEvent, type AiTask } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator, type CoordinatorDeps } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const TASK: AiTask = { kind: 'translate', text: 'Hi', into: 'sv-SE' };

function tiny(id: string, tier: 'full' | 'light', memory: number) {
  const bytes = randomBytes(2000);
  const name = `${id}.gguf`;
  return {
    bytes,
    manifest: ModelManifest.parse({
      capabilities: ['text', 'vision'],
      distributable: true,
      evaluationOnly: false,
      files: [
        {
          bytes: bytes.length,
          name,
          parts: [
            {
              bytes: bytes.length,
              name,
              sha256: sha(bytes),
              url: `https://huggingface.co/x/resolve/r/${name}`,
            },
          ],
          role: 'weights',
          sha256: sha(bytes),
        },
      ],
      id,
      kind: 'k',
      licence: 'Apache-2.0',
      licenceUrl: 'https://example.test/l',
      name: id,
      requiredMemoryBytes: memory,
      requiredMemoryVerified: false,
      retrievedAt: '2026-10-20',
      source: 'https://huggingface.co/x',
      sourceRevision: 'r',
      support: { evidence: 'test', state: 'untested' },
      tier,
    }),
  };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-catalogue-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(overrides: Partial<CoordinatorDeps> = {}) {
  const big = tiny('big', 'full', 10e9);
  const small = tiny('small', 'light', 2e9);
  const ran: string[] = [];
  const engine = (name: string) => () => {
    ran.push(name);
    return new FakeEngine({ behaviour: { delayMs: 0 } });
  };
  const events: AiEvent[] = [];
  const coordinator = createCoordinator({
    registry: [big.manifest, small.manifest],
    engines: { big: engine('big'), small: engine('small') },
    dir: join(dir, 'models'),
    env: {},
    repoRoot: null,
    freeMemory: () => 4e9,
    totalMemory: () => 8e9,
    freeDisk: () => Promise.resolve(1e12),
    chooseFile: () => Promise.resolve(null),
    fetch: (() => Promise.reject(new Error('no network'))) as typeof fetch,
    cache: new ResultCache(join(dir, 'cache.json')),
    fake: true,
    ...overrides,
  });
  coordinator.onEvent((e) => events.push(e));
  return { big, small, coordinator, ran, events };
}

describe('choosing a model', () => {
  it('recommends the tier that fits this computer and fetches nothing', async () => {
    const { coordinator } = setup();
    const status = await coordinator.status();
    expect(status.models.map((m) => [m.id, m.recommended])).toEqual([
      ['big', false],
      ['small', true],
    ]);
    expect(status.totalMemoryBytes).toBe(8e9);
  });

  it('sends tasks to the chosen model, and back to the default when the choice is cleared', async () => {
    const { coordinator, ran, events } = setup();
    expect((await coordinator.status()).models.find((m) => m.selected)?.id).toBe('big');
    await coordinator.select('small');
    expect((await coordinator.status()).models.find((m) => m.selected)?.id).toBe('small');
    await coordinator.run('a', TASK);
    await vi.waitFor(() =>
      expect(events.some((e) => e.id === 'a' && e.kind === 'done')).toBe(true),
    );
    expect(ran).toEqual(['small']);
    await coordinator.select(null);
    expect((await coordinator.status()).models.find((m) => m.selected)?.id).toBe('big');
  });

  it('keeps the choice on disk and ignores an unknown model', async () => {
    const { coordinator } = setup();
    await coordinator.select('small');
    await coordinator.select('nope');
    expect(JSON.parse(await readFile(join(dir, 'models', 'selected.json'), 'utf8'))).toEqual({
      selected: 'small',
    });
  });
});

describe('downloading a catalogue model', () => {
  it('stops before a byte when the disk has no room', async () => {
    const fetchSpy = vi.fn();
    const { coordinator, small } = setup({
      fake: false,
      freeDisk: () => Promise.resolve(100),
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(await coordinator.install('small', consentFor(small.manifest)!)).toEqual({
      ok: false,
      problem: 'no-disk-space',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records the consent, reports speed and the whole install, and ends installed', async () => {
    const { small, coordinator, events } = setup({ fake: false });
    const served = (async () => new Response(new Blob([small.bytes as BlobPart]))) as typeof fetch;
    const own = createCoordinator({
      registry: [small.manifest],
      engines: {},
      dir: join(dir, 'own'),
      env: {},
      repoRoot: null,
      freeMemory: () => 1e12,
      freeDisk: () => Promise.resolve(1e12),
      chooseFile: () => Promise.resolve(null),
      fetch: served,
      cache: new ResultCache(join(dir, 'c2.json')),
    });
    const seen: AiEvent[] = [];
    own.onEvent((e) => seen.push(e));
    void coordinator;
    void events;
    expect(await own.install('small', consentFor(small.manifest)!)).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(seen.some((e) => e.kind === 'installed')).toBe(true));
    const progress = seen.find((e) => e.kind === 'install');
    expect(progress).toMatchObject({ modelTotal: 2000 });
    const log = (await readFile(join(dir, 'own', 'consents.jsonl'), 'utf8')).trim();
    expect(JSON.parse(log)).toMatchObject({
      modelId: 'small',
      host: 'huggingface.co',
      totalBytes: 2000,
    });
  });

  it('refuses a consent for another download than the one it would make', async () => {
    const { coordinator, big, small } = setup({ fake: false });
    await writeFile(join(dir, 'x'), 'x');
    expect(await coordinator.install('small', consentFor(big.manifest)!)).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(small.manifest.id).toBe('small');
  });
});

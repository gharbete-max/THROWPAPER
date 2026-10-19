import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEXT_MODEL, type AiEvent, type ReadPageTask } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';

/**
 * Reading pages through the real coordinator over the fake engine (docs/plan/AI-SYSTEM.md D4): one
 * page per task, streamed, the answer a structured page on the page asked for, kept per page under
 * its cache key (so a repeat never loads the model), a failed page never kept, cancel.
 */
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-readpage-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]);
const task = (over: Partial<ReadPageTask> = {}): ReadPageTask => ({
  kind: 'read-page',
  fileSha256: 'c'.repeat(64),
  page: 1,
  png: PNG,
  longEdge: 1200,
  turn: 0,
  language: null,
  ...over,
});

function setup(fake: ConstructorParameters<typeof FakeEngine>[0] = {}) {
  const made: FakeEngine[] = [];
  const coordinator = createCoordinator({
    engines: {
      [TEXT_MODEL.id]: () => {
        const engine = new FakeEngine(fake);
        made.push(engine);
        return engine;
      },
    },
    dir: join(dir, 'models'),
    env: {},
    repoRoot: null,
    freeMemory: () => 0,
    chooseFile: () => Promise.resolve(null),
    fetch: (() => Promise.reject(new Error('no network in this test'))) as typeof fetch,
    cache: new ResultCache(join(dir, 'cache.json')),
    fake: true,
  });
  const events: AiEvent[] = [];
  coordinator.onEvent((e) => events.push(e));
  const settled = (id: string) =>
    vi.waitFor(() =>
      expect(events.some((e) => e.id === id && (e.kind === 'done' || e.kind === 'error'))).toBe(
        true,
      ),
    );
  const page = (id: string) => {
    const text = events.filter((e) => e.id === id && e.kind === 'text').at(-1);
    return JSON.parse(text && text.kind === 'text' ? text.text : 'null');
  };
  return { coordinator, made, events, settled, page };
}

describe('reading a page', () => {
  it('answers with a structured page on the page asked for', async () => {
    const ctx = setup();
    await ctx.coordinator.run('a', task({ page: 3 }));
    await ctx.settled('a');
    expect(ctx.page('a')).toMatchObject({
      page: 3,
      status: 'ok',
      blocks: [{ type: 'paragraph', page: 3, text: 'Fake page 3' }],
    });
    expect(ctx.events.find((e) => e.id === 'a' && e.kind === 'done')).toBeDefined();
  });

  it('keeps a read page, and answers the same page again without loading the model', async () => {
    const ctx = setup();
    await ctx.coordinator.run('a', task());
    await ctx.settled('a');
    expect(ctx.made).toHaveLength(1);
    const cached = (await ctx.coordinator.status()).cache.entries;
    expect(cached).toBe(1);

    await ctx.coordinator.run('b', task({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]) }));
    await ctx.settled('b');
    expect(ctx.page('b')).toEqual(ctx.page('a'));
    expect(ctx.made[0]!.tasks).toHaveLength(1);
  });

  it('reads again when the page, its resolution, its turn or the file is not the same', async () => {
    const ctx = setup();
    const variants = [
      task(),
      task({ page: 2 }),
      task({ longEdge: 1800 }),
      task({ turn: 90 }),
      task({ fileSha256: 'd'.repeat(64) }),
    ];
    for (const [i, t] of variants.entries()) {
      await ctx.coordinator.run(`v${i}`, t);
      await ctx.settled(`v${i}`);
    }
    expect(ctx.made[0]!.tasks).toHaveLength(variants.length);
    expect((await ctx.coordinator.status()).cache.entries).toBe(variants.length);
  });

  it('lists a page it could not read as failed, and does not keep it', async () => {
    const ctx = setup({ pages: () => 'this is not json' });
    await ctx.coordinator.run('a', task());
    await ctx.settled('a');
    expect(ctx.page('a')).toMatchObject({ page: 1, status: 'failed', reason: 'unreadable-output' });
    expect((await ctx.coordinator.status()).cache.entries).toBe(0);
  });

  it('refuses a picture that is not one, and stops when cancelled', async () => {
    const ctx = setup({ readDelayMs: 200 });
    await ctx.coordinator.run('bad', task({ png: new Uint8Array([1, 2, 3, 4]) }));
    await ctx.settled('bad');
    expect(ctx.events.find((e) => e.id === 'bad' && e.kind === 'error')).toMatchObject({
      problem: 'failed',
    });

    await ctx.coordinator.run('slow', task({ page: 5 }));
    await vi.waitFor(() =>
      expect(ctx.made[0]!.tasks.some((t) => t.kind === 'read-page' && t.page === 5)).toBe(true),
    );
    await ctx.coordinator.cancel('slow');
    await ctx.settled('slow');
    expect(ctx.events.find((e) => e.id === 'slow' && e.kind === 'error')).toMatchObject({
      problem: 'cancelled',
    });
  });

  it('reads one page at a time, in the order they were asked', async () => {
    const ctx = setup({ readDelayMs: 20 });
    for (const n of [1, 2, 3]) await ctx.coordinator.run(`p${n}`, task({ page: n }));
    await ctx.settled('p3');
    const order = ctx.made[0]!.tasks.map((t) => (t.kind === 'read-page' ? t.page : 0));
    expect(order).toEqual([1, 2, 3]);
  });
});

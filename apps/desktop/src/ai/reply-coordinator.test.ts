import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_REGISTRY, TEXT_MODEL, type AiEvent } from '@tp/shared/ai';
import type { ReplyTask } from '@tp/shared/summary';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from './cache.js';
import { createCoordinator } from './coordinator.js';
import { AI_CHANNELS } from './channels.js';
import { registerAiIpc } from './ai-ipc.js';
import { FakeEngine } from './engines/fake-engine.js';
import type { Coordinator } from './coordinator.js';

/**
 * The reply helper through the real coordinator and the real pipeline, over the fake text engine
 * (docs/plan/AI-SYSTEM.md D6): it needs the text model and only the text model, streams, ends with
 * a result and warnings, can be cancelled, and keeps nothing.
 */
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-reply-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const TASK: ReplyTask = {
  kind: 'draft-reply',
  received: 'Can you come on 2026-04-18?',
  notes: 'I can come',
  into: 'en-GB',
  tone: 'friendly',
};

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
    vi.waitFor(
      () => {
        expect(events.some((e) => e.id === id && (e.kind === 'done' || e.kind === 'error'))).toBe(
          true,
        );
      },
      { timeout: 5000 },
    );
  return { coordinator, events, made, settled };
}

const textOf = (events: AiEvent[], id: string) =>
  events.filter((e) => e.id === id && e.kind === 'text').at(-1);

describe('the reply helper through the coordinator', () => {
  it('runs on the one model, streams a draft and ends with its warnings', async () => {
    const { coordinator, events, made, settled } = setup();
    expect(await coordinator.run('r1', TASK)).toEqual({ ok: true, id: 'r1' });
    await settled('r1');
    expect(made).toHaveLength(1);
    expect(made[0]!.tasks.map((t) => t.kind)).toEqual(['draft-reply']);
    const text = textOf(events, 'r1');
    expect(text).toMatchObject({ kind: 'text', mode: 'replace' });
    expect((text as { text: string }).text).toContain('[date?]');
    expect(events.find((e) => e.id === 'r1' && e.kind === 'done')).toMatchObject({ warnings: [] });
    // One model serves text and pictures (ADR 0025); no picture was asked of it.
    expect((await coordinator.status()).models).toHaveLength(MODEL_REGISTRY.length);
  });

  it('works on a draft: shorter, translate and revise each come back changed', async () => {
    const { coordinator, events, settled } = setup();
    const draft = 'Hello,\n\nThanks for your message. I can come.\n\nKind regards';
    const kinds = [
      ['s', { ...TASK, kind: 'shorten-reply', draft }],
      ['t', { ...TASK, kind: 'translate-reply', draft, into: 'sv-SE' }],
      ['v', { ...TASK, kind: 'revise-reply', draft, instruction: 'More friendly' }],
    ] as const;
    for (const [id, task] of kinds) {
      await coordinator.run(id, task as ReplyTask);
      await settled(id);
    }
    expect((textOf(events, 's') as { text: string }).text).not.toBe(draft);
    expect((textOf(events, 't') as { text: string }).text.startsWith('[')).toBe(true);
    expect((textOf(events, 'v') as { text: string }).text).toContain('More friendly');
  });

  it('can be cancelled in the middle, and says so', async () => {
    const { coordinator, events, settled } = setup({ behaviour: { delayMs: 20 } });
    await coordinator.run('c', TASK);
    await vi.waitFor(() =>
      expect(events.some((e) => e.id === 'c' && e.kind === 'text')).toBe(true),
    );
    await coordinator.cancel('c');
    await settled('c');
    expect(events.find((e) => e.id === 'c' && e.kind === 'error')).toMatchObject({
      problem: 'cancelled',
    });
  });

  it("puts a misbehaving model's invented number on the result, not away", async () => {
    const { coordinator, events, settled } = setup({ behaviour: { invent: 'Fee 777' } });
    // The fake invents only for summaries; a reply made of a draft that carries one is flagged.
    await coordinator.run('i', {
      ...TASK,
      kind: 'revise-reply',
      draft: 'Hello, the fee is 777 kronor.',
      instruction: 'Keep it',
    });
    await settled('i');
    expect(events.find((e) => e.id === 'i' && e.kind === 'done')).toMatchObject({
      warnings: [{ kind: 'numbers-added', numbers: ['777'] }],
    });
  });

  it('stores nothing: a finished reply leaves no cache entry', async () => {
    const { coordinator, settled } = setup();
    await coordinator.run('n', TASK);
    await settled('n');
    expect((await coordinator.status()).cache.entries).toBe(0);
  });
});

describe('the reply helper where the text model is not installed', () => {
  it('is answered not-installed with no output, and nothing is faked', async () => {
    const coordinator: Coordinator = createCoordinator({
      engines: { [TEXT_MODEL.id]: () => new FakeEngine() },
      dir: join(dir, 'models'),
      env: {},
      repoRoot: null,
      freeMemory: () => 1e12,
      chooseFile: () => Promise.resolve(null),
      fetch: (() => Promise.reject(new Error('no network'))) as typeof fetch,
      cache: new ResultCache(join(dir, 'cache.json')),
    });
    const events: AiEvent[] = [];
    coordinator.onEvent((e) => events.push(e));
    expect(await coordinator.run('m', TASK)).toEqual({ ok: false, problem: 'not-installed' });
    expect(events).toEqual([]);
  });
});

describe('the reply helper over the IPC', () => {
  it('accepts a well-formed reply task and refuses a malformed one, with no model call', async () => {
    const run = vi.fn(() => Promise.resolve({ ok: true, id: 'x' }));
    const handlers = new Map<string, (event: unknown, ...a: unknown[]) => unknown>();
    registerAiIpc(
      { handle: (c, l) => handlers.set(c, l as never) },
      { run } as unknown as Coordinator,
      () => ['http://127.0.0.1:4100'],
    );
    const from = { senderFrame: { url: 'http://127.0.0.1:4100/send' } };
    const handler = handlers.get(AI_CHANNELS.run)!;
    await handler(from, 'a', TASK);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await handler(from, 'b', { ...TASK, tone: 'rude' })).toEqual({
      ok: false,
      problem: 'failed',
    });
    expect(await handler(from, 'c', { ...TASK, kind: 'send-reply' })).toEqual({
      ok: false,
      problem: 'failed',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

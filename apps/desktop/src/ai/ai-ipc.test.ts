import { describe, expect, it, vi } from 'vitest';
import { registerAiIpc } from './ai-ipc.js';
import { AI_CHANNELS } from './channels.js';
import type { Coordinator } from './coordinator.js';

function harness() {
  const handlers = new Map<
    string,
    (event: { senderFrame?: { url: string } | null }, ...a: unknown[]) => unknown
  >();
  const coordinator = {
    status: vi.fn(() => Promise.resolve({})),
    install: vi.fn(() => Promise.resolve({ ok: true, id: 'install:m' })),
    openFromDisk: vi.fn(() => Promise.resolve({ ok: true, id: 'install:m' })),
    remove: vi.fn(() => Promise.resolve({})),
    run: vi.fn(() => Promise.resolve({ ok: true, id: 'x' })),
    cancel: vi.fn(() => Promise.resolve()),
    clearCache: vi.fn(() => Promise.resolve({})),
  } as unknown as Coordinator;
  registerAiIpc({ handle: (c, l) => handlers.set(c, l) }, coordinator, () => [
    'http://127.0.0.1:4100',
  ]);
  return { handlers, coordinator };
}
const forms = { senderFrame: { url: 'http://127.0.0.1:4100/summary' } };

describe('the AI IPC', () => {
  it('registers exactly the channels of window.loppaAi', () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(AI_CHANNELS)
        .filter((c) => !c.endsWith(':event'))
        .sort(),
    );
  });

  it('answers the Forms window and nobody else, on every channel', () => {
    const { handlers, coordinator } = harness();
    for (const [channel, handler] of handlers) {
      for (const frame of [
        { senderFrame: { url: 'https://evil.example/' } },
        { senderFrame: { url: 'http://127.0.0.1:4100.evil.example/' } },
        { senderFrame: { url: 'file:///panel/index.html' } },
        { senderFrame: null },
      ]) {
        expect(() => handler(frame, 'a', {}), channel).toThrow('not-the-forms-window');
      }
    }
    expect(coordinator.status).not.toHaveBeenCalled();
    expect(coordinator.run).not.toHaveBeenCalled();
  });

  it('refuses a task of the wrong shape, an unknown language, or a reserved id', async () => {
    const { handlers, coordinator } = harness();
    const run = handlers.get(AI_CHANNELS.run)!;
    const good = { kind: 'translate', text: 'Hi', into: 'sv-SE' };
    expect(await run(forms, 'a', good)).toEqual({ ok: true, id: 'x' });
    for (const [id, task] of [
      ['a', { kind: 'translate', text: 'Hi', into: 'xx-XX' }],
      ['a', { kind: 'summarise', text: 5, into: 'sv-SE', shape: 'document' }],
      ['a', { kind: 'run', cmd: 'calc' }],
      ['a', null],
      ['install', good],
      ['install:m', good],
      ['', good],
      [7, good],
    ] as const) {
      expect(await run(forms, id, task)).toEqual({ ok: false, problem: 'failed' });
    }
    expect(coordinator.run).toHaveBeenCalledTimes(1);
  });

  it('answers a page-reading task with not-available, without passing it on', async () => {
    const { handlers, coordinator } = harness();
    expect(await handlers.get(AI_CHANNELS.run)!(forms, 'p', { kind: 'read-page' })).toEqual({
      ok: false,
      problem: 'not-available',
    });
    expect(coordinator.run).not.toHaveBeenCalled();
  });

  it('starts a download only on consent that is exactly true, for a plain model id', async () => {
    const { handlers, coordinator } = harness();
    const install = handlers.get(AI_CHANNELS.install)!;
    await install(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', true);
    expect(coordinator.install).toHaveBeenLastCalledWith('qwen2.5-vl-7b-instruct-q4_k_m', true);
    await install(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', 'yes');
    expect(coordinator.install).toHaveBeenLastCalledWith('qwen2.5-vl-7b-instruct-q4_k_m', false);
    await install(forms, '../../etc', true);
    await install(forms, 7, true);
    expect(coordinator.install).toHaveBeenCalledTimes(2);
  });

  it('passes a cancel, a status and a cache clear straight on', async () => {
    const { handlers, coordinator } = harness();
    await handlers.get(AI_CHANNELS.cancel)!(forms, 'a');
    await handlers.get(AI_CHANNELS.cancel)!(forms, 9);
    await handlers.get(AI_CHANNELS.status)!(forms);
    await handlers.get(AI_CHANNELS.clearCache)!(forms);
    expect(coordinator.cancel).toHaveBeenCalledTimes(1);
    expect(coordinator.status).toHaveBeenCalledTimes(1);
    expect(coordinator.clearCache).toHaveBeenCalledTimes(1);
  });
});

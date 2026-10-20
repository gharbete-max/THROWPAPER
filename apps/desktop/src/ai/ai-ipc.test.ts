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
    useGraphics: vi.fn(() => Promise.resolve({})),
    installGraphics: vi.fn(() => Promise.resolve({ ok: true, id: 'graphics:install' })),
    clearGraphicsFailure: vi.fn(() => Promise.resolve({})),
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

  it('takes the graphics setting as a boolean and the download only with a well-formed consent', async () => {
    const { handlers, coordinator } = harness();
    await handlers.get(AI_CHANNELS.useGraphics)!(forms, 'yes');
    expect(coordinator.useGraphics).not.toHaveBeenCalled();
    await handlers.get(AI_CHANNELS.useGraphics)!(forms, true);
    expect(coordinator.useGraphics).toHaveBeenCalledWith(true);
    const install = handlers.get(AI_CHANNELS.installGraphics)!;
    expect(await install(forms, { host: 'github.com' })).toEqual({
      ok: false,
      problem: 'consent-required',
    });
    expect(coordinator.installGraphics).not.toHaveBeenCalled();
    await install(forms, { host: 'github.com', files: ['a.zip'], totalBytes: 5, extra: 'x' });
    expect(coordinator.installGraphics).toHaveBeenCalledWith({
      host: 'github.com',
      files: ['a.zip'],
      totalBytes: 5,
    });
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

  it('passes on a page-reading task of the right shape and refuses any other', async () => {
    const { handlers, coordinator } = harness();
    const run = handlers.get(AI_CHANNELS.run)!;
    const page = {
      kind: 'read-page',
      fileSha256: 'b'.repeat(64),
      page: 1,
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      longEdge: 1200,
      turn: 0,
      language: null,
    };
    for (const bad of [
      { kind: 'read-page' },
      { ...page, png: 'AAAA' },
      { ...page, png: new Uint8Array(0) },
      { ...page, png: new Uint8Array(13 * 1024 * 1024) },
      { ...page, page: 0 },
      { ...page, turn: 45 },
      { ...page, fileSha256: 'x' },
    ]) {
      expect(await run(forms, 'p', bad)).toEqual({ ok: false, problem: 'failed' });
    }
    expect(coordinator.run).not.toHaveBeenCalled();
    await run(forms, 'p', page);
    expect(coordinator.run).toHaveBeenCalledTimes(1);
  });

  it('passes on proofreading and email tasks of the right shape', async () => {
    const { handlers, coordinator } = harness();
    const run = handlers.get(AI_CHANNELS.run)!;
    await run(forms, 'a', { kind: 'proofread', text: 'Hi', source: '', into: 'en-GB' });
    await run(forms, 'b', {
      kind: 'compose-email',
      purpose: 'feedback',
      material: '1. spelling: "x"',
      recipient: 'Anna',
      notes: '',
      into: 'sv-SE',
      tone: 'formal',
      overall: 'mixed',
      quotes: ['x'],
    });
    expect(coordinator.run).toHaveBeenCalledTimes(2);
    expect(
      await run(forms, 'c', { kind: 'proofread', text: '', source: '', into: 'en-GB' }),
    ).toEqual({
      ok: false,
      problem: 'failed',
    });
  });

  it('hands the consent on for the coordinator to check, for a plain model id only', async () => {
    const { handlers, coordinator } = harness();
    const install = handlers.get(AI_CHANNELS.install)!;
    const consent = { host: 'huggingface.co', files: ['a'], totalBytes: 1 };
    await install(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', consent);
    expect(coordinator.install).toHaveBeenLastCalledWith('qwen2.5-vl-7b-instruct-q4_k_m', consent);
    await install(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', consent);
    expect(coordinator.install).toHaveBeenCalledTimes(2);
    for (const bad of ['yes', null, { ...consent, totalBytes: '1' }, { ...consent, files: [7] }]) {
      expect(await install(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', bad)).toEqual({
        ok: false,
        problem: 'consent-required',
      });
    }
    await install(forms, '../../etc', consent);
    await install(forms, 7, consent);
    expect(coordinator.install).toHaveBeenCalledTimes(2);
  });

  it('hands the coordinator the three fields of the consent and no others', async () => {
    const { handlers, coordinator } = harness();
    const forged = {
      host: 'huggingface.co',
      files: ['a'],
      totalBytes: 1,
      at: '1999-01-01T00:00:00Z',
      modelId: 'other',
      note: 'x'.repeat(10_000),
    };
    await handlers.get(AI_CHANNELS.install)!(forms, 'qwen2.5-vl-7b-instruct-q4_k_m', forged);
    expect(coordinator.install).toHaveBeenCalledWith('qwen2.5-vl-7b-instruct-q4_k_m', {
      host: 'huggingface.co',
      files: ['a'],
      totalBytes: 1,
    });
  });

  it('refuses a text a window could use to hand the model gigabytes', async () => {
    const { handlers, coordinator } = harness();
    const run = handlers.get(AI_CHANNELS.run)!;
    const huge = { kind: 'translate', text: 'x'.repeat(5_000_001), into: 'sv-SE' };
    expect(await run(forms, 'a', huge)).toEqual({ ok: false, problem: 'failed' });
    expect(coordinator.run).not.toHaveBeenCalled();
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

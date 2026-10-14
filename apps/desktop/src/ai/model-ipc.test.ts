import { describe, expect, it, vi } from 'vitest';
import { MODEL_CHANNELS } from './channels.js';
import { isModelJob, registerModelIpc } from './model-ipc.js';
import type { ModelService } from './model-adapter.js';

function harness() {
  const handlers = new Map<
    string,
    (event: { senderFrame?: { url: string } | null }, ...a: unknown[]) => unknown
  >();
  const service = {
    status: vi.fn(() => Promise.resolve({})),
    install: vi.fn(),
    openFromDisk: vi.fn(),
    remove: vi.fn(),
    start: vi.fn(() => Promise.resolve({ ok: true, id: 'x' })),
    cancel: vi.fn(),
    close: vi.fn(),
  } as unknown as ModelService;
  registerModelIpc({ handle: (c, l) => handlers.set(c, l) }, service, () => [
    'http://127.0.0.1:4100',
  ]);
  return { handlers, service };
}
const forms = { senderFrame: { url: 'http://127.0.0.1:4100/summary' } };

describe('the model IPC', () => {
  it('answers the Forms window and nobody else', () => {
    const { handlers, service } = harness();
    const status = handlers.get(MODEL_CHANNELS.status)!;
    status(forms);
    expect(service.status).toHaveBeenCalled();
    for (const frame of [
      { senderFrame: { url: 'https://evil.example/' } },
      { senderFrame: { url: 'http://127.0.0.1:4100.evil.example/' } },
      { senderFrame: { url: 'file:///panel/index.html' } },
      { senderFrame: null },
    ]) {
      expect(() => status(frame)).toThrow('not-the-forms-window');
    }
  });

  it('refuses a job of the wrong shape, an unknown language, or the reserved id', async () => {
    const { handlers, service } = harness();
    const start = handlers.get(MODEL_CHANNELS.start)!;
    const good = { kind: 'translate', text: 'Hi', into: 'sv-SE' };
    expect(await start(forms, 'a', good)).toEqual({ ok: true, id: 'x' });
    for (const [id, job] of [
      ['a', { kind: 'translate', text: 'Hi', into: 'xx-XX' }],
      ['a', { kind: 'summarise', text: 5, into: 'sv-SE', shape: 'document' }],
      ['a', { kind: 'run', cmd: 'calc' }],
      ['a', null],
      ['install', good],
      ['', good],
      [7, good],
    ] as const) {
      expect(await start(forms, id, job)).toEqual({ ok: false, problem: 'failed' });
    }
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('knows the three job shapes', () => {
    expect(isModelJob({ kind: 'select', passages: ['a'], language: null })).toBe(true);
    expect(isModelJob({ kind: 'select', passages: [1], language: null })).toBe(false);
  });
});

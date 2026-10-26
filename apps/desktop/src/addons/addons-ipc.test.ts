import { describe, expect, it, vi } from 'vitest';
import { ADDONS_CHANNELS } from '../ai/channels.js';
import { registerAddonsIpc } from './addons-ipc.js';
import type { Addons } from './addons.js';

function harness() {
  const handlers = new Map<
    string,
    (event: { senderFrame?: { url: string } | null }, ...a: unknown[]) => unknown
  >();
  const addons = {
    status: vi.fn(() => Promise.resolve({})),
    installProgram: vi.fn(() => Promise.resolve({ ok: true })),
    installPack: vi.fn(() => Promise.resolve({ ok: true })),
    checkUpdate: vi.fn(() => Promise.resolve({ ok: true })),
    downloadInstaller: vi.fn(() => Promise.resolve({ ok: true })),
    openInstaller: vi.fn(() => Promise.resolve({ ok: true })),
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as Addons;
  registerAddonsIpc({ handle: (c, l) => handlers.set(c, l) }, addons, () => [
    'http://127.0.0.1:4100',
  ]);
  return { handlers, addons };
}
const forms = { senderFrame: { url: 'http://127.0.0.1:4100/ai-setup' } };
const CONSENT_CHANNELS = [
  ADDONS_CHANNELS.installProgram,
  ADDONS_CHANNELS.installPack,
  ADDONS_CHANNELS.checkUpdate,
  ADDONS_CHANNELS.downloadInstaller,
] as const;

describe('the add-ons IPC', () => {
  it('registers exactly the channels of window.loppaAddons', () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(ADDONS_CHANNELS)
        .filter((c) => !c.endsWith(':event'))
        .sort(),
    );
  });

  it('answers the Forms window and nobody else, on every channel', () => {
    const { handlers, addons } = harness();
    for (const [channel, handler] of handlers) {
      for (const frame of [
        { senderFrame: { url: 'https://evil.example/' } },
        { senderFrame: { url: 'http://127.0.0.1:4100.evil.example/' } },
        { senderFrame: { url: 'http://127.0.0.1:4101/' } },
        { senderFrame: { url: 'file:///panel/index.html' } },
        { senderFrame: null },
      ]) {
        expect(
          () => handler(frame, { host: 'github.com', files: [], totalBytes: 0 }),
          channel,
        ).toThrow('not-the-forms-window');
      }
    }
    for (const fn of Object.values(addons)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(CONSENT_CHANNELS)('%s takes a well-formed consent and nothing else', async (channel) => {
    const { handlers, addons } = harness();
    const handler = handlers.get(channel)!;
    const method = {
      [ADDONS_CHANNELS.installProgram]: addons.installProgram,
      [ADDONS_CHANNELS.installPack]: addons.installPack,
      [ADDONS_CHANNELS.checkUpdate]: addons.checkUpdate,
      [ADDONS_CHANNELS.downloadInstaller]: addons.downloadInstaller,
    }[channel];
    for (const bad of [
      undefined,
      null,
      'github.com',
      42,
      [],
      {},
      { host: 'github.com' },
      { host: 7, files: [], totalBytes: 0 },
      { host: 'github.com', files: 'a.zip', totalBytes: 0 },
      { host: 'github.com', files: [1], totalBytes: 0 },
      { host: 'github.com', files: [], totalBytes: 1.5 },
      { host: 'github.com', files: [], totalBytes: -1 },
      { host: 'github.com', files: [], totalBytes: 1e300 },
      { host: 'github.com', files: [], totalBytes: '5' },
      { host: 'h'.repeat(254), files: [], totalBytes: 0 },
      { host: 'github.com', files: Array.from({ length: 33 }, () => 'a'), totalBytes: 0 },
      { host: 'github.com', files: ['a'.repeat(256)], totalBytes: 0 },
    ]) {
      expect(await handler(forms, bad), JSON.stringify(bad)).toEqual({
        ok: false,
        problem: 'consent-required',
      });
    }
    expect(method).not.toHaveBeenCalled();

    // The record gets the three fields: whatever else a window adds is dropped.
    await handler(forms, {
      host: 'github.com',
      files: ['a.zip'],
      totalBytes: 5,
      at: '1970-01-01',
      path: 'C:\\Windows\\System32',
      url: 'https://evil.example/',
    });
    expect(method).toHaveBeenCalledWith({ host: 'github.com', files: ['a.zip'], totalBytes: 5 });
  });

  it('opens the saved installer and cancels with no argument a window could use', async () => {
    const { handlers, addons } = harness();
    await handlers.get(ADDONS_CHANNELS.openInstaller)!(forms, 'C:\\Windows\\System32\\cmd.exe');
    expect(addons.openInstaller).toHaveBeenCalledWith();
    await handlers.get(ADDONS_CHANNELS.cancel)!(forms, 'x');
    expect(addons.cancel).toHaveBeenCalledWith();
  });
});

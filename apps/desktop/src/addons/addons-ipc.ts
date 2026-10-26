import { plainConsent } from '../ai/ai-ipc.js';
import { ADDONS_CHANNELS } from '../ai/channels.js';
import { originGuard, type IpcMainLike } from '../ai/origin-guard.js';
import type { Addons } from './addons.js';

/**
 * The narrow IPC for Add-ons and updates (`window.loppaAddons`): status, the four actions that can
 * touch the network, opening the installer that was saved, and cancel. Only the Forms window's own
 * origin is answered (`originGuard`).
 *
 * What arrives is checked by a Zod schema at this boundary: a consent is reduced to its three
 * fields (host, files, total size) with bounds, and the shell compares it with what it would fetch.
 * Nothing a window sends is a path, an address or a file name: the actions that name no consent
 * take no argument at all, and the installer that is opened is the one the shell saved itself.
 */
export function registerAddonsIpc(
  ipc: IpcMainLike,
  addons: Addons,
  allowedOrigins: () => string[],
): void {
  const guarded = originGuard(allowedOrigins);
  const needConsent = { ok: false, problem: 'consent-required' } as const;

  ipc.handle(
    ADDONS_CHANNELS.status,
    guarded(() => addons.status()),
  );
  ipc.handle(
    ADDONS_CHANNELS.installProgram,
    guarded((consent: unknown) => {
      const plain = plainConsent(consent);
      return plain ? addons.installProgram(plain) : needConsent;
    }),
  );
  ipc.handle(
    ADDONS_CHANNELS.installPack,
    guarded((consent: unknown) => {
      const plain = plainConsent(consent);
      return plain ? addons.installPack(plain) : needConsent;
    }),
  );
  ipc.handle(
    ADDONS_CHANNELS.checkUpdate,
    guarded((consent: unknown) => {
      const plain = plainConsent(consent);
      return plain ? addons.checkUpdate(plain) : needConsent;
    }),
  );
  ipc.handle(
    ADDONS_CHANNELS.downloadInstaller,
    guarded((consent: unknown) => {
      const plain = plainConsent(consent);
      return plain ? addons.downloadInstaller(plain) : needConsent;
    }),
  );
  ipc.handle(
    ADDONS_CHANNELS.openInstaller,
    guarded(() => addons.openInstaller()),
  );
  ipc.handle(
    ADDONS_CHANNELS.cancel,
    guarded(() => addons.cancel()),
  );
}

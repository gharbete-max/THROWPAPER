import type { Coordinator } from './coordinator.js';
import { AI_CHANNELS } from './channels.js';
import { isModelJob } from './model-ipc.js';
import { originGuard, type IpcMainLike } from './origin-guard.js';

/**
 * The narrow IPC from the Forms window to the coordinator: status, install, open from disk,
 * remove, run, cancel, clear the cache, and events back (`window.loppaAi`, ADR 0024). Nothing
 * else crosses, and only the Forms window's own origin is answered.
 *
 * What arrives from a renderer is checked for shape here: a model id is a short plain string, a
 * task id is a short string that does not start with `install`, consent is exactly `true`, and a
 * task is one of the kinds a window may send. `read-page` is not yet: no model can run it, so it
 * is answered `not-available` without looking inside. The text in a task is never logged.
 */
const PLAIN_ID = /^[a-z0-9._-]{1,80}$/;

export function registerAiIpc(
  ipc: IpcMainLike,
  coordinator: Coordinator,
  allowedOrigins: () => string[],
): void {
  const guarded = originGuard(allowedOrigins);
  const refused = { ok: false, problem: 'failed' } as const;

  ipc.handle(
    AI_CHANNELS.status,
    guarded(() => coordinator.status()),
  );
  ipc.handle(
    AI_CHANNELS.install,
    guarded((modelId: unknown, consent: unknown) =>
      typeof modelId === 'string' && PLAIN_ID.test(modelId)
        ? coordinator.install(modelId, consent === true)
        : refused,
    ),
  );
  ipc.handle(
    AI_CHANNELS.openFromDisk,
    guarded((modelId: unknown) =>
      typeof modelId === 'string' && PLAIN_ID.test(modelId)
        ? coordinator.openFromDisk(modelId)
        : refused,
    ),
  );
  ipc.handle(
    AI_CHANNELS.remove,
    guarded((modelId: unknown) =>
      typeof modelId === 'string' && PLAIN_ID.test(modelId)
        ? coordinator.remove(modelId)
        : coordinator.status(),
    ),
  );
  ipc.handle(
    AI_CHANNELS.run,
    guarded((id: unknown, task: unknown) => {
      if (typeof id !== 'string' || id.length === 0 || id.length > 64 || id.startsWith('install')) {
        return refused;
      }
      if (
        typeof task === 'object' &&
        task !== null &&
        (task as { kind?: unknown }).kind === 'read-page'
      ) {
        return { ok: false, problem: 'not-available' } as const;
      }
      if (!isModelJob(task)) return refused;
      return coordinator.run(id, task);
    }),
  );
  ipc.handle(
    AI_CHANNELS.cancel,
    guarded((id: unknown) => (typeof id === 'string' ? coordinator.cancel(id) : undefined)),
  );
  ipc.handle(
    AI_CHANNELS.clearCache,
    guarded(() => coordinator.clearCache()),
  );
}

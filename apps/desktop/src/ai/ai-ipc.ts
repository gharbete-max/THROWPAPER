import { ConsentRequest, type AiConsent } from '@tp/shared/ai';
import type { Coordinator } from './coordinator.js';
import { isDraftFormTask, isReadPageTask } from '@tp/shared/ai';
import { isComposeTask, isProofreadTask, isReplyTask } from '@tp/shared/summary';
import { AI_CHANNELS } from './channels.js';
import { isModelJob } from './model-ipc.js';
import { originGuard, type IpcMainLike } from './origin-guard.js';

/**
 * The narrow IPC from the Forms window to the coordinator: status, install, open from disk,
 * remove, run, cancel, clear the cache, and events back (`window.loppaAi`, ADR 0024). Nothing
 * else crosses, and only the Forms window's own origin is answered.
 *
 * What arrives from a renderer is checked for shape here: a model id is a short plain string, a
 * task id is a short string that does not start with `install`, consent is reduced to its three fields (host, files, total size) and the coordinator checks them against the manifest, and a
 * task is one of the kinds a window may send (a page picture only as PNG or JPEG bytes of a bounded
 * size, checked again by the reader). The text in a task is never logged.
 */
const PLAIN_ID = /^[a-z0-9._-]{1,80}$/;

/**
 * The consent as the three fields it is, and nothing else: the coordinator appends what it gets to
 * the consent record, and a window must not be able to add keys to it, overwrite the time in it
 * or make it large.
 */
export function plainConsent(value: unknown): AiConsent | null {
  const parsed = ConsentRequest.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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
    guarded((modelId: unknown, consent: unknown) => {
      if (typeof modelId !== 'string' || !PLAIN_ID.test(modelId)) return refused;
      const plain = plainConsent(consent);
      return plain
        ? coordinator.install(modelId, plain)
        : { ok: false, problem: 'consent-required' };
    }),
  );
  ipc.handle(
    AI_CHANNELS.select,
    guarded((modelId: unknown) =>
      modelId === null || (typeof modelId === 'string' && PLAIN_ID.test(modelId))
        ? coordinator.select(modelId)
        : coordinator.status(),
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
        !isModelJob(task) &&
        !isReplyTask(task) &&
        !isProofreadTask(task) &&
        !isComposeTask(task) &&
        !isDraftFormTask(task) &&
        !isReadPageTask(task)
      ) {
        return refused;
      }
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
  ipc.handle(
    AI_CHANNELS.useGraphics,
    guarded((on: unknown) =>
      typeof on === 'boolean' ? coordinator.useGraphics(on) : coordinator.status(),
    ),
  );
  ipc.handle(
    AI_CHANNELS.installGraphics,
    guarded((consent: unknown) => {
      const plain = plainConsent(consent);
      return plain
        ? coordinator.installGraphics(plain)
        : { ok: false, problem: 'consent-required' };
    }),
  );
  ipc.handle(
    AI_CHANNELS.clearGraphicsFailure,
    guarded(() => coordinator.clearGraphicsFailure()),
  );
}

import { SUMMARY_LOCALES, type ModelJob } from '@tp/shared/summary';
import { MODEL_CHANNELS } from './channels.js';
import type { ModelService } from './service.js';

/**
 * The narrow IPC from the Forms window to the model service: status, install, open from disk,
 * remove, start, cancel, and events back. Nothing else crosses.
 *
 * Only the Forms window's own origin is answered: a page that got into another window, or a
 * frame inside Forms from elsewhere, is refused. The job is checked for shape here because it
 * arrives from a renderer; the text in it is never logged.
 */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => unknown,
  ): void;
}

export function isModelJob(value: unknown): value is ModelJob {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  const locale = (v: unknown) =>
    typeof v === 'string' && (SUMMARY_LOCALES as readonly string[]).includes(v);
  if (job.kind === 'summarise') {
    return (
      typeof job.text === 'string' &&
      locale(job.into) &&
      (job.shape === 'document' || job.shape === 'form')
    );
  }
  if (job.kind === 'translate') return typeof job.text === 'string' && locale(job.into);
  if (job.kind === 'select') {
    return (
      Array.isArray(job.passages) &&
      job.passages.every((p) => typeof p === 'string') &&
      (job.language === null || locale(job.language))
    );
  }
  return false;
}

export function registerModelIpc(
  ipc: IpcMainLike,
  service: ModelService,
  allowedOrigins: () => string[],
): void {
  const guarded =
    <A extends unknown[], R>(run: (...args: A) => R) =>
    (event: { senderFrame?: { url: string } | null }, ...args: unknown[]): R => {
      const url = event.senderFrame?.url ?? '';
      if (!allowedOrigins().some((origin) => url === origin || url.startsWith(`${origin}/`))) {
        throw new Error('not-the-forms-window');
      }
      return run(...(args as A));
    };

  ipc.handle(
    MODEL_CHANNELS.status,
    guarded(() => service.status()),
  );
  ipc.handle(
    MODEL_CHANNELS.install,
    guarded(() => service.install()),
  );
  ipc.handle(
    MODEL_CHANNELS.openFromDisk,
    guarded(() => service.openFromDisk()),
  );
  ipc.handle(
    MODEL_CHANNELS.remove,
    guarded(() => service.remove()),
  );
  ipc.handle(
    MODEL_CHANNELS.start,
    guarded((id: unknown, job: unknown) => {
      if (typeof id !== 'string' || id.length === 0 || id.length > 64 || id === 'install') {
        return { ok: false, problem: 'failed' } as const;
      }
      if (!isModelJob(job)) return { ok: false, problem: 'failed' } as const;
      return service.start(id, job);
    }),
  );
  ipc.handle(
    MODEL_CHANNELS.cancel,
    guarded((id: unknown) => (typeof id === 'string' ? service.cancel(id) : undefined)),
  );
}

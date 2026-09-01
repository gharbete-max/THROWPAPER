import type { JobRecord, Repositories } from '../db/repositories/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    worker: Worker;
  }
}

/**
 * The job worker.
 *
 * A handler either returns a result or throws. Throwing re-queues with backoff while attempts
 * remain and fails permanently once they do not, which is the whole retry policy — deliberately
 * boring, because a queue that is clever about failure is a queue nobody can reason about at 2am.
 */
export interface JobContext {
  job: JobRecord;
  /** Report progress so a UI can show "142 of 200" while a long job runs. */
  progress: (done: number) => Promise<void>;
}

export type JobHandler = (context: JobContext) => Promise<Record<string, unknown>>;

export interface WorkerOptions {
  repos: Repositories;
  handlers: Record<string, JobHandler>;
  /** Exponential: 5s, 10s, 20s … Kept short; these are minutes-scale jobs, not hours. */
  backoffBaseMs?: number;
  now?: () => Date;
  onError?: (error: unknown, job: JobRecord) => void;
}

export interface Worker {
  /** Runs at most one job. Returns false when there was nothing to do. */
  runOnce(): Promise<boolean>;
  /** Drains the queue. Used by tests and by a one-shot CLI run. */
  drain(limit?: number): Promise<number>;
  start(intervalMs?: number): void;
  stop(): void;
}

/** Stands in for a job when the failure happened before one was claimed. */
const unclaimedJob = { id: '(none)', kind: '(claim)' } as JobRecord;

export function createWorker(options: WorkerOptions): Worker {
  const { repos, handlers } = options;
  const backoffBaseMs = options.backoffBaseMs ?? 5_000;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runOnce(): Promise<boolean> {
    const job = await repos.jobs.claim(now());
    if (!job) return false;

    const handler = handlers[job.kind];
    if (!handler) {
      // An unknown kind is a deployment mistake, not a transient fault: retrying cannot fix it.
      await repos.jobs.fail(job.id, `No handler registered for job kind "${job.kind}"`, null);
      return true;
    }

    try {
      const result = await handler({
        job,
        progress: (done) => repos.jobs.progress(job.id, done),
      });
      await repos.jobs.succeed(job.id, result);
    } catch (error) {
      options.onError?.(error, job);
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = job.attempts >= job.maxAttempts;
      const retryAt = exhausted
        ? null
        : new Date(now().getTime() + backoffBaseMs * 2 ** (job.attempts - 1));
      await repos.jobs.fail(job.id, message, retryAt);
    }
    return true;
  }

  return {
    runOnce,

    async drain(limit = 100) {
      let processed = 0;
      while (processed < limit && (await runOnce())) processed += 1;
      return processed;
    },

    start(intervalMs = 1_000) {
      if (timer) return;
      timer = setInterval(() => {
        // One pass at a time: overlapping ticks would claim jobs faster than they finish.
        if (running) return;
        running = true;
        // Caught, not merely awaited. `runOnce` can reject before it reaches a handler — a
        // database hiccup while claiming, for instance — and an unhandled rejection on a timer
        // takes the whole API process with it. A queue must not be able to kill the web server.
        runOnce()
          .catch((error: unknown) => options.onError?.(error, unclaimedJob))
          .finally(() => {
            running = false;
          });
      }, intervalMs);
      timer.unref?.();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

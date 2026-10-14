import type { ModelEvent, ModelJob, ModelProblem } from '@tp/shared/summary';
import { JobError, type TextEngine } from './text-engine.js';
import { runJob } from './pipeline.js';

/**
 * What the model process does, apart from being a process (so a test can run it in memory).
 *
 * It answers four messages from the main process — load, run, cancel, dispose — and sends events
 * back. It holds one engine and runs one job at a time. It makes no network call and reads no file
 * but the model: the text it is given arrives in the message, and what it writes leaves in one.
 */
export type ToWorker =
  | { type: 'load'; path: string }
  | { type: 'run'; id: string; job: ModelJob }
  | { type: 'cancel'; id: string }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'loaded' }
  | { type: 'load-failed'; problem: ModelProblem; detail: string }
  | { type: 'event'; event: ModelEvent };

export interface Port {
  post(message: FromWorker): void;
}

export type LoadEngine = (path: string) => Promise<TextEngine>;

export function createWorker(port: Port, loadEngine: LoadEngine, now: () => number = Date.now) {
  let engine: TextEngine | null = null;
  let running: { id: string; abort: AbortController } | null = null;

  const send = (event: ModelEvent) => port.post({ type: 'event', event });

  async function run(id: string, job: ModelJob): Promise<void> {
    if (!engine) return send({ id, kind: 'error', problem: 'not-installed' });
    if (running) return send({ id, kind: 'error', problem: 'busy' });
    const abort = new AbortController();
    running = { id, abort };
    const started = now();
    try {
      const outcome = await runJob(
        engine,
        job,
        {
          step: (step, done, total) => send({ id, kind: 'step', step, done, total }),
          text: (mode, text) => send({ id, kind: 'text', mode, text }),
          selected: (numbers) => send({ id, kind: 'selected', numbers }),
        },
        abort.signal,
      );
      send({ id, kind: 'done', warnings: outcome.warnings, seconds: (now() - started) / 1000 });
    } catch (error) {
      send({ id, kind: 'error', problem: error instanceof JobError ? error.problem : 'failed' });
    } finally {
      running = null;
    }
  }

  return async function onMessage(message: ToWorker): Promise<void> {
    switch (message.type) {
      case 'load':
        try {
          engine ??= await loadEngine(message.path);
          port.post({ type: 'loaded' });
        } catch (error) {
          port.post({
            type: 'load-failed',
            problem: 'cannot-start',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      case 'run':
        await run(message.id, message.job);
        return;
      case 'cancel':
        if (running?.id === message.id) running.abort.abort();
        return;
      case 'dispose':
        running?.abort.abort();
        await engine?.dispose();
        engine = null;
        return;
    }
  };
}

import { isTextTask, type AiProblem, type AiTask } from '@tp/shared/ai';
import { AiError, type Engine, type EngineEvent, type RunResult } from '../engine.js';
import type { FromWorker, ToWorker } from '../text/worker-core.js';

/**
 * The text engine: `node-llama-cpp` running Qwen3-4B-Instruct-2507 on the CPU, in an Electron
 * utility process of its own (ADR 0023 section 1). This class is the coordinator's side of that
 * process: it starts it, speaks the four-message protocol of `text/worker-core.ts`, and ends it.
 * Ending the process is how the model's memory is given back.
 *
 * Behaviour is exactly the single-model service's: one worker per load, one task at a time, a
 * cancel that is posted to the worker so generation stops at the next token, and a worker that
 * exits for any reason is a task that failed with `cannot-start`.
 */
export interface WorkerHandle {
  post(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  /** Called once if the process ends, however it ends. */
  onExit(listener: () => void): void;
  kill(): void;
}

export class NodeLlamaEngine implements Engine {
  private worker: WorkerHandle | null = null;
  private current: {
    id: string;
    onEvent: (event: EngineEvent) => void;
    resolve: (result: RunResult) => void;
    reject: (error: AiError) => void;
  } | null = null;
  private loadWaiter: ((result: { ok: true } | { ok: false; problem: AiProblem }) => void) | null =
    null;
  private counter = 0;

  constructor(
    private readonly spawn: () => WorkerHandle,
    private readonly weightsPath: string,
  ) {}

  load(signal: AbortSignal): Promise<void> {
    if (this.worker) return Promise.resolve();
    const handle = this.spawn();
    this.worker = handle;
    handle.onMessage((message) => this.onMessage(message));
    handle.onExit(() => {
      if (this.worker === handle) this.worker = null;
      this.loadWaiter?.({ ok: false, problem: 'cannot-start' });
      const ended = this.current;
      this.current = null;
      ended?.reject(new AiError('cannot-start'));
    });
    return new Promise<void>((resolve, reject) => {
      const settle = (result: { ok: true } | { ok: false; problem: AiProblem }) => {
        this.loadWaiter = null;
        signal.removeEventListener('abort', aborted);
        if (result.ok) resolve();
        else reject(new AiError(result.problem));
      };
      const aborted = () => settle({ ok: false, problem: 'cancelled' });
      this.loadWaiter = settle;
      if (signal.aborted) return aborted();
      signal.addEventListener('abort', aborted, { once: true });
      handle.post({ type: 'load', path: this.weightsPath });
    });
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'loaded') return this.loadWaiter?.({ ok: true });
    if (message.type === 'load-failed') {
      return this.loadWaiter?.({ ok: false, problem: message.problem });
    }
    const { event } = message;
    const current = this.current;
    if (!current || event.id !== current.id) return;
    if (event.kind === 'done') {
      this.current = null;
      current.resolve({ warnings: event.warnings });
    } else if (event.kind === 'error') {
      this.current = null;
      current.reject(new AiError(event.problem));
    } else if (event.kind === 'step' || event.kind === 'text' || event.kind === 'selected') {
      const { id: _id, ...rest } = event;
      current.onEvent(rest as EngineEvent);
    }
  }

  run(
    task: AiTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new AiError('not-installed'));
    if (!isTextTask(task)) return Promise.reject(new AiError('not-available'));
    if (this.current) return Promise.reject(new AiError('busy'));
    const id = `run-${++this.counter}`;
    return new Promise<RunResult>((resolve, reject) => {
      this.current = { id, onEvent, resolve, reject };
      signal.addEventListener('abort', () => worker.post({ type: 'cancel', id }), { once: true });
      if (signal.aborted) worker.post({ type: 'cancel', id });
      worker.post({ type: 'run', id, job: task });
    });
  }

  dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.post({ type: 'dispose' });
      worker.kill();
    }
    return Promise.resolve();
  }
}

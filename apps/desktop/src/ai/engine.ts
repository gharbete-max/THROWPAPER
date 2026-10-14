import type { AiProblem, AiTask, FileRole } from '@tp/shared/ai';
import type { JobWarning, ModelEvent } from '@tp/shared/summary';

/**
 * The seam between the coordinator and a model runtime (ADR 0024).
 *
 * The coordinator decides everything about *when*: which model is alive, who waits, what is
 * cancelled, when memory is given back. An engine only knows how to load one model, run a task on
 * it and let go of it. There are three: {@link NodeLlamaEngine} (text, `node-llama-cpp` in a
 * utility process), {@link FakeEngine} (CI and demos) and the empty seam {@link ServerEngine}
 * (vision, Phase 3).
 *
 * Not to be confused with `ai/text/text-engine.ts`: that is "complete this prompt", one level
 * down, inside the text engine's own process.
 */

/** A step, some text, or chosen passages: a {@link ModelEvent} before the coordinator gives it an id. */
export type EngineEvent = ModelEvent extends infer E
  ? E extends { id: string; kind: 'step' | 'text' | 'selected' }
    ? Omit<E, 'id'>
    : never
  : never;

/** Where the files of the model are, by role. */
export type EngineFiles = Partial<Record<FileRole, string>> & { weights: string };

/** Something went wrong in a way a person can be told. `problem` is the sentence they get. */
export class AiError extends Error {
  constructor(
    readonly problem: AiProblem,
    message?: string,
  ) {
    super(message ?? problem);
    this.name = 'AiError';
  }
}

export interface RunResult {
  warnings: JobWarning[];
}

export interface Engine {
  /** Brings the model into memory. Rejects with an {@link AiError}. Aborting stops waiting for it. */
  load(signal: AbortSignal): Promise<void>;
  /**
   * Runs one task. `onEvent` gets progress and output as it happens. Aborting `signal` stops the
   * work at the next opportunity and rejects with `AiError('cancelled')`. One task at a time.
   */
  run(task: AiTask, onEvent: (event: EngineEvent) => void, signal: AbortSignal): Promise<RunResult>;
  /** Gives all of the model's memory back. Must be safe to call twice and while a task runs. */
  dispose(): Promise<void>;
}

/** Makes the engine for a model whose files have been found and checked. */
export type EngineFactory = (files: EngineFiles) => Engine;

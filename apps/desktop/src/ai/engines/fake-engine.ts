import { isTextTask, type AiProblem, type AiTask } from '@tp/shared/ai';
import { AiError, type Engine, type EngineEvent, type RunResult } from '../engine.js';
import { FakeTextEngine, type FakeBehaviour } from '../text/fake-text-engine.js';
import { runJob } from '../text/pipeline.js';
import { JobError } from '../text/text-engine.js';

/**
 * An {@link Engine} that needs no model: what CI and the desktop's fake mode (`LOPPA_FAKE_MODEL=1`)
 * run, and what the coordinator's tests use.
 *
 * A text task goes through Loppa's own pipeline (`text/pipeline.ts`: cutting, order of calls,
 * streaming, cancel, checks, quoting) over {@link FakeTextEngine}, which is deterministic and
 * obviously not a language model. So everything Loppa decides is exercised, in this process,
 * without a 2.5 GB file.
 *
 * `loadError` makes `load` fail as a runtime that cannot start would, and `behaviour` makes the
 * text misbehave on purpose (see {@link FakeBehaviour}).
 */
export interface FakeEngineOptions {
  behaviour?: FakeBehaviour;
  loadError?: AiProblem;
}

export class FakeEngine implements Engine {
  loaded = false;
  disposed = false;
  readonly tasks: AiTask[] = [];

  constructor(private readonly options: FakeEngineOptions = {}) {}

  load(): Promise<void> {
    if (this.options.loadError) return Promise.reject(new AiError(this.options.loadError));
    this.loaded = true;
    return Promise.resolve();
  }

  async run(
    task: AiTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    this.tasks.push(task);
    if (!isTextTask(task)) throw new AiError('not-available');
    try {
      const outcome = await runJob(
        new FakeTextEngine(this.options.behaviour),
        task,
        {
          step: (step, done, total) => onEvent({ kind: 'step', step, done, total }),
          text: (mode, text) => onEvent({ kind: 'text', mode, text }),
          selected: (numbers) => onEvent({ kind: 'selected', numbers }),
        },
        signal,
      );
      return { warnings: outcome.warnings };
    } catch (error) {
      throw error instanceof JobError ? new AiError(error.problem) : error;
    }
  }

  dispose(): Promise<void> {
    this.loaded = false;
    this.disposed = true;
    return Promise.resolve();
  }
}

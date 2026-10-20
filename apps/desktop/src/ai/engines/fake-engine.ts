import {
  isTextTask,
  pageFromModel,
  type AiProblem,
  type AiTask,
  type ReadPageTask,
} from '@tp/shared/ai';
import { pictureUri } from '../vision/read-page.js';
import { AiError, type Engine, type EngineEvent, type RunResult } from '../engine.js';
import { FakeTextEngine, type FakeBehaviour } from '../text/fake-text-engine.js';
import { runTextTask } from '../text/run-text-task.js';

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
  /** What the "model" answers for a page; the default is one paragraph. */
  pages?: (task: ReadPageTask) => string;
  readDelayMs?: number;
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
    if (!isTextTask(task)) return this.readPage(task, onEvent, signal);
    return runTextTask(new FakeTextEngine(this.options.behaviour), task, onEvent, signal);
  }

  /**
   * A page that is obviously not read by a model: one paragraph naming the page, or whatever
   * `pages` says for it. The picture is not looked at, but it is checked to be one, as the real
   * engine does, and a `readDelayMs` lets a test cancel in the middle.
   */
  private async readPage(
    task: ReadPageTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    if (!pictureUri(task.png)) throw new AiError('failed');
    onEvent({ kind: 'step', step: 'reading', done: 0, total: 1 });
    if (this.options.readDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.readDelayMs));
    }
    if (signal.aborted) throw new AiError('cancelled');
    const answer =
      this.options.pages?.(task) ??
      JSON.stringify({
        language: 'en',
        blocks: [{ type: 'paragraph', text: `Fake page ${task.page}` }],
      });
    const page = pageFromModel(task.page, answer);
    onEvent({ kind: 'text', mode: 'replace', text: JSON.stringify(page) });
    onEvent({ kind: 'step', step: 'reading', done: 1, total: 1 });
    return { warnings: [] };
  }

  dispose(): Promise<void> {
    this.loaded = false;
    this.disposed = true;
    return Promise.resolve();
  }
}

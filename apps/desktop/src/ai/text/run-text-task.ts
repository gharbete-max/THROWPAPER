import type { TextTask } from '@tp/shared/ai';
import { AiError, type EngineEvent, type RunResult } from '../engine.js';
import { runJob } from './pipeline.js';
import { JobError, type TextEngine } from './text-engine.js';

/**
 * One text task through Loppa's own pipeline (`pipeline.ts`: cutting, order of calls, streaming,
 * cancel, checks, quoting) over whichever {@link TextEngine} the caller has: the fake one in CI,
 * the llama-server one on a person's computer. A pipeline stop that a person can be told about
 * becomes the coordinator's {@link AiError}.
 */
export async function runTextTask(
  engine: TextEngine,
  task: TextTask,
  onEvent: (event: EngineEvent) => void,
  signal: AbortSignal,
): Promise<RunResult> {
  try {
    const outcome = await runJob(
      engine,
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

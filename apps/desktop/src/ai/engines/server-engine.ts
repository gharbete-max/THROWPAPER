import { isTextTask, type AiTask } from '@tp/shared/ai';
import {
  AiError,
  type Engine,
  type EngineEvent,
  type EngineFiles,
  type RunResult,
} from '../engine.js';
import {
  DEFAULT_SETTINGS,
  chooseThreads,
  startServer,
  type RunningServer,
  type ServerSettings,
  type SpawnFn,
} from '../server/llama-server.js';
import { createServerTextEngine } from '../server/server-text-engine.js';
import { runTextTask } from '../text/run-text-task.js';
import type { TextEngine } from '../text/text-engine.js';

/**
 * The engine: a supervised `llama-server` running Qwen2.5-VL-7B-Instruct on the CPU (ADR 0025).
 * It replaces both `NodeLlamaEngine` (text) and the empty seam that was waiting for vision.
 *
 * - `load` starts the pinned program with the model and its projector and waits until it answers
 *   its health check. It first refuses a computer that cannot hold the model: under about 12 GB of
 *   memory in all, `too-little-memory`, stated plainly because a 7B model on an 8 GB laptop would
 *   swap and freeze it rather than run.
 * - `run` sends a text task through Loppa's own pipeline over the server's chat API. Reading a
 *   page from a picture (`read-page`) is Phase 3's pipeline and is still `not-available`.
 * - `dispose` kills the process and waits for it to go. That is how memory comes back.
 *
 * The coordinator's contract holds: one engine alive, loaded only after its files were hashed,
 * disposed before another model loads.
 */
export const MIN_TOTAL_MEMORY_BYTES = 11_500_000_000; // "12 GB" computers report 11.7 to 12.9 GB

export type ProjectorChoice = 'auto' | 'full' | 'lite';

/** Free memory under which `auto` takes the lighter projector, when there is one. */
export const LOW_FREE_MEMORY_BYTES = 11_000_000_000;

/**
 * Which projector to load (ADR 0025). The f16 one is preferred; the Q8_0 one (853 MB against 1.35 GB)
 * is used when the person chose 'lighter' or, on 'auto', when free memory is low. Whichever exists
 * when only one does.
 */
export function pickProjector(
  files: EngineFiles,
  choice: ProjectorChoice,
  freeMemory: number,
): string | undefined {
  const full = files.projector;
  const lite = files['projector-lite'];
  if (!full || !lite) return full ?? lite;
  if (choice === 'lite') return lite;
  if (choice === 'full') return full;
  return freeMemory < LOW_FREE_MEMORY_BYTES ? lite : full;
}

export interface ServerEngineDeps {
  /** The program's path; rejects with an {@link AiError} when it is missing or damaged. */
  locateRuntime(): Promise<string>;
  totalMemory(): number;
  freeMemory?(): number;
  projector?: ProjectorChoice;
  settings?: Partial<ServerSettings>;
  spawn?: SpawnFn;
  readyTimeoutMs?: number;
}

export class ServerEngine implements Engine {
  private server: RunningServer | null = null;
  private text: TextEngine | null = null;
  private busy = false;

  constructor(
    private readonly files: EngineFiles,
    private readonly deps: ServerEngineDeps,
  ) {}

  async load(signal: AbortSignal): Promise<void> {
    if (this.server) return;
    if (this.deps.totalMemory() < MIN_TOTAL_MEMORY_BYTES) {
      throw new AiError(
        'too-little-memory',
        'the on-device model needs a computer with at least 12 GB of memory',
      );
    }
    const entry = await this.deps.locateRuntime();
    const settings: ServerSettings = {
      ...DEFAULT_SETTINGS,
      threads: chooseThreads(),
      ...this.deps.settings,
    };
    const projector = pickProjector(
      this.files,
      this.deps.projector ?? 'auto',
      this.deps.freeMemory?.() ?? Infinity,
    );
    const server = await startServer({
      entry,
      files: { weights: this.files.weights, ...(projector ? { projector } : {}) },
      settings,
      ...(this.deps.spawn ? { spawn: this.deps.spawn } : {}),
      ...(this.deps.readyTimeoutMs ? { readyTimeoutMs: this.deps.readyTimeoutMs } : {}),
      signal,
    });
    this.server = server;
    this.text = createServerTextEngine(server.connection);
  }

  async run(
    task: AiTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const server = this.server;
    if (!server || !this.text) throw new AiError('not-installed');
    if (!isTextTask(task)) throw new AiError('not-available');
    if (this.busy) throw new AiError('busy');
    this.busy = true;
    try {
      return await runTextTask(this.text, task, onEvent, signal);
    } catch (error) {
      // A server that is gone cannot answer: the coordinator drops an engine that cannot carry on.
      if (!(error instanceof AiError) && !signal.aborted && (await server.exitedWithin(500))) {
        throw new AiError('cannot-start', 'llama-server ended');
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.text = null;
    await server?.kill();
  }
}

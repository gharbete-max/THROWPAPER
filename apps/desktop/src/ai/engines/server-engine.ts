import { isTextTask, type AiTask, type GraphicsFailure } from '@tp/shared/ai';
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
import { MIN_FREE_MIB, listDevices, type GpuDevice } from '../server/gpu.js';
import { createServerTextEngine } from '../server/server-text-engine.js';
import { runTextTask } from '../text/run-text-task.js';
import { readPage } from '../vision/read-page.js';
import type { TextEngine } from '../text/text-engine.js';

/**
 * The engine: a supervised `llama-server` running Qwen2.5-VL-7B-Instruct on the CPU, or on the graphics card when the person chose it (ADR 0025).
 * It replaces both `NodeLlamaEngine` (text) and the empty seam that was waiting for vision.
 *
 * - `load` starts the pinned program with the model and its projector and waits until it answers
 *   its health check. It first refuses a computer that cannot hold the model: under about 12 GB of
 *   memory in all, `too-little-memory`, stated plainly because a 7B model on an 8 GB laptop would
 *   swap and freeze it rather than run.
 * - `run` sends a text task through Loppa's own pipeline over the server's chat API, and reads a
 *   page from a picture (`read-page`, `vision/read-page.ts`) over the same server.
 * - `dispose` kills the process and waits for it to go. That is how memory comes back.
 *
 * The coordinator's contract holds: one engine alive, loaded only after its files were hashed,
 * disposed before another model loads.
 */
export const MIN_TOTAL_MEMORY_BYTES = 11_500_000_000; // "12 GB" computers report 11.7 to 12.9 GB

export type ProjectorChoice = 'auto' | 'full' | 'lite';

/**
 * Which projector to load (ADR 0025). The Q8_0 one (853 MB against 1.35 GB) is preferred when there
 * is one: on the five invented pages of the real-model suite it found the same 44 of 48 strings as
 * the f16 one, no slower, in 0.5 GB less memory (docs/plan/VISION-TUNING.md). 'full' still asks for
 * f16; whichever exists when only one does.
 */
export function pickProjector(files: EngineFiles, choice: ProjectorChoice): string | undefined {
  const full = files.projector;
  const lite = files['projector-lite'];
  if (!full || !lite) return full ?? lite;
  return choice === 'full' ? full : lite;
}

/**
 * The optional graphics card (ADR 0025, docs/plan/VISION-TUNING.md §5). The engine asks; the shell
 * answers from the person's setting and the remembered failures. A card that does not work never
 * fails a task: the processor takes over, once, and the failure is remembered so the next task does
 * not try again (the person can clear it).
 */
export interface GpuHook {
  /** The Vulkan program's path when the setting is on, its files are whole and no failure is remembered; else null. */
  entry(): Promise<string | null>;
  /** The program's own list of devices; defaults to `llama-server --list-devices`. */
  devices?(entry: string): Promise<GpuDevice[]>;
  failed(reason: GraphicsFailure): void | Promise<void>;
  /** What the model runs on now; `null` when it is released. */
  ranOn(on: 'processor' | 'graphics' | null, device: string | null): void;
}

export interface ServerEngineDeps {
  /** The program's path; rejects with an {@link AiError} when it is missing or damaged. */
  locateRuntime(): Promise<string>;
  totalMemory(): number;
  /** Total memory under which this model is not loaded; the default suits the 7B model. */
  minTotalMemory?: number;
  projector?: ProjectorChoice;
  settings?: Partial<ServerSettings>;
  gpu?: GpuHook;
  spawn?: SpawnFn;
  readyTimeoutMs?: number;
}

export class ServerEngine implements Engine {
  private server: RunningServer | null = null;
  private text: TextEngine | null = null;
  private busy = false;
  /** The running server uses the graphics card, and has not yet answered a task. */
  private onCard = false;
  private proven = false;

  constructor(
    private readonly files: EngineFiles,
    private readonly deps: ServerEngineDeps,
  ) {}

  private async start(
    entry: string,
    extra: Partial<ServerSettings>,
    signal: AbortSignal,
  ): Promise<RunningServer> {
    const settings: ServerSettings = {
      ...DEFAULT_SETTINGS,
      threads: chooseThreads(),
      ...this.deps.settings,
      ...extra,
    };
    const projector = pickProjector(this.files, this.deps.projector ?? 'auto');
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
    return server;
  }

  /** The card, if the setting is on and it works. False means: use the processor (the failure, if any, is remembered). */
  private async tryCard(signal: AbortSignal): Promise<boolean> {
    const gpu = this.deps.gpu;
    const entry = (await gpu?.entry().catch(() => null)) ?? null;
    if (!gpu || !entry) return false;
    const [device] = await (gpu.devices ?? listDevices)(entry).catch(() => []);
    if (!device) {
      await gpu.failed('no-device');
      return false;
    }
    // A card that a game is using right now: the processor this time, no failure to remember.
    if (device.freeMiB < MIN_FREE_MIB) return false;
    try {
      const server = await this.start(entry, { device: device.id }, signal);
      // The program fits the model into the free memory itself; nothing fitting is the same as a busy card.
      if (server.offloaded?.layers === 0) {
        await this.dispose();
        return false;
      }
      this.onCard = true;
      gpu.ranOn('graphics', device.name);
      return true;
    } catch (error) {
      if (signal.aborted || (error instanceof AiError && error.problem === 'cancelled'))
        throw error;
      await gpu.failed(
        error instanceof AiError && error.problem === 'too-little-memory'
          ? 'out-of-memory'
          : 'start-failed',
      );
      return false;
    }
  }

  async load(signal: AbortSignal): Promise<void> {
    if (this.server) return;
    if (this.deps.totalMemory() < (this.deps.minTotalMemory ?? MIN_TOTAL_MEMORY_BYTES)) {
      throw new AiError(
        'too-little-memory',
        'this computer has too little memory for the chosen model; a lighter one can be chosen',
      );
    }
    if (await this.tryCard(signal)) return;
    await this.start(await this.deps.locateRuntime(), {}, signal);
    this.deps.gpu?.ranOn('processor', null);
  }

  async run(
    task: AiTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    if (!this.server || !this.text) throw new AiError('not-installed');
    if (this.busy) throw new AiError('busy');
    this.busy = true;
    let wrote = false;
    const seen = (event: EngineEvent) => {
      if (event.kind === 'text') wrote = true;
      onEvent(event);
    };
    try {
      try {
        const result = await this.runHere(task, seen, signal);
        this.proven = true;
        return result;
      } catch (error) {
        const cancelled =
          signal.aborted || (error instanceof AiError && error.problem === 'cancelled');
        if (!this.onCard || this.proven || cancelled) throw error;
        // The first request on the card failed: the processor answers it instead.
        await this.dispose();
        await this.start(await this.deps.locateRuntime(), {}, signal);
        if (wrote) onEvent({ kind: 'text', mode: 'replace', text: '' });
        const result = await this.runHere(task, onEvent, signal);
        // Only now is it the card's fault: had the processor failed too, the task was at fault.
        await this.deps.gpu?.failed('request-failed');
        this.deps.gpu?.ranOn('processor', null);
        return result;
      }
    } finally {
      this.busy = false;
    }
  }

  private async runHere(
    task: AiTask,
    onEvent: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const server = this.server;
    if (!server || !this.text) throw new AiError('not-installed');
    try {
      return isTextTask(task)
        ? await runTextTask(this.text, task, onEvent, signal)
        : await readPage(server.connection, task, onEvent, signal);
    } catch (error) {
      // A server that is gone cannot answer: the coordinator drops an engine that cannot carry on.
      if (!(error instanceof AiError) && !signal.aborted && (await server.exitedWithin(500))) {
        throw new AiError('cannot-start', 'llama-server ended');
      }
      throw error;
    }
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.text = null;
    this.onCard = false;
    this.proven = false;
    this.deps.gpu?.ranOn(null, null);
    await server?.kill();
  }
}

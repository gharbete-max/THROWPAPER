import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import { TEXT_MODEL, type AiEvent } from '@tp/shared/ai';
import type { ModelEvent } from '@tp/shared/summary';
import { ResultCache } from './cache.js';
import { createCoordinator, type Coordinator } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';
import { NodeLlamaEngine, type WorkerHandle } from './engines/node-llama-engine.js';
import { createModelAdapter, type ModelService } from './model-adapter.js';
import type { FromWorker } from './text/worker-core.js';

/**
 * Builds the coordinator and the `window.loppaModel` adapter with Electron's pieces, handed in so
 * this file stays testable.
 *
 * `LOPPA_FAKE_MODEL=1` swaps the real text engine for the fake one in this process: the same
 * pipeline, the same coordinator, no file and no 2.5 GB. It is for CI and demos of the pane; the
 * hosted edition never has any of this.
 *
 * `LOPPA_AI_DIR` and a development checkout's `local-models/` and root are read by the coordinator
 * (`resolve.ts`); `repoRoot` is null in a packaged app, which is what switches the two dev tiers off.
 */
export interface ElectronPieces {
  /** `utilityProcess.fork`, bound to the worker file. */
  fork(modulePath: string): {
    postMessage(message: unknown): void;
    on(event: 'message', listener: (message: unknown) => void): void;
    on(event: 'exit', listener: () => void): void;
    kill(): boolean;
  };
  chooseFile(): Promise<string | null>;
  userData: string;
  /** Where `model/worker.mjs` is: the resources folder. */
  resources: string;
  /** The checkout in an unpackaged build; null when packaged. */
  repoRoot: string | null;
  emit(event: AiEvent): void;
  emitLegacy(event: ModelEvent): void;
  env: NodeJS.ProcessEnv;
}

export interface ShellAi {
  coordinator: Coordinator;
  /** `window.loppaModel`, answered by the coordinator. */
  model: ModelService;
}

export function createShellAi(pieces: ElectronPieces): ShellAi {
  const fake = pieces.env.LOPPA_FAKE_MODEL === '1';

  const spawn = (): WorkerHandle => {
    const child = pieces.fork(join(pieces.resources, 'model', 'worker.mjs'));
    return {
      post: (m) => child.postMessage(m),
      onMessage: (l) => child.on('message', (m) => l(m as FromWorker)),
      onExit: (l) => child.on('exit', l),
      kill: () => void child.kill(),
    };
  };

  const dir = join(pieces.userData, 'models');
  // A developer's own copy of the weights: `LOPPA_MODEL_PATH=C:\path\model.gguf` is remembered
  // as if it had been opened from disk. It is still hashed against the manifest before use.
  if (pieces.env.LOPPA_MODEL_PATH) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'locations.json'),
      JSON.stringify({ files: { [TEXT_MODEL.files[0]!.name]: pieces.env.LOPPA_MODEL_PATH } }),
    );
  }

  const coordinator = createCoordinator({
    engines: {
      [TEXT_MODEL.id]: fake
        ? () => new FakeEngine({ behaviour: { delayMs: 15 } })
        : (files) => new NodeLlamaEngine(spawn, files.weights),
      // The vision models have no engine until Phase 3 (docs/plan/AI-SYSTEM.md): "not available yet".
    },
    dir,
    env: pieces.env,
    repoRoot: pieces.repoRoot,
    freeMemory: freemem,
    chooseFile: pieces.chooseFile,
    fetch: (input, init) => fetch(input, init),
    cache: new ResultCache(join(pieces.userData, 'ai-cache', 'index.json')),
    fake,
  });
  coordinator.onEvent(pieces.emit);
  return { coordinator, model: createModelAdapter(coordinator, { emit: pieces.emitLegacy }) };
}

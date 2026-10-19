import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { LLAMA_SERVER, TEXT_MODEL, type AiEvent } from '@tp/shared/ai';
import type { ModelEvent } from '@tp/shared/summary';
import { ResultCache } from './cache.js';
import { createCoordinator, type Coordinator } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';
import { ServerEngine } from './engines/server-engine.js';
import { createModelAdapter, type ModelService } from './model-adapter.js';
import { createRuntimeChecker } from './runtime.js';

/**
 * Builds the coordinator and the `window.loppaModel` adapter with Electron's pieces, handed in so
 * this file stays testable.
 *
 * `LOPPA_FAKE_MODEL=1` swaps the real engine for the fake one in this process: the same
 * pipeline, the same coordinator, no file and no 6 GB. It is for CI and demos of the pane; the
 * hosted edition never has any of this.
 *
 * The real engine is a supervised `llama-server` (ADR 0025). Its settings, until the Settings window
 * has a place for them: `LOPPA_AI_CTX` (context tokens) and `LOPPA_AI_THREADS`, `LOPPA_AI_PROJECTOR` (full, lite or auto).
 *
 * `LOPPA_AI_DIR` and a development checkout's `local-models/` and root are read by the coordinator
 * (`resolve.ts`); `repoRoot` is null in a packaged app, which is what switches the two dev tiers off.
 */
export interface ElectronPieces {
  chooseFile(): Promise<string | null>;
  userData: string;
  /** The resources folder: the AI pack is `ai-pack` beside the app in it. */
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

  const packDir = join(pieces.resources, 'ai-pack');
  const runtime = createRuntimeChecker({
    manifest: LLAMA_SERVER,
    context: () => ({
      env: pieces.env,
      repoRoot: pieces.repoRoot,
      packDir,
      userDataModels: dir,
      remembered: {},
    }),
  });
  const settings = () => {
    const number = (name: string) => Number(pieces.env[name]) || undefined;
    const contextTokens = number('LOPPA_AI_CTX');
    const threads = number('LOPPA_AI_THREADS');
    return {
      ...(contextTokens ? { contextTokens } : {}),
      ...(threads ? { threads } : {}),
    };
  };

  const projectorChoice = () => {
    const v = pieces.env.LOPPA_AI_PROJECTOR;
    return v === 'full' || v === 'lite' ? v : 'auto';
  };

  const coordinator = createCoordinator({
    engines: {
      [TEXT_MODEL.id]: fake
        ? () => new FakeEngine({ behaviour: { delayMs: 15 } })
        : (files) =>
            new ServerEngine(files, {
              locateRuntime: runtime.entry,
              totalMemory: totalmem,
              freeMemory: freemem,
              projector: projectorChoice(),
              settings: settings(),
            }),
    },
    dir,
    env: pieces.env,
    repoRoot: pieces.repoRoot,
    packDir,
    runtimeStatus: fake ? () => Promise.resolve(null) : runtime.status,
    freeMemory: freemem,
    chooseFile: pieces.chooseFile,
    fetch: (input, init) => fetch(input, init),
    cache: new ResultCache(join(pieces.userData, 'ai-cache', 'index.json')),
    fake,
  });
  coordinator.onEvent(pieces.emit);
  return { coordinator, model: createModelAdapter(coordinator, { emit: pieces.emitLegacy }) };
}

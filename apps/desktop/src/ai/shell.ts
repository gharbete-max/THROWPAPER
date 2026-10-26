import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  LLAMA_SERVER,
  MODEL_REGISTRY,
  TEXT_MODEL,
  minTotalMemoryBytes,
  type AddonsEvent,
  type AiEvent,
} from '@tp/shared/ai';
import type { ModelEvent } from '@tp/shared/summary';
import { createAddons, type Addons } from '../addons/addons.js';
import { ResultCache } from './cache.js';
import { createCoordinator, type Coordinator } from './coordinator.js';
import { FakeEngine } from './engines/fake-engine.js';
import type { EngineFiles } from './engine.js';
import { ServerEngine } from './engines/server-engine.js';
import { createModelAdapter, type ModelService } from './model-adapter.js';
import { createGraphics } from './graphics.js';
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
  /** Add-ons and updates (`window.loppaAddons`). */
  addons: {
    version: string;
    /** The Windows portable program, which is replaced and not installed over. */
    portable: boolean;
    downloads: string;
    openPath(path: string): Promise<string>;
    emit(event: AddonsEvent): void;
  };
  env: NodeJS.ProcessEnv;
}

export interface ShellAi {
  coordinator: Coordinator;
  /** `window.loppaModel`, answered by the coordinator. */
  model: ModelService;
  /** `window.loppaAddons`. */
  addons: Addons;
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
  const graphics = fake
    ? undefined
    : createGraphics({
        dir,
        context: () => ({
          env: pieces.env,
          repoRoot: pieces.repoRoot,
          packDir,
          userDataModels: dir,
          remembered: {},
        }),
      });
  const settings = () => {
    // A whole number in a sane range, or ignored: the values become arguments of the program.
    const number = (name: string, min: number, max: number) => {
      const value = Number(pieces.env[name]);
      return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
    };
    const contextTokens = number('LOPPA_AI_CTX', 512, 131_072);
    const threads = number('LOPPA_AI_THREADS', 1, 64);
    return {
      ...(contextTokens ? { contextTokens } : {}),
      ...(threads ? { threads } : {}),
    };
  };

  const projectorChoice = () => {
    const v = pieces.env.LOPPA_AI_PROJECTOR;
    return v === 'full' || v === 'lite' ? v : 'auto';
  };

  let addonsBusy = (): boolean => false;
  const coordinator = createCoordinator({
    // One engine factory per catalogue model; only one is ever alive (the coordinator's lock).
    engines: Object.fromEntries(
      MODEL_REGISTRY.map((model) => [
        model.id,
        fake
          ? () => new FakeEngine({ behaviour: { delayMs: 15 } })
          : (files: EngineFiles) =>
              new ServerEngine(files, {
                locateRuntime: runtime.entry,
                totalMemory: totalmem,
                minTotalMemory: minTotalMemoryBytes(model),
                projector: projectorChoice(),
                settings: settings(),
                ...(graphics ? { gpu: graphics.hook } : {}),
              }),
      ]),
    ),
    dir,
    env: pieces.env,
    repoRoot: pieces.repoRoot,
    packDir,
    runtimeStatus: fake ? () => Promise.resolve(null) : runtime.status,
    ...(graphics ? { graphics } : {}),
    freeMemory: freemem,
    totalMemory: totalmem,
    chooseFile: pieces.chooseFile,
    fetch: (input, init) => fetch(input, init),
    cache: new ResultCache(join(pieces.userData, 'ai-cache', 'index.json')),
    // An add-on being fetched is an activity the models must not start beside (and the reverse).
    busy: () => addonsBusy(),
    fake,
  });
  coordinator.onEvent(pieces.emit);
  const addons = createAddons({
    version: pieces.addons.version,
    platform: process.platform,
    arch: process.arch,
    portable: pieces.addons.portable,
    dir,
    downloads: pieces.addons.downloads,
    models: { status: coordinator.status, busy: () => coordinator.state().activity !== 'idle' },
    runtime,
    fetch: (input, init) => fetch(input, init),
    openPath: pieces.addons.openPath,
    emit: pieces.addons.emit,
  });
  addonsBusy = () => addons.working();
  return {
    coordinator,
    model: createModelAdapter(coordinator, { emit: pieces.emitLegacy }),
    addons,
  };
}

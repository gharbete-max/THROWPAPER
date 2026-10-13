import { freemem } from 'node:os';
import { join } from 'node:path';
import { createModelService, type ModelService, type WorkerHandle } from './service.js';
import { FakeEngine } from './fake-engine.js';
import { createWorker, type FromWorker, type ToWorker } from './worker-core.js';
import type { ModelEvent } from '@tp/shared/summary';

/**
 * Builds the model service with Electron's pieces, handed in so this file stays testable.
 *
 * `LOPPA_FAKE_MODEL=1` swaps the real worker for the fake engine in this process: the same
 * messages, the same service, no file and no 2.5 GB. It is for CI and demos of the pane; the
 * hosted edition never has any of this.
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
  emit(event: ModelEvent): void;
  env: NodeJS.ProcessEnv;
}

export function createShellModelService(pieces: ElectronPieces): ModelService {
  const fake = pieces.env.LOPPA_FAKE_MODEL === '1';

  const spawn = (): WorkerHandle => {
    if (fake) {
      const listeners: Array<(m: FromWorker) => void> = [];
      const handle = createWorker({ post: (m) => listeners.forEach((l) => l(m)) }, () =>
        Promise.resolve(new FakeEngine({ delayMs: 15 })),
      );
      return {
        post: (m: ToWorker) => void handle(m),
        onMessage: (l) => listeners.push(l),
        onExit: () => undefined,
        kill: () => undefined,
      };
    }
    const child = pieces.fork(join(pieces.resources, 'model', 'worker.mjs'));
    return {
      post: (m) => child.postMessage(m),
      onMessage: (l) => child.on('message', (m) => l(m as FromWorker)),
      onExit: (l) => child.on('exit', l),
      kill: () => void child.kill(),
    };
  };

  return createModelService({
    dir: join(pieces.userData, 'models'),
    spawn,
    freeMemory: freemem,
    chooseFile: pieces.chooseFile,
    fetch: (input, init) => fetch(input, init),
    emit: pieces.emit,
    fake,
  });
}

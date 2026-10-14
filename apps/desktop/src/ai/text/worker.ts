/**
 * The model process: an Electron `utilityProcess` entry (ADR 0023 section 1, ADR 0016).
 *
 * Bundled by `scripts/build.ts` to `model/worker.mjs` beside its own `node_modules`, with
 * `node-llama-cpp` left out of the bundle and installed there. Everything of substance is in
 * `worker-core.ts`; this file only connects it to the parent's message port.
 */
import { loadLlamaEngine } from './llama-engine.js';
import { createWorker, type FromWorker, type ToWorker } from './worker-core.js';

// `process.parentPort` exists in an Electron utility process and nowhere else.
const parent = (
  process as unknown as {
    parentPort?: {
      postMessage(message: unknown): void;
      on(event: 'message', listener: (event: { data: unknown }) => void): void;
    };
  }
).parentPort;

if (!parent) throw new Error('model/worker.mjs runs as an Electron utility process');

const onMessage = createWorker(
  { post: (message: FromWorker) => parent.postMessage(message) },
  (path) => loadLlamaEngine(path),
);

parent.on('message', (event) => {
  void onMessage(event.data as ToWorker);
});

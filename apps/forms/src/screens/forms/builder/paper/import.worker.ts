import { readDocument } from './pipeline.js';
import type { ReadRequest } from './reading.js';

/**
 * The import's stages 2 and 3, off the page's thread (`IMPORT-PIPELINE.md`: stages 2–7 run in a
 * Web Worker). One request, one answer; `read-in-worker.ts` ends the worker after it, or after the
 * hard stop.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<ReadRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    scope.postMessage({ ok: true, reading: readDocument(event.data) });
  } catch (error) {
    scope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

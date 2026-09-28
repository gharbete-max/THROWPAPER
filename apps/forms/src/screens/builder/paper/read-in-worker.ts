import type { Reading, ReadRequest } from './reading.js';

/**
 * Runs the import's stages in a Web Worker, so a long document never freezes the page, with the
 * hard stop `IMPORT-PIPELINE.md` sets: 30 seconds, then the worker is ended and the author is told.
 * Where there is no `Worker` (a test, an old engine) it runs on the page instead — the same
 * function, so the same result.
 */

export const READ_TIMEOUT_MS = 30_000;

export class ReadingTooSlow extends Error {
  constructor() {
    super('Reading took longer than the hard stop');
    this.name = 'ReadingTooSlow';
  }
}

type Answer = { ok: true; reading: Reading } | { ok: false; message: string };

export async function readInWorker(
  request: ReadRequest,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<Reading> {
  if (typeof Worker === 'undefined') {
    const { readDocument } = await import('./pipeline.js');
    return readDocument(request);
  }
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Reading>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new ReadingTooSlow());
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<Answer>) => {
      done();
      if (event.data.ok) resolve(event.data.reading);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || 'The reader stopped'));
    };
    worker.postMessage(request);
  });
}

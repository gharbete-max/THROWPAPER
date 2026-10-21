import type { Reading, ReadRequest } from './reading.js';

/**
 * Runs the import's stages in a Web Worker, so a long document never freezes the page, with the
 * hard stop `IMPORT-PIPELINE.md` sets: 30 seconds, then the worker is ended and the author is told.
 *
 * Only in a worker. The stages and their word lists in twelve languages are the largest thing the
 * paper door loads, and every browser Loppa supports, and the desktop, has module workers — so a
 * second copy on the page would be downloaded by nobody and paid for by the bundle (S10). Without
 * a worker the author is told this browser cannot read documents, never left waiting. Tests run
 * the same function, `readDocument`, directly.
 */

export const READ_TIMEOUT_MS = 30_000;

export class ReadingTooSlow extends Error {
  constructor() {
    super('Reading took longer than the hard stop');
    this.name = 'ReadingTooSlow';
  }
}

/** No `Worker` here: the stages run nowhere else. */
export class NoWorker extends Error {
  constructor() {
    super('This engine has no Web Worker to read documents in');
    this.name = 'NoWorker';
  }
}

type Answer = { ok: true; reading: Reading } | { ok: false; message: string };

export async function readInWorker(
  request: ReadRequest,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<Reading> {
  if (typeof Worker === 'undefined') throw new NoWorker();
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

import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

/**
 * A PDF somebody uploaded is parsed once, **off the main thread and on a budget**, before anything
 * else touches it.
 *
 * pdf-lib inflates every object stream when it loads a document. A file of a few megabytes can
 * declare hundreds of thousands of objects in a compressed stream; measured in Sign, a 2.9 MB file
 * held the event loop for 7.2 s and a 10.8 MB one for 25.7 s. Here that file is a form's paper
 * (`documents/paper.ts` loads it on every filled-in copy), so it is checked once, on upload.
 *
 * So the first parse runs in a worker thread with a deadline, and a heap cap as a second line. The
 * deadline is what stops this bomb: inflated streams live outside the JS heap, so the cap does not
 * catch it (measured). A worker that misses the deadline or dies is terminated and the file refused; the main thread only ever loads bytes that
 * have already parsed within budget. The same few lines live in `apps/api-sign` — the products do
 * not import each other (CLAUDE.md rule 1).
 */
export interface PdfBudget {
  /** Wall-clock limit for the trial parse. */
  timeoutMs: number;
  /** Heap limit for the worker, in MB. */
  heapMb: number;
}

export const DEFAULT_PDF_BUDGET: PdfBudget = { timeoutMs: 5_000, heapMb: 256 };

export type PdfCheck =
  | { ok: true; pages: number }
  /** Not a PDF pdf-lib can open, or one with no pages. */
  | { ok: false; reason: 'unreadable' }
  /** Would cost more than the budget to open. */
  | { ok: false; reason: 'too-costly' };

/** CommonJS, evaluated in the worker: load, count pages, report. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { PDFDocument } = require(workerData.pdfLib);
PDFDocument.load(workerData.bytes, { updateMetadata: false, ignoreEncryption: true })
  .then((pdf) => parentPort.postMessage({ ok: true, pages: pdf.getPageCount() }))
  .catch(() => parentPort.postMessage({ ok: false }));
`;

const pdfLibPath = createRequire(import.meta.url).resolve('pdf-lib');

export function checkPdf(
  bytes: Uint8Array,
  budget: PdfBudget = DEFAULT_PDF_BUDGET,
): Promise<PdfCheck> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { bytes, pdfLib: pdfLibPath },
      resourceLimits: { maxOldGenerationSizeMb: budget.heapMb, maxYoungGenerationSizeMb: 32 },
    });
    const finish = (result: PdfCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'too-costly' }), budget.timeoutMs);
    worker.on('message', (message: { ok: boolean; pages?: number }) => {
      finish(
        message.ok && (message.pages ?? 0) > 0
          ? { ok: true, pages: message.pages! }
          : { ok: false, reason: 'unreadable' },
      );
    });
    // Out of heap arrives as an error (ERR_WORKER_OUT_OF_MEMORY): the file cost too much.
    worker.on('error', () => finish({ ok: false, reason: 'too-costly' }));
    worker.on('exit', () => finish({ ok: false, reason: 'too-costly' }));
  });
}

import { pasteDocument, readLayout, reassemble } from '@tp/shared/import';
import type { Reading, ReadRequest } from './reading.js';

/**
 * Stages 2 to 7 of the import — `IMPORT-PIPELINE.md` — as one call, the same in the worker
 * (`import.worker.ts`) and, where there is no worker, on the page. What comes back is plain data:
 * the layout document, the lists found in it, what each part of it is, what each question's answer
 * is likely to be, how sure each of those is, and each stage's debug artifact. None of it is ever
 * sent to the server (`CAVEATS.md` #43); the author may download it.
 */
export function readDocument(request: ReadRequest): Reading {
  if (request.kind === 'paste') {
    // A paste has no stage 2 to run: its layout is built already reassembled (`paste.ts`).
    const layout = pasteDocument(request.text);
    return { layout, ...readLayout(layout) };
  }
  const assembled = reassemble(request.raw);
  const read = readLayout(assembled.output, { fields: request.fields ?? [] });
  return { layout: assembled.output, ...read, debug: [assembled.debug, ...read.debug] };
}

import { enumerate, pasteDocument, reassemble } from '@tp/shared/import';
import type { Reading, ReadRequest } from './reading.js';

/**
 * Stages 2 and 3 of the import — `IMPORT-PIPELINE.md` — as one call, the same in the worker
 * (`import.worker.ts`) and, where there is no worker, on the page. What comes back is plain data:
 * the layout document, the lists found in it, and each stage's debug artifact. None of it is ever
 * sent to the server (`CAVEATS.md` #43); the author may download it.
 */

export function readDocument(request: ReadRequest): Reading {
  if (request.kind === 'paste') {
    // A paste has no stage 2 to run: its layout is built already reassembled (`paste.ts`).
    const layout = pasteDocument(request.text);
    const listed = enumerate(layout);
    return { layout, lists: listed.output, debug: [listed.debug] };
  }
  const assembled = reassemble(request.raw);
  const listed = enumerate(assembled.output);
  return { layout: assembled.output, lists: listed.output, debug: [assembled.debug, listed.debug] };
}

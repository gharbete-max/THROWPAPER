/**
 * Why a Word document was not read — `docs/plan/IMPORT-PIPELINE.md`, "Caps". A document is
 * untrusted input: every limit is checked while reading, and a refusal says which one, never
 * "something went wrong". `reason` picks the sentence the author sees; `detail` names the exact
 * limit for the tests and the debug view.
 */
export type DocxRefusal = 'too-large' | 'unreadable' | 'too-complex' | 'unsafe' | 'protected';

export class DocxRefused extends Error {
  constructor(
    readonly reason: DocxRefusal,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'DocxRefused';
  }
}

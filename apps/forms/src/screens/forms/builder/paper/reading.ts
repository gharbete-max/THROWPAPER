import type { FormFieldBox, LayoutDocument, LayoutReading, RawDocument } from '@tp/shared/import';

/**
 * What the import's stages read, as plain data — the shape `pipeline.ts` produces, in the worker
 * or on the page. Its own module, of types and one formatter, so that showing a reading never
 * pulls the stages themselves into the page's chunk: they load only in the worker.
 */

/** A PDF's own form fields go with its text, so that they beat it (`CAVEATS.md` #54). */
export type ReadRequest =
  { kind: 'raw'; raw: RawDocument; fields?: FormFieldBox[] } | { kind: 'paste'; text: string };

/** Stages 3–7 of `@tp/shared/import`, with the layout document they read. */
export interface Reading extends LayoutReading {
  layout: LayoutDocument;
}

/** What the author downloads: everything that was read, and how, as one JSON file. */
export function readingFile(reading: Reading): string {
  return `${JSON.stringify({ readingVersion: 2, ...reading }, null, 2)}\n`;
}

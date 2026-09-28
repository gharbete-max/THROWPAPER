import type { EnumerateResult, LayoutDocument, RawDocument, StageDebug } from '@tp/shared/import';

/**
 * What the import's stages read, as plain data — the shape `pipeline.ts` produces, in the worker
 * or on the page. Its own module, of types and one formatter, so that showing a reading never
 * pulls the stages themselves into the page's chunk: they load only in the worker.
 */

export type ReadRequest = { kind: 'raw'; raw: RawDocument } | { kind: 'paste'; text: string };

export interface Reading {
  layout: LayoutDocument;
  lists: EnumerateResult;
  /** One artifact per stage that ran, in order. */
  debug: StageDebug[];
}

/** What the author downloads: everything that was read, and how, as one JSON file. */
export function readingFile(reading: Reading): string {
  return `${JSON.stringify({ readingVersion: 1, ...reading }, null, 2)}\n`;
}

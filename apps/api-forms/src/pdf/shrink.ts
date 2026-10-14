import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';
import { openChecked } from './arrange.js';

/**
 * A PDF made smaller without changing what it shows ("Make smaller" in Send): every object nothing
 * points to is dropped (an editor's leftovers, an old revision's pages), and the rest is written
 * again with object streams, which pack the many small objects of a long document into
 * compressed ones. Pages, text, fields and links are untouched; images are not recompressed, so a
 * PDF made of photographs gains little. The original is returned when nothing was gained.
 *
 * Same door as page work (`openChecked`): encrypted, signed (a rewrite breaks the signature, so
 * it is refused as `signed` rather than quietly changed) and unreadable files are refused.
 */
export async function shrinkPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await openChecked(bytes, 0);
  const { context } = doc;

  const reachable = new Set<string>();
  const todo: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter(
    (object): object is PDFObject => object !== undefined,
  );
  while (todo.length > 0) {
    const object = todo.pop()!;
    if (object instanceof PDFRef) {
      if (reachable.has(object.tag)) continue;
      reachable.add(object.tag);
      const target = context.lookup(object);
      if (target) todo.push(target);
    } else if (object instanceof PDFDict) todo.push(...object.values());
    else if (object instanceof PDFArray) todo.push(...object.asArray());
    else if (object instanceof PDFStream) todo.push(object.dict);
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) context.delete(ref);
  }

  const saved = await doc.save({ useObjectStreams: true });
  return saved.length < bytes.length ? saved : bytes;
}

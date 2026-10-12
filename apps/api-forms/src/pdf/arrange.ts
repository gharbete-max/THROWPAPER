import { degrees, EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { checkPdf } from '../uploads/pdf-guard.js';

/**
 * Page work on PDFs, as one operation.
 *
 * Merge, split, extract, rotate, reorder and delete are the same thing: the output is an ordered
 * list of (source file, page, turn). Pages named are kept, in that order; pages not named are
 * deleted; a page may be named twice. Nothing here is stored and no row is written.
 *
 * Every input is parsed once by `checkPdf` (a worker with a deadline) before this thread opens it,
 * because pdf-lib inflates a whole PDF when it loads one (`uploads/pdf-guard.ts`).
 */

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Steps in a plan, which is also the page count of the output. */
export const MAX_STEPS = 500;

export interface ArrangeStep {
  /** Index into the files, from 0. */
  file: number;
  /** Page within that file, from 0. */
  page: number;
  /** A quarter turn clockwise, added to the turn the page already has. Default 0. */
  rotate?: number;
}

export type ArrangeRefusalCode =
  | 'empty-plan'
  | 'too-many-pages'
  | 'no-such-file'
  | 'no-such-page'
  | 'bad-rotation'
  | 'unreadable'
  | 'too-costly'
  | 'encrypted'
  | 'signed';

/** A reason the plan cannot be carried out, in terms the caller can show a person. */
export class ArrangeRefusal extends Error {
  constructor(
    readonly code: ArrangeRefusalCode,
    /** The file it is about, when it is about one. */
    readonly file?: number,
  ) {
    super(code);
  }
}

/** A digital signature covers exact bytes, and a rewrite changes them. `/ByteRange` marks one. */
const SIGNATURE_MARKER = Buffer.from('/ByteRange');
/**
 * An encrypted PDF names its encryption dictionary in the trailer, which is never compressed. This
 * is looked for before the file is parsed: `checkPdf` opens files with `ignoreEncryption`, so an
 * encrypted one reaches it as garbage and would be called unreadable rather than encrypted.
 */
const ENCRYPTION_MARKER = Buffer.from('/Encrypt');

export async function arrangePdf(
  files: readonly Uint8Array[],
  plan: readonly ArrangeStep[],
  options: { acceptSignatureLoss?: boolean } = {},
): Promise<Uint8Array> {
  if (plan.length === 0) throw new ArrangeRefusal('empty-plan');
  if (plan.length > MAX_STEPS) throw new ArrangeRefusal('too-many-pages');
  for (const step of plan) {
    if (!Number.isInteger(step.file) || step.file < 0 || step.file >= files.length) {
      throw new ArrangeRefusal('no-such-file', step.file);
    }
    if (![0, 90, 180, 270].includes(step.rotate ?? 0)) throw new ArrangeRefusal('bad-rotation');
  }

  // Only the files the plan uses are opened.
  const used = [...new Set(plan.map((step) => step.file))];
  const sources = new Map<number, PDFDocument>();
  for (const index of used) {
    const bytes = files[index]!;
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.includes(ENCRYPTION_MARKER)) throw new ArrangeRefusal('encrypted', index);
    const checked = await checkPdf(bytes);
    if (!checked.ok) {
      throw new ArrangeRefusal(
        checked.reason === 'too-costly' ? 'too-costly' : 'unreadable',
        index,
      );
    }
    if (!options.acceptSignatureLoss && view.includes(SIGNATURE_MARKER)) {
      throw new ArrangeRefusal('signed', index);
    }
    try {
      sources.set(index, await PDFDocument.load(bytes, { updateMetadata: false }));
    } catch (error) {
      throw new ArrangeRefusal(
        error instanceof EncryptedPDFError ? 'encrypted' : 'unreadable',
        index,
      );
    }
  }

  for (const step of plan) {
    const count = sources.get(step.file)!.getPageCount();
    if (!Number.isInteger(step.page) || step.page < 0 || step.page >= count) {
      throw new ArrangeRefusal('no-such-page', step.file);
    }
  }

  const out = await PDFDocument.create();
  for (const step of plan) {
    const [copy] = await out.copyPages(sources.get(step.file)!, [step.page]);
    if (step.rotate) {
      copy!.setRotation(degrees((copy!.getRotation().angle + step.rotate) % 360));
    }
    out.addPage(copy!);
  }
  return out.save();
}

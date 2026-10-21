import { degrees, EncryptedPDFError, PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import { checkPdf } from '../uploads/pdf-guard.js';
import { imageSize } from '../uploads/image-size.js';

/**
 * Page work on PDFs, as one operation.
 *
 * Merge, split, extract, rotate, reorder and delete are the same thing: the output is an ordered
 * list of (source file, page, turn). Pages named are kept, in that order; pages not named are
 * deleted; a page may be named twice. Nothing here is stored and no row is written.
 *
 * A source may also be a photograph (JPEG or PNG): one page, `page: 0`, laid out on A4 like a
 * scanned page (`signing/scan.ts`). A JPEG is embedded as it is, never re-encoded; the turn its
 * EXIF orientation asks for becomes the page's turn. The browser shrinks and converts anything
 * else (WebP, HEIC, giant photos) before sending. Nothing is kept.
 *
 * Every input is parsed once by `checkPdf` (a worker with a deadline) before this thread opens it,
 * because pdf-lib inflates a whole PDF when it loads one (`uploads/pdf-guard.ts`).
 */

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Steps in a plan, which is also the page count of the output. */
export const MAX_STEPS = 500;
/** What pages named more than once may cost together, counting each repeat as its whole file. */
export const MAX_REPEAT_BYTES = 64 * 1024 * 1024;
/**
 * The most pixels a photograph may claim, read from its header before anything decodes it. A phone
 * photo is 12 to 50 MP, but the screen shrinks to 2400 px on the long side (under 6 MP) before
 * sending, so this only has to stop a hand-made request: pdf-lib decodes a PNG into 4 bytes a
 * pixel, so 24 MP is about 100 MB of memory.
 */
export const MAX_IMAGE_PIXELS = 24_000_000;

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
  | 'image-too-large'
  | 'encrypted'
  | 'signed'
  // Filling a PDF's own fields (`pdf/fill.ts`) refuses with the same type, for the same routes.
  | 'no-fields'
  | 'no-such-field'
  | 'bad-value'
  | 'unencodable';

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

/**
 * One untrusted PDF, opened for editing: encryption and signature refused first (the signature
 * unless the person has agreed to lose it), then the guard's worker, then pdf-lib on this thread.
 * Shared by page work and by filling a PDF's own fields, so both treat a stranger's file alike.
 */
export async function openChecked(
  bytes: Uint8Array,
  index: number,
  acceptSignatureLoss = false,
): Promise<PDFDocument> {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.includes(ENCRYPTION_MARKER)) throw new ArrangeRefusal('encrypted', index);
  const checked = await checkPdf(bytes);
  if (!checked.ok) {
    throw new ArrangeRefusal(checked.reason === 'too-costly' ? 'too-costly' : 'unreadable', index);
  }
  if (!acceptSignatureLoss && view.includes(SIGNATURE_MARKER)) {
    throw new ArrangeRefusal('signed', index);
  }
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new ArrangeRefusal(
      error instanceof EncryptedPDFError ? 'encrypted' : 'unreadable',
      index,
    );
  }
}

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
  const images = new Set<number>();
  for (const index of used) {
    const bytes = files[index]!;
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const format = imageFormat(view);
    if (format) {
      const size = imageSize(view, format);
      if (!size || size.width < 1 || size.height < 1) throw new ArrangeRefusal('unreadable', index);
      if (size.width * size.height > MAX_IMAGE_PIXELS) {
        throw new ArrangeRefusal('image-too-large', index);
      }
      images.add(index);
      continue;
    }
    sources.set(index, await openChecked(bytes, index, options.acceptSignatureLoss));
  }

  for (const step of plan) {
    const count = images.has(step.file) ? 1 : sources.get(step.file)!.getPageCount();
    if (!Number.isInteger(step.page) || step.page < 0 || step.page >= count) {
      throw new ArrangeRefusal('no-such-page', step.file);
    }
  }

  const out = await PDFDocument.create();
  const photos = new Map<number, { image: PDFImage; turn: number }>();
  for (const index of images) {
    const bytes = files[index]!;
    const jpeg =
      imageFormat(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)) === 'jpeg';
    try {
      photos.set(index, {
        image: await (jpeg ? out.embedJpg(bytes) : out.embedPng(bytes)),
        turn: jpeg ? exifTurn(bytes) : 0,
      });
    } catch {
      throw new ArrangeRefusal('unreadable', index);
    }
  }
  // Each source's pages are copied in ONE call, in the order the plan first needs them. pdf-lib
  // copies what the pages in a call share (a font, a logo) once; a call per page copied it once
  // per page, so reordering a 100-page PDF made the file 100 times as heavy as what it shares.
  // A page the plan names again is copied again (it may be turned differently), and that second
  // copy is the price of the repeat: `repeatCost` bounds the sum of those.
  const firstCopies = new Map<string, PDFPage>();
  for (const [index, source] of sources) {
    const wanted = [
      ...new Set(plan.filter((step) => step.file === index).map((step) => step.page)),
    ];
    const copies = await out.copyPages(source, wanted);
    wanted.forEach((page, n) => firstCopies.set(`${index}:${page}`, copies[n]!));
  }
  let repeatCost = 0;
  for (const step of plan) {
    const photo = photos.get(step.file);
    if (photo) {
      // The raw picture on an A4 of its own shape; the page's turn shows it the right way up.
      const { image } = photo;
      const [width, height] =
        image.width > image.height ? [A4.long, A4.short] : [A4.short, A4.long];
      const scale = Math.min(width / image.width, height / image.height);
      const drawn = { width: image.width * scale, height: image.height * scale };
      const page = out.addPage([width, height]);
      page.drawImage(image, {
        x: (width - drawn.width) / 2,
        y: (height - drawn.height) / 2,
        ...drawn,
      });
      page.setRotation(degrees((photo.turn + (step.rotate ?? 0)) % 360));
      continue;
    }
    const key = `${step.file}:${step.page}`;
    let copy = firstCopies.get(key);
    if (copy) firstCopies.delete(key);
    else {
      // A repeat can weigh as much as the whole file (a page may hold all of its pictures).
      repeatCost += files[step.file]!.length;
      if (repeatCost > MAX_REPEAT_BYTES) throw new ArrangeRefusal('too-many-pages');
      copy = (await out.copyPages(sources.get(step.file)!, [step.page]))[0]!;
    }
    if (step.rotate) {
      copy.setRotation(degrees((copy.getRotation().angle + step.rotate) % 360));
    }
    out.addPage(copy);
  }
  return out.save();
}

/** A4 in points. */
const A4 = { short: 595.28, long: 841.89 };

/** JPEG and PNG by their first bytes; the declared type is the caller's word and proves nothing. */
export function imageFormat(bytes: Buffer): 'jpeg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  return null;
}

/**
 * The clockwise turn a JPEG's EXIF orientation asks for, read from its APP1 segment; 0 if none.
 * ponytail: mirrored values (2, 4, 5, 7) get their turn only; a mirror needs a re-encode. Rare.
 */
function exifTurn(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 < view.byteLength && view.getUint8(at) === 0xff) {
    const marker = view.getUint8(at + 1);
    const length = view.getUint16(at + 2);
    if (marker === 0xda || length < 2) break; // image data begins, or malformed
    if (marker === 0xe1 && length >= 16 && view.getUint32(at + 4) === 0x45786966) {
      const tiff = at + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 0;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries && ifd + 14 + i * 12 <= view.byteLength; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112) {
          const turns: Record<number, number> = { 3: 180, 5: 270, 6: 90, 7: 90, 8: 270 };
          return turns[view.getUint16(entry + 8, little)] ?? 0;
        }
      }
      return 0;
    }
    at += 2 + length;
  }
  return 0;
}

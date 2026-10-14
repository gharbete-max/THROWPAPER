import {
  degrees,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPageLeaf,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { imageSize } from '../uploads/image-size.js';
import { ArrangeRefusal, openChecked } from './arrange.js';
import { FontUnavailable, hexColor, TextFonts, UnsupportedText } from './text-fonts.js';

/**
 * Basic PDF text work: put words on a page, cover a patch of it, or redact for good.
 *
 * - **Add** `{page, x, y, text, size}` and **cover** `{page, rect, fill}` change how a page
 *   *looks*. Replace is a cover and then an add, in that order. A cover is paint: the words under
 *   it are still in the file and can be selected and copied. Only {@link redactPdf} removes them.
 * - **Redact** replaces whole pages by pictures the browser drew with the boxes burnt in. The page
 *   then has no text at all, so it is no longer searchable, and nothing under a box exists
 *   anywhere in the output (`redact.test` reads the output with pdf.js to prove it).
 *
 * Coordinates are PDF user space: points, origin at the lower left, pages counted from 0, as
 * pdf.js's `viewport.convertToPdfPoint` returns them. Text on a page that is turned (`/Rotate`)
 * is turned the other way so that it reads upright.
 *
 * Opened through `openChecked` (`arrange.ts`): encrypted files are refused, and signed ones unless the person
 * has agreed to losing the signature.
 */

export const MAX_OPS = 200;
export const MAX_TEXT = 500;
export const MIN_SIZE = 4;
export const MAX_SIZE = 200;
/** Pages redacted in one request, and the pixels of each page's picture. */
/** The longest a picture put on a page may be shown, in points. */
export const MAX_IMAGE_SIDE = 2000;
export const MAX_REDACTED_PAGES = 50;
export const MAX_REDACTION_PIXELS = 24_000_000;

export interface TextOp {
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
  /** `#rrggbb`. Default black. */
  color?: string;
}

export interface CoverOp {
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  /** `#rrggbb`. */
  fill: string;
}

/**
 * A picture put on a page — a saved signature, initials. `image` names one of the PNGs sent with
 * the request. `x`, `y` are the lower left of the picture *as the person sees the page*, in user
 * space like a text op's, and `width`, `height` its size as seen: a turned page turns the picture
 * the other way so that it reads upright, as text does.
 */
export interface ImageOp {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  image: string;
}

export type EditOp = TextOp | CoverOp | ImageOp;

export type EditRefusalCode =
  | 'unreadable'
  | 'too-costly'
  | 'encrypted'
  | 'signed'
  | 'no-ops'
  | 'too-many-ops'
  | 'no-such-page'
  | 'bad-op'
  | 'unsupported-glyphs'
  | 'font-unavailable'
  | 'bad-image'
  | 'image-too-large'
  | 'cannot-redact-safely';

export class EditRefusal extends Error {
  constructor(
    readonly code: EditRefusalCode,
    /** For `unsupported-glyphs` and `font-unavailable`: the characters. */
    readonly characters: string[] = [],
  ) {
    super(code);
  }
}

async function open(bytes: Uint8Array, acceptSignatureLoss: boolean | undefined) {
  try {
    return await openChecked(bytes, 0, acceptSignatureLoss);
  } catch (error) {
    // Only these four are what opening a file can say.
    if (error instanceof ArrangeRefusal) throw new EditRefusal(error.code as 'unreadable');
    throw error;
  }
}

const finite = (...numbers: number[]) => numbers.every((n) => Number.isFinite(n));

const isCover = (op: EditOp): op is CoverOp => 'rect' in op;
const isImage = (op: EditOp): op is ImageOp => 'image' in op;

export async function editPdf(
  bytes: Uint8Array,
  ops: readonly EditOp[],
  options: { acceptSignatureLoss?: boolean; images?: ReadonlyMap<string, Uint8Array> } = {},
): Promise<Uint8Array> {
  if (ops.length === 0) throw new EditRefusal('no-ops');
  if (ops.length > MAX_OPS) throw new EditRefusal('too-many-ops');
  const doc = await open(bytes, options.acceptSignatureLoss);
  const pages = doc.getPages();
  const fonts = new TextFonts(doc);

  // Everything is checked before the first mark, so a refusal never leaves half a job.
  for (const op of ops) {
    if (!Number.isInteger(op.page) || op.page < 0 || op.page >= pages.length) {
      throw new EditRefusal('no-such-page');
    }
    if (isImage(op)) {
      const png = options.images?.get(op.image);
      if (
        !png ||
        !finite(op.x, op.y, op.width, op.height) ||
        op.width <= 0 ||
        op.height <= 0 ||
        op.width > MAX_IMAGE_SIDE ||
        op.height > MAX_IMAGE_SIDE
      ) {
        throw new EditRefusal('bad-op');
      }
      checkPng(png);
    } else if (isCover(op)) {
      const { x, y, width, height } = op.rect ?? {};
      if (!finite(x!, y!, width!, height!) || width! <= 0 || height! <= 0 || !hexColor(op.fill)) {
        throw new EditRefusal('bad-op');
      }
    } else {
      const text = (op.text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
      if (
        typeof op.text !== 'string' ||
        text.trim() === '' ||
        text.length > MAX_TEXT ||
        !finite(op.x, op.y, op.size) ||
        op.size < MIN_SIZE ||
        op.size > MAX_SIZE ||
        (op.color !== undefined && !hexColor(op.color))
      ) {
        throw new EditRefusal('bad-op');
      }
      await checkText(fonts, text);
    }
  }

  const embedded = new Map<string, PDFImage>();
  for (const op of ops) {
    const page = pages[op.page]!;
    if (isImage(op)) {
      let picture = embedded.get(op.image);
      if (!picture) {
        try {
          picture = await doc.embedPng(options.images!.get(op.image)!);
        } catch {
          throw new EditRefusal('bad-image');
        }
        embedded.set(op.image, picture);
      }
      page.drawImage(picture, {
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        rotate: degrees(page.getRotation().angle),
      });
    } else if (isCover(op)) {
      page.drawRectangle({ ...op.rect, color: hexColor(op.fill)!, borderWidth: 0 });
    } else {
      await fonts.draw(page, op.text.replace(/\r\n?/g, '\n').replace(/\t/g, ' '), {
        x: op.x,
        y: op.y,
        size: op.size,
        color: hexColor(op.color ?? '#000000')!,
        angle: page.getRotation().angle,
      });
    }
  }
  return doc.save();
}

async function checkText(fonts: TextFonts, text: string): Promise<void> {
  try {
    await fonts.check(text);
  } catch (error) {
    if (error instanceof UnsupportedText) {
      throw new EditRefusal('unsupported-glyphs', error.characters);
    }
    if (error instanceof FontUnavailable)
      throw new EditRefusal('font-unavailable', error.characters);
    throw error;
  }
}

/** What the person sees of a page: its crop box, the other way round when the page is turned. */
function shownSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getCropBox();
  return page.getRotation().angle % 180 === 0
    ? { width, height }
    : { width: height, height: width };
}

/** Links to another page carry that page, and everything on it, into a copy of this one. */
function dropLinksToPages(page: PDFPage): void {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i -= 1) {
    const annot = annots.lookupMaybe(i, PDFDict);
    if (!annot) continue;
    const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
    if (annot.has(PDFName.of('Dest')) || action?.get(PDFName.of('S')) === PDFName.of('GoTo')) {
      annots.remove(i);
    }
  }
}

/**
 * Replaces pages by pictures. `redactions` names each page (from 0) and the PNG the browser drew
 * of it, boxes burnt in, in the orientation the person sees. The output is built from scratch:
 * the other pages are *copied* into a new document, so nothing that only the old pages reached —
 * their text, their fonts, a bookmark's title, the document information — travels with them.
 */
export async function redactPdf(
  bytes: Uint8Array,
  redactions: ReadonlyArray<{ page: number; image: Uint8Array }>,
  options: { acceptSignatureLoss?: boolean } = {},
): Promise<Uint8Array> {
  if (redactions.length === 0) throw new EditRefusal('no-ops');
  if (redactions.length > MAX_REDACTED_PAGES) throw new EditRefusal('too-many-ops');
  const src = await open(bytes, options.acceptSignatureLoss);
  const count = src.getPageCount();
  const byPage = new Map<number, Uint8Array>();
  for (const { page, image } of redactions) {
    if (!Number.isInteger(page) || page < 0 || page >= count) throw new EditRefusal('no-such-page');
    checkPng(image);
    byPage.set(page, image);
  }

  const kept = src.getPages();
  for (const [index, page] of kept.entries()) if (!byPage.has(index)) dropLinksToPages(page);

  const out = await PDFDocument.create();
  for (const [index, page] of kept.entries()) {
    const image = byPage.get(index);
    if (image) {
      const { width, height } = shownSize(page);
      const fresh = out.addPage([width, height]);
      try {
        fresh.drawImage(await out.embedPng(image), { x: 0, y: 0, width, height });
      } catch {
        throw new EditRefusal('bad-image');
      }
    } else {
      const [copy] = await out.copyPages(src, [index]);
      out.addPage(copy!);
    }
  }

  // The guarantee, checked rather than assumed: a page nobody asked to keep (a redacted one, reached
  // through a field's kids, say) that rode along would carry its text. Refuse, never ship it.
  const leaves = out.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFPageLeaf).length;
  if (leaves !== out.getPageCount()) throw new EditRefusal('cannot-redact-safely');
  return out.save();
}

/** The header is read before anything decodes the picture: pdf-lib inflates a PNG to 4 bytes a pixel. */
function checkPng(image: Uint8Array): void {
  const view = Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  const size = view.subarray(0, 8).equals(PNG_SIGNATURE) ? imageSize(view, 'png') : null;
  if (!size || size.width < 1 || size.height < 1) throw new EditRefusal('bad-image');
  if (size.width * size.height > MAX_REDACTION_PIXELS) throw new EditRefusal('image-too-large');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

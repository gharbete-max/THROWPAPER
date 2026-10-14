import {
  popGraphicsState,
  PDFDocument,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
  TextRenderingMode,
} from 'pdf-lib';
import type { CopyPdfRequest } from '@tp/shared/api';
import { imageSize } from '../uploads/image-size.js';
import { ArrangeRefusal, imageFormat, MAX_IMAGE_PIXELS } from './arrange.js';
import { FontUnavailable, TextFonts, UnsupportedText } from './text-fonts.js';

/**
 * A digital copy of a photographed page as a PDF (`POST /v1/pdf/copy`), drawn from what the
 * browser read and found (`@tp/shared/import`, `scan/copy.ts`); nothing here reads a picture.
 *
 * - `copy`: a white page, black lines, and every word as real text at its place. Vector and
 *   searchable; no photograph in it.
 * - `searchable`: the photograph as the page image, with the same words laid over it in text
 *   render mode 3 (neither filled nor stroked), so they can be searched and selected and the
 *   page still looks like the photograph.
 *
 * Words are set in the fonts `edit.ts` uses (`text-fonts.ts`). A character none of them can print
 * is drawn as "?" and counted, so that the person is told, never silently handed a different word.
 */
export interface CopyPdf {
  pdf: Uint8Array;
  /** Characters that could not be printed and were drawn as "?". */
  replaced: number;
}

export async function copyPdf(request: CopyPdfRequest, photo?: Uint8Array): Promise<CopyPdf> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([request.widthPt, request.heightPt]);
  const black = rgb(0, 0, 0);

  if (request.mode === 'searchable') {
    if (!photo) throw new ArrangeRefusal('unreadable');
    const view = Buffer.from(photo.buffer, photo.byteOffset, photo.byteLength);
    const format = imageFormat(view);
    const size = format ? imageSize(view, format) : null;
    if (!format || !size || size.width < 1 || size.height < 1)
      throw new ArrangeRefusal('unreadable');
    if (size.width * size.height > MAX_IMAGE_PIXELS) throw new ArrangeRefusal('image-too-large');
    let image;
    try {
      image = await (format === 'jpeg' ? doc.embedJpg(photo) : doc.embedPng(photo));
    } catch {
      throw new ArrangeRefusal('unreadable');
    }
    page.drawImage(image, { x: 0, y: 0, width: request.widthPt, height: request.heightPt });
  } else {
    for (const line of request.lines) {
      page.drawLine({
        start: { x: line.x1, y: request.heightPt - line.y1 },
        end: { x: line.x2, y: request.heightPt - line.y2 },
        thickness: line.width,
        color: black,
      });
    }
  }

  const fonts = new TextFonts(doc);
  let replaced = 0;
  // Mode 3 is part of the graphics state, so every word drawn between the two operators inherits it.
  if (request.mode === 'searchable') {
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  }
  for (const word of request.words) {
    const printable = await printableText(fonts, word.text);
    replaced += printable.replaced;
    await fonts.draw(page, printable.text, {
      x: word.x,
      y: request.heightPt - word.y,
      size: word.size,
      color: black,
      angle: 0,
    });
  }
  if (request.mode === 'searchable') page.pushOperators(popGraphicsState());

  return { pdf: await doc.save(), replaced };
}

/** The word with each character no font can print drawn as "?", and how many that was. */
async function printableText(
  fonts: TextFonts,
  text: string,
): Promise<{ text: string; replaced: number }> {
  let current = [...text]
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
    .join('');
  let replaced = 0;
  // `check` names one kind of failure at a time (refused, then missing), so go round until it is quiet.
  for (let round = 0; round < 3; round += 1) {
    try {
      await fonts.check(current);
      return { text: current, replaced };
    } catch (error) {
      if (!(error instanceof UnsupportedText || error instanceof FontUnavailable)) throw error;
      const bad = new Set(error.characters);
      current = [...current]
        .map((char) => {
          if (!bad.has(char)) return char;
          replaced += 1;
          return '?';
        })
        .join('');
    }
  }
  return { text: current.replace(/[^ -~]/g, '?'), replaced };
}

import { binarise, findLines, type DigitalCopy, type FoundLines } from '@tp/shared/import';
import { openPageReader, READ_LONG_SIDE } from '../builder/paper/ocr.js';
import type { RecognisedWords } from '../builder/paper/ocr-words.js';

/**
 * Reading a page for its digital copy, on this device and nowhere else (`docs/plan/CAVEATS.md`
 * #43): the page is drawn once, upright and no larger than the import reads it, then
 *
 * - read by Tesseract from this origin (`paper/ocr.ts`), words with boxes and confidence, and
 * - reduced to ink and paper and searched for ruled lines (`@tp/shared/import`, `scan/lines.ts`).
 *
 * The photograph the person gave is never changed: what is read and what a searchable PDF is
 * made from is `picture`, a copy drawn here. This file does not reach the server; sending a PDF
 * is `keep.ts`.
 */

/** The picture the lines are looked for in: its longer side this many pixels. */
export const LINE_SIDE = 1600;

export interface CopyRead {
  /** The page upright, as a JPEG: what was read, and what a searchable PDF shows. */
  picture: Blob;
  recognised: RecognisedWords;
  found: FoundLines;
}

/** A page drawn on a canvas: turned `turn` degrees clockwise, white behind it, never above `longSide`. */
export async function drawPage(
  source: Blob | HTMLCanvasElement,
  turn: number,
  longSide: number,
): Promise<HTMLCanvasElement> {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : null;
  try {
    const width = bitmap ? bitmap.width : (source as HTMLCanvasElement).width;
    const height = bitmap ? bitmap.height : (source as HTMLCanvasElement).height;
    const quarter = Math.round(turn / 90) % 2 !== 0;
    const k = Math.min(1, longSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((quarter ? height : width) * k));
    canvas.height = Math.max(1, Math.round((quarter ? width : height) * k));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no canvas');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turn * Math.PI) / 180);
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    context.drawImage((bitmap ?? source) as CanvasImageSource, -w / 2, -h / 2, w, h);
    return canvas;
  } finally {
    bitmap?.close();
  }
}

export async function readForCopy(
  source: Blob | HTMLCanvasElement,
  turn: number,
  locale: string,
): Promise<CopyRead> {
  const page = await drawPage(source, turn, READ_LONG_SIDE);
  const picture = await new Promise<Blob>((done, fail) =>
    page.toBlob((blob) => (blob ? done(blob) : fail(new Error('not encoded'))), 'image/jpeg', 0.92),
  );
  const small = await drawPage(page, 0, LINE_SIDE);
  const pixels = small
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, small.width, small.height);
  const found = findLines(binarise(pixels.data, small.width, small.height));
  // Ruled lines are taken out of the picture the reader sees, so that a letter beside a cell border
  // is not read as part of it. Only on a page that is not turned (the lines are then where they
  // were found); the photograph kept in `picture` is untouched.
  if (Math.abs(found.skew) < 20) eraseLines(page, found);
  // A grid of lines is a table: read as one column of lines of any size (Tesseract mode 4), which keeps the cells (the automatic mode drops a table's text).
  const table =
    found.lines.filter((l) => l.dir === 'h').length >= 3 &&
    found.lines.filter((l) => l.dir === 'v').length >= 3;
  const reader = await openPageReader(locale, table ? '4' : undefined);
  let recognised: RecognisedWords;
  try {
    recognised = await reader.read(page);
  } finally {
    await reader.close();
  }
  return { picture, recognised, found };
}

/** Paper-white over each line, a little wider than it is, on a canvas the lines were found for. */
function eraseLines(canvas: HTMLCanvasElement, found: FoundLines): void {
  const context = canvas.getContext('2d')!;
  const sx = canvas.width / found.width;
  const sy = canvas.height / found.height;
  context.fillStyle = '#fff';
  for (const line of found.lines) {
    const pad = 2;
    if (line.dir === 'h') {
      const half = (line.thick * sy) / 2 + pad;
      context.fillRect(line.from * sx, line.at * sy - half, (line.to - line.from) * sx, half * 2);
    } else {
      const half = (line.thick * sx) / 2 + pad;
      context.fillRect(line.at * sx - half, line.from * sy, half * 2, (line.to - line.from) * sy);
    }
  }
}

/**
 * The reading with the words the person fixed: the words of the copy are the reading's non-blank
 * words in order, so a fixed one replaces the same one. What goes to the form import is then what
 * they saw, not what the reader first said.
 */
export function withFixes(recognised: RecognisedWords, copy: DigitalCopy): RecognisedWords {
  let at = 0;
  return {
    ...recognised,
    lines: recognised.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => {
        if (word.text.trim() === '') return word;
        const mine = copy.words[at];
        at += 1;
        return mine?.edited ? { ...word, text: mine.text, confidence: 100 } : word;
      }),
    })),
  };
}

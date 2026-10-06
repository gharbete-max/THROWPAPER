import type { TextRun } from './extract.js';
import { recognisedFrom, tessLangs, type RecognisedWords } from './ocr-words.js';

export { READ_LONG_SIDE, tessLangs } from './ocr-words.js';

/**
 * Reads the printed words off a photographed or scanned page, two ways.
 *
 * ## Lines, for the classic paper import: only a suggestion
 *
 * `readPage` offers a drawn box the label beside it — what `extract.ts` already does for a digital
 * PDF, where the text comes free. `docs/adr/0004-old-forms-on-paper.md` rules out guessing
 * questions there: a form that "asks slightly the wrong questions" is worse than one the author
 * drew. So this path never creates a field. The author draws a box; this offers the words next to
 * it, verbatim (rule 8); they keep or replace them.
 *
 * ## Words, for the review screen (S14)
 *
 * `openPageReader` reads a page word by word for stage 1 (`ocr-words.ts`, `docs/plan/SCANS.md`),
 * on the path ADR 0018 proposes: the stages read the words, and nothing becomes a question until
 * the author has been through the review, with the picture beside it and a word Tesseract was
 * unsure of holding its question below `auto`.
 *
 * ## From this origin, and nowhere else
 *
 * `tesseract.js` defaults its worker, WebAssembly core and language data to a CDN. The content
 * security policy is `'self'` with no CDN, on purpose, so `scripts/ocr-assets.ts` copies all
 * three into `public/ocr/` and the paths below point there. The photograph never leaves the
 * browser: recognition runs in a worker on this machine.
 *
 * Loaded with `import()` from here only — `bundle-split.test.ts` keeps it out of the entry
 * chunk. `readPage` ends its worker after each page, and a page reader after its document: a
 * resident 8 MB worker is the wrong default.
 */

/** The part of a Tesseract result this reads. Our own shape, so an upgrade lands here. */
export interface Recognised {
  width: number;
  height: number;
  lines: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}

export async function readPage(image: Blob, locale: string): Promise<TextRun[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(tessLangs(locale), 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/',
    langPath: '/ocr/lang',
    gzip: true,
  });
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const size = await imageSize(image);
    return toRuns({
      ...size,
      lines: (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.map((line) => ({ text: line.text, bbox: line.bbox })),
        ),
      ),
    });
  } finally {
    await worker.terminate();
  }
}

/** How long one page may take to read before the author is told (`docs/plan/SCANS.md`). */
export const OCR_PAGE_TIMEOUT_MS = 60_000;

export class ReadingPageTooSlow extends Error {
  constructor() {
    super('Reading a page took longer than the hard stop');
    this.name = 'ReadingPageTooSlow';
  }
}

/** One Tesseract worker for every page of a document: its language data is loaded once. */
export interface PageReader {
  read(image: Blob | HTMLCanvasElement): Promise<RecognisedWords>;
  close(): Promise<void>;
}

/**
 * Pages read word by word, in the author's browser, from this origin only (S14). Each page has
 * {@link OCR_PAGE_TIMEOUT_MS}: past it the worker is ended and the reading refused, so nothing is
 * added from a page half read.
 */
export async function openPageReader(locale: string): Promise<PageReader> {
  const { createWorker } = await import('tesseract.js');
  const start = () =>
    createWorker(tessLangs(locale), 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr/lang',
      gzip: true,
    });
  let worker = await start();
  let ended = false;
  return {
    async read(image) {
      if (ended) worker = await start();
      ended = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tooSlow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ended = true;
          void worker.terminate();
          reject(new ReadingPageTooSlow());
        }, OCR_PAGE_TIMEOUT_MS);
      });
      try {
        const { data } = await Promise.race([
          worker.recognize(image, {}, { blocks: true }),
          tooSlow,
        ]);
        const size =
          image instanceof Blob
            ? await imageSize(image)
            : { width: image.width, height: image.height };
        return recognisedFrom(data, size);
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      if (!ended) await worker.terminate();
      ended = true;
    },
  };
}

/** Lines as page fractions, the shape `labelNear` reads. Empty lines are nothing to offer. */
export function toRuns(result: Recognised): TextRun[] {
  return result.lines.flatMap(({ text, bbox }) => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [
      {
        text: trimmed,
        x: bbox.x0 / result.width,
        y: bbox.y0 / result.height,
        w: (bbox.x1 - bbox.x0) / result.width,
        h: (bbox.y1 - bbox.y0) / result.height,
      },
    ];
  });
}

function imageSize(image: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(image);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: element.naturalWidth, height: element.naturalHeight });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    element.src = url;
  });
}

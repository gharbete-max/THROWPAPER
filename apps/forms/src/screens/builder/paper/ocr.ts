import type { TextRun } from './extract.js';

/**
 * Reads the printed words off a photographed page, so a drawn box can be offered the label
 * beside it — what `extract.ts` already does for a digital PDF, where the text comes free.
 *
 * ## Only a suggestion
 *
 * `docs/adr/0004-old-forms-on-paper.md` rules out guessing questions from a scan: a form that
 * "asks slightly the wrong questions" is worse than one the author drew. So OCR here never
 * creates a field. The author draws a box; this offers the words next to it, verbatim (rule 8);
 * they keep or replace them. A page with nothing readable beside a box costs nothing but time.
 *
 * ## From this origin, and nowhere else
 *
 * `tesseract.js` defaults its worker, WebAssembly core and language data to a CDN. The content
 * security policy is `'self'` with no CDN, on purpose, so `scripts/ocr-assets.ts` copies all
 * three into `public/ocr/` and the paths below point there. The photograph never leaves the
 * browser: recognition runs in a worker on this machine.
 *
 * Loaded with `import()` from here only — `bundle-split.test.ts` keeps it out of the entry
 * chunk — and the worker is terminated after each page. A builder reads one or two pages; a
 * resident 8 MB worker is the wrong default.
 */

/** Tesseract's name for each interface language. Keep in step with `scripts/ocr-assets.ts`. */
const TESS_LANG: Record<string, string> = {
  'sv-SE': 'swe',
  'da-DK': 'dan',
  'nb-NO': 'nor',
  'fi-FI': 'fin',
  'is-IS': 'isl',
  'de-DE': 'deu',
  'fr-FR': 'fra',
  'es-ES': 'spa',
  'ru-RU': 'rus',
  'ja-JP': 'jpn',
  'zh-CN': 'chi_sim',
};

/** English always, because a Swedish sheet has English headings more often than not. */
export function tessLangs(locale: string): string[] {
  const own = TESS_LANG[locale];
  return own ? ['eng', own] : ['eng'];
}

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

import type { PayableWord } from '@tp/shared/payable';
import type { TextRun } from '../../forms/builder/paper/extract.js';
import type { RecognisedWords } from '../../forms/builder/paper/ocr-words.js';

/**
 * What the two readers of a page hand the rules: words with a box (fractions of the page, y down)
 * and a confidence. A PDF's text layer is exact (100); optical reading says how sure it was.
 */

/** A text layer's runs, split at spaces. A run's width is shared by its characters. */
export function wordsFromRuns(runs: readonly TextRun[], page: number): PayableWord[] {
  return runs.flatMap((run) => {
    const length = run.text.length;
    if (length === 0) return [];
    return [...run.text.matchAll(/\S+/g)].map((match) => ({
      page,
      text: match[0],
      x0: run.x + (run.w * match.index) / length,
      x1: run.x + (run.w * (match.index + match[0].length)) / length,
      y0: run.y,
      y1: run.y + run.h,
      confidence: 100,
    }));
  });
}

/** Optical reading's words, their pixel boxes divided by the picture's size. */
export function wordsFromRecognised(read: RecognisedWords, page: number): PayableWord[] {
  return read.lines.flatMap((line) =>
    line.words.flatMap((word) =>
      word.text.trim() === ''
        ? []
        : [
            {
              page,
              text: word.text.trim(),
              x0: word.bbox.x0 / read.width,
              x1: word.bbox.x1 / read.width,
              y0: word.bbox.y0 / read.height,
              y1: word.bbox.y1 / read.height,
              confidence: Math.min(100, Math.max(0, word.confidence)),
            },
          ],
    ),
  );
}

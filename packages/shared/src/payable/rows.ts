/**
 * The words of a read page, put back into rows, and the box a stretch of a row occupies.
 *
 * Optical reading groups words into lines by its own idea of a block; an invoice puts a label at
 * the left and its value at the right, and the two often come back as separate lines. Rows are
 * rebuilt from the words' own positions instead: words whose vertical centres agree are one row,
 * left to right, however far apart they sit.
 */

/** A word and where it was found: fractions of its page, y down. Confidence 0–100. */
export interface PayableWord {
  page: number;
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Optical reading's own confidence; a PDF's text layer is exact and says 100. */
  confidence: number;
}

/** A place on a page, as a fraction of it: what the review screen outlines. */
export interface Where {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Row {
  page: number;
  words: PayableWord[];
  /** The words joined with single spaces. */
  text: string;
  /** Where each word starts and ends in `text`. */
  spans: Array<{ start: number; end: number }>;
}

/**
 * A word with a colon inside it ("OCR:12345", "Förfallodatum:2026-10-31") is two: the label and
 * its value. The box is divided by character count. A colon after a digit ("12:30", "1 250:-") is
 * not a label's colon and is left alone.
 */
function splitAtColon(word: PayableWord): PayableWord[] {
  const at = word.text.indexOf(':');
  if (at <= 0 || at >= word.text.length - 1) return [word];
  const left = word.text.slice(0, at + 1);
  const right = word.text.slice(at + 1);
  if (/\d/.test(left) || right === '-') return [word];
  const cut = word.x0 + ((word.x1 - word.x0) * left.length) / word.text.length;
  return [
    { ...word, text: left, x1: cut },
    { ...word, text: right, x0: cut },
  ];
}

export function rowsOf(words: readonly PayableWord[]): Row[] {
  const clean = words.filter((word) => word.text.trim() !== '').flatMap(splitAtColon);
  const pages = [...new Set(clean.map((word) => word.page))].sort((a, b) => a - b);
  const rows: Row[] = [];
  for (const page of pages) {
    const onPage = clean
      .filter((word) => word.page === page)
      .sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
    const groups: PayableWord[][] = [];
    for (const word of onPage) {
      const group = groups[groups.length - 1];
      const centre = (word.y0 + word.y1) / 2;
      const height = word.y1 - word.y0;
      if (group) {
        const mean = group.reduce((sum, w) => sum + (w.y0 + w.y1) / 2, 0) / group.length;
        const rowHeight = Math.min(...group.map((w) => w.y1 - w.y0), height);
        if (Math.abs(centre - mean) <= rowHeight * 0.5) {
          group.push(word);
          continue;
        }
      }
      groups.push([word]);
    }
    for (const group of groups) {
      const sorted = [...group].sort((a, b) => a.x0 - b.x0);
      let text = '';
      const spans = sorted.map((word) => {
        const start = text === '' ? 0 : text.length + 1;
        text = text === '' ? word.text.trim() : `${text} ${word.text.trim()}`;
        return { start, end: text.length };
      });
      rows.push({ page, words: sorted, text, spans });
    }
  }
  return rows;
}

/** The words that overlap the characters from `start` to `end` of a row's text. */
export function wordsIn(row: Row, start: number, end: number): PayableWord[] {
  return row.words.filter((_, i) => row.spans[i]!.start < end && row.spans[i]!.end > start);
}

export function whereOf(words: readonly PayableWord[]): Where {
  const first = words[0]!;
  return {
    page: first.page,
    x0: Math.min(...words.map((w) => w.x0)),
    y0: Math.min(...words.map((w) => w.y0)),
    x1: Math.max(...words.map((w) => w.x1)),
    y1: Math.max(...words.map((w) => w.y1)),
  };
}

/** The lowest confidence among the words: a number is as sure as its least sure character. */
export const confidenceOf = (words: readonly PayableWord[]) =>
  Math.min(100, ...words.map((w) => w.confidence));

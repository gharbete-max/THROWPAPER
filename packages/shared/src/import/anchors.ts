import { unionBox } from './ir/geometry.js';
import type { Box, IrLine, IrWord, LayoutDocument } from './ir/types.js';
import { blankRuns, isBlankWord, isCheckboxWord } from './layout/hints.js';

/**
 * The paper twin's boxes — `docs/plan/CONVERGENCE.md` (S12b), `IMPORT-PIPELINE.md` stage 6: where
 * a question read from a page has its answer written, and where each of its options is ticked, so
 * a filled response can come back as that page (`apps/api-forms/src/documents/paper.ts`).
 *
 * In layout units, from the reading's own lines; the screen turns a box into a `PaperAnchor`
 * (`paperAnchor`). A question's box, in order of preference: its blank runs after its label (on
 * its line, or a line of nothing else under it); its checkboxes; else from its label to its
 * column's right edge on the label's line. A PDF's own form field has its widget instead, which
 * the screen knows.
 */

/** A box on one page of the document: `pageNo` is 1-based, as `IrPage.pageNo`. */
export interface PageBox {
  readonly pageNo: number;
  readonly box: Box;
}

interface Placed {
  readonly line: IrLine;
  readonly word: IrWord;
}

const IU = 10_000;

function linesOf(layout: LayoutDocument, lineIds: readonly string[]): IrLine[] {
  const byId = new Map(
    layout.pages
      .flatMap((page) => page.blocks.flatMap((block) => block.lines))
      .map((line) => [line.id, line]),
  );
  return lineIds.flatMap((id) => {
    const line = byId.get(id);
    return line ? [line] : [];
  });
}

const placedOf = (lines: readonly IrLine[]): Placed[] =>
  lines.flatMap((line) => line.words.map((word) => ({ line, word })));

/** A word as a label is made of it: without its blank runs and a closing colon. */
function bare(text: string): string {
  const chars = [...text];
  const kept = chars.filter(
    (_, i) => !blankRuns(text).some((run) => i >= run.start && i < run.end),
  );
  return kept.join('').replace(/:$/u, '');
}

const tokensOf = (text: string) =>
  text
    .split(/\s+/u)
    .filter((token) => token !== '')
    .map((token) => token.replace(/:$/u, ''));

/**
 * Where `words` (verbatim, space-separated) are in `placed`, from `from` on: the index of their
 * last word, or -1.
 */
function find(placed: readonly Placed[], text: string, from = 0): { start: number; end: number } {
  const tokens = tokensOf(text);
  if (tokens.length === 0) return { start: -1, end: -1 };
  for (let i = from; i < placed.length; i += 1) {
    let k = 0;
    while (
      k < tokens.length &&
      i + k < placed.length &&
      bare(placed[i + k]!.word.text) === tokens[k]
    ) {
      k += 1;
    }
    if (k === tokens.length) return { start: i, end: i + k - 1 };
  }
  return { start: -1, end: -1 };
}

/** The part of a word that is a blank run, its width shared out by character (`CAVEATS.md` #58). */
function blankPart(word: IrWord): Box | null {
  const runs = blankRuns(word.text);
  if (runs.length === 0) return null;
  const length = [...word.text].length;
  const width = word.box.x1 - word.box.x0;
  const start = runs[0]!.start;
  const end = runs.at(-1)!.end;
  return {
    x0: word.box.x0 + Math.floor((width * start) / length),
    y0: word.box.y0,
    x1: word.box.x0 + Math.ceil((width * end) / length),
    y1: word.box.y1,
  };
}

/** The blanks straight after `end` on its line; failing those, a line of nothing but blanks below. */
function blanksAfter(
  lines: readonly IrLine[],
  placed: readonly Placed[],
  end: number,
): PageBox | null {
  const at = placed[end]!;
  const boxes: Box[] = [];
  const glued = blankPart(at.word);
  if (glued) boxes.push(glued);
  for (let j = end + 1; j < placed.length && placed[j]!.line === at.line; j += 1) {
    const { word } = placed[j]!;
    if (isBlankWord(word.text)) {
      boxes.push(word.box);
      continue;
    }
    const part = blankPart(word);
    if (part) boxes.push(part);
    break;
  }
  if (boxes.length > 0) return { pageNo: at.line.pageNo, box: unionBox(boxes) };
  for (const line of lines.slice(lines.indexOf(at.line) + 1)) {
    const content = line.words.filter((word) => word.text.trim() !== '');
    if (content.length === 0) continue;
    if (!content.every((word) => isBlankWord(word.text))) break;
    return { pageNo: line.pageNo, box: unionBox(content.map((word) => word.box)) };
  }
  return null;
}

function columnRight(layout: LayoutDocument, line: IrLine): number {
  const page = layout.pages.find((candidate) => candidate.pageNo === line.pageNo);
  const column = page?.columns.find((candidate) => candidate.index === line.columnIndex);
  return column?.x1 ?? IU;
}

/**
 * Where a question's answer is written: see the module's comment. `label` is the question's own,
 * verbatim, as stage 4 read it. Null when none of its lines is in the layout.
 */
export function answerBox(
  layout: LayoutDocument,
  lineIds: readonly string[],
  label: string,
): PageBox | null {
  const lines = linesOf(layout, lineIds);
  if (lines.length === 0) return null;
  const placed = placedOf(lines);
  const { end } = find(placed, label);

  // Its blanks: after its label — which keeps two questions on one line apart — or, with no label
  // found, every blank on its lines.
  if (end >= 0) {
    const blanks = blanksAfter(lines, placed, end);
    if (blanks) return blanks;
  } else {
    const blanks = placed.filter(({ word }) => blankPart(word) !== null);
    if (blanks.length > 0) {
      const first = blanks[0]!.line;
      const same = blanks.filter(({ line }) => line.pageNo === first.pageNo);
      return { pageNo: first.pageNo, box: unionBox(same.map(({ word }) => blankPart(word)!)) };
    }
  }

  // Its checkboxes: ticking is how it is answered.
  const from = Math.max(0, end + 1);
  const ticks = placed.slice(from).filter(({ word }) => isCheckboxWord(word.text));
  if (ticks.length > 0) {
    const first = ticks[0]!.line;
    const same = ticks.filter(({ line }) => line.pageNo === first.pageNo);
    return { pageNo: first.pageNo, box: unionBox(same.map(({ word }) => word.box)) };
  }

  // From the label to its column's edge, on the label's line.
  const last = end >= 0 ? placed[end]! : placed.at(-1)!;
  const right = columnRight(layout, last.line);
  const x0 = Math.min(last.word.box.x1, right);
  if (right - x0 > 0) {
    return {
      pageNo: last.line.pageNo,
      box: { x0, y0: last.line.box.y0, x1: right, y1: last.line.box.y1 },
    };
  }
  // No room beside it: the line's height under it, as wide as the line.
  const height = last.line.box.y1 - last.line.box.y0;
  return {
    pageNo: last.line.pageNo,
    box: {
      x0: last.line.box.x0,
      y0: last.line.box.y1,
      x1: right,
      y1: Math.min(IU, last.line.box.y1 + height),
    },
  };
}

/** The checkbox nearest to the words from `start` to `end`: before them on their line, else after. */
function tickFor(placed: readonly Placed[], start: number, end: number): PageBox | null {
  const line = placed[start]!.line;
  for (let j = start - 1; j >= 0 && placed[j]!.line === line; j -= 1) {
    if (isCheckboxWord(placed[j]!.word.text))
      return { pageNo: line.pageNo, box: placed[j]!.word.box };
  }
  for (let j = end + 1; j < placed.length && placed[j]!.line === line; j += 1) {
    if (isCheckboxWord(placed[j]!.word.text))
      return { pageNo: line.pageNo, box: placed[j]!.word.box };
  }
  return null;
}

/** Each option's own checkbox, in the options' order; null for one the page gives none. */
export function optionBoxes(
  layout: LayoutDocument,
  lineIds: readonly string[],
  options: readonly string[],
): (PageBox | null)[] {
  const placed = placedOf(linesOf(layout, lineIds));
  let from = 0;
  return options.map((option) => {
    const { start, end } = find(placed, option, from);
    if (start < 0) return null;
    from = end + 1;
    return tickFor(placed, start, end);
  });
}

/**
 * A grid's rows, each a question whose options are the columns: for each row, its checkboxes in
 * column order on the row's line, and their union.
 */
export function gridBoxes(
  layout: LayoutDocument,
  lineIds: readonly string[],
  rows: readonly string[],
  columns: number,
): { row: PageBox | null; options: (PageBox | null)[] }[] {
  const lines = linesOf(layout, lineIds);
  const used = new Set<IrLine>();
  return rows.map((row) => {
    const wanted = tokensOf(row).join(' ');
    const line = lines.find((candidate) => {
      if (used.has(candidate)) return false;
      const first = candidate.words.findIndex((word) => isCheckboxWord(word.text));
      const before = candidate.words.slice(0, first < 0 ? candidate.words.length : first);
      return tokensOf(before.map((word) => word.text).join(' ')).join(' ') === wanted;
    });
    if (!line) return { row: null, options: Array.from({ length: columns }, () => null) };
    used.add(line);
    const ticks = line.words
      .filter((word) => isCheckboxWord(word.text))
      .sort((a, b) => a.box.x0 - b.box.x0)
      .slice(0, columns);
    const options = Array.from({ length: columns }, (_, i) =>
      ticks[i] ? { pageNo: line.pageNo, box: ticks[i]!.box } : null,
    );
    return {
      row:
        ticks.length > 0
          ? { pageNo: line.pageNo, box: unionBox(ticks.map((word) => word.box)) }
          : null,
      options,
    };
  });
}

/**
 * A box as a fraction of its page, as `PaperAnchor` stores it: `page` counts every page of every
 * source the form keeps, 0-based, so this document's first page is `firstPage`.
 */
export function paperAnchor(
  at: PageBox,
  firstPage: number,
): { page: number; x: number; y: number; w: number; h: number } {
  const { x0, y0, x1, y1 } = at.box;
  return {
    page: firstPage + at.pageNo - 1,
    x: x0 / IU,
    y: y0 / IU,
    w: (x1 - x0) / IU,
    h: (y1 - y0) / IU,
  };
}

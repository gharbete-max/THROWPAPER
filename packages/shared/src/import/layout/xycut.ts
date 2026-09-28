import type { Evidence } from '../debug.js';
import { lowerMedian, unionBox } from '../ir/geometry.js';
import type { Box } from '../ir/types.js';
import { grammar } from '../enumerate/grammar.js';
import { isBlankWord, isCheckboxWord } from './hints.js';

/**
 * Column regions by recursive XY-cut — `IMPORT-PIPELINE.md` §2.2.
 *
 * A region is split at its widest vertical gutter, or failing one at every wide horizontal gap,
 * and the pieces are split again until nothing splits. The cut order is the reading order: top
 * before bottom, left before right. Horizontal cuts exist only to expose columns inside a band of
 * the page, so consecutive pieces of one horizontal cut that did not split any further are put back
 * together: a page of paragraphs is one region, not one per paragraph.
 *
 * Two kinds of vertical gutter are not columns, and are kept together (§2.2, "not a column"): a
 * gutter whose left side is nothing but list markers or checkboxes — the tab after "1." — and one
 * whose right side is nothing but answer space — blanks, or rows that start with a checkbox —
 * which belongs to the labels beside it.
 */

/** §2.2: a vertical gutter is at least this wide, in iu of the page width. */
export const MIN_GUTTER = 200;
/** A bound on the recursion; a region this deep is read as it is. */
export const MAX_CUT_DEPTH = 64;

/** What the cut needs of a word. */
export interface CutWord {
  readonly text: string;
  readonly box: Box;
  readonly baseline: number;
  readonly fontSize: number;
}

export interface Region<W extends CutWord> {
  /** The region's rectangle: its column, in `IrColumn` terms. */
  readonly rect: Box;
  /** Its words, in the order they came in. */
  readonly words: readonly W[];
}

export interface CutDecision {
  readonly rule: 'C1' | 'C2' | 'C3';
  readonly verdict: 'cut' | 'kept';
  readonly evidence: Evidence;
}

type Node<W extends CutWord> =
  | { readonly kind: 'leaf'; readonly rect: Box; readonly words: readonly W[] }
  | { readonly kind: 'v' | 'h'; readonly parts: readonly Node<W>[] };

interface Gap {
  readonly start: number;
  readonly end: number;
}

/** The empty stretches between the words' extents along one axis, at least `min` long. */
function gaps<W extends CutWord>(
  words: readonly W[],
  from: (w: W) => number,
  to: (w: W) => number,
  min: number,
): Gap[] {
  const sorted = [...words].sort((a, b) => from(a) - from(b) || to(a) - to(b));
  const found: Gap[] = [];
  let reach = to(sorted[0]!);
  for (const word of sorted.slice(1)) {
    if (from(word) - reach >= min) found.push({ start: reach, end: from(word) });
    if (to(word) > reach) reach = to(word);
  }
  return found;
}

/** Words grouped into rows: the same baseline within half an em. */
function rows<W extends CutWord>(words: readonly W[], em: number): W[][] {
  const sorted = [...words].sort((a, b) => a.baseline - b.baseline || a.box.x0 - b.box.x0);
  const out: W[][] = [];
  for (const word of sorted) {
    const row = out.at(-1);
    if (row && Math.abs(word.baseline - row[0]!.baseline) * 2 <= em) row.push(word);
    else out.push([word]);
  }
  return out.map((row) => row.sort((a, b) => a.box.x0 - b.box.x0));
}

/** The left side is only list markers or checkboxes: the gutter is the tab after them. */
const markerColumn = <W extends CutWord>(left: readonly W[]) =>
  left.every((word) => isCheckboxWord(word.text) || grammar([word]) !== null);

/** The right side is only answer space: blanks, or rows that start with a checkbox. */
function answerColumn<W extends CutWord>(right: readonly W[], em: number): boolean {
  const boxes = right.filter((word) => isCheckboxWord(word.text)).length;
  if (boxes * 2 >= right.length) return true; // a grid of boxes under its header row
  return rows(right, em).every(
    (row) => isCheckboxWord(row[0]!.text) || row.every((word) => isBlankWord(word.text)),
  );
}

function cut<W extends CutWord>(
  words: readonly W[],
  rect: Box,
  depth: number,
  decide: (decision: CutDecision) => void,
): Node<W> {
  const leaf: Node<W> = { kind: 'leaf', rect, words };
  if (words.length <= 1 || depth <= 0) return leaf;
  const em = lowerMedian(words.map((word) => word.fontSize));

  // A vertical gutter: the widest first, the leftmost of equals; one that is not a column is kept.
  const gutters = gaps(
    words,
    (w) => w.box.x0,
    (w) => w.box.x1,
    MIN_GUTTER,
  ).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  for (const gutter of gutters) {
    const left = words.filter((word) => word.box.x1 <= gutter.start);
    const right = words.filter((word) => word.box.x0 >= gutter.end);
    const at = { x0: gutter.start, x1: gutter.end, left: left.length, right: right.length };
    const why = markerColumn(left) ? 'markers' : answerColumn(right, em) ? 'answers' : null;
    if (why) {
      decide({ rule: 'C2', verdict: 'kept', evidence: { ...at, why } });
      continue;
    }
    decide({ rule: 'C1', verdict: 'cut', evidence: at });
    const middle = (gutter.start + gutter.end) >> 1;
    const leftBox = unionBox(left.map((word) => word.box));
    const rightBox = unionBox(right.map((word) => word.box));
    return {
      kind: 'v',
      parts: [
        cut(left, { ...rect, x1: middle, y0: leftBox.y0, y1: leftBox.y1 }, depth - 1, decide),
        cut(
          right,
          { ...rect, x0: rightBox.x0, y0: rightBox.y0, y1: rightBox.y1 },
          depth - 1,
          decide,
        ),
      ],
    };
  }

  // Horizontal gaps of at least an em of empty page, every one of them.
  const bands = gaps(
    words,
    (w) => w.box.y0,
    (w) => w.box.y1,
    Math.max(1, em),
  );
  if (bands.length === 0) return leaf;
  decide({
    rule: 'C3',
    verdict: 'cut',
    evidence: { y0: rect.y0, y1: rect.y1, gaps: bands.length, em },
  });
  const parts: Node<W>[] = [];
  let top = -1;
  for (const bottom of [...bands.map((gap) => gap.start), Number.MAX_SAFE_INTEGER]) {
    const band = words.filter((word) => word.box.y0 > top && word.box.y1 <= bottom);
    top = bottom;
    const box = unionBox(band.map((word) => word.box));
    parts.push(cut(band, { ...rect, y0: box.y0, y1: box.y1 }, depth - 1, decide));
  }
  return { kind: 'h', parts };
}

/** A horizontal cut's consecutive unsplit pieces, put back together. */
function regionsOf<W extends CutWord>(node: Node<W>): Region<W>[] {
  if (node.kind === 'leaf') return [{ rect: node.rect, words: node.words }];
  if (node.kind === 'v') return node.parts.flatMap(regionsOf);
  const out: Region<W>[] = [];
  let pending: Region<W> | null = null;
  for (const part of node.parts) {
    if (part.kind === 'leaf') {
      pending = pending
        ? {
            rect: unionBox([pending.rect, part.rect]),
            words: [...pending.words, ...part.words],
          }
        : { rect: part.rect, words: part.words };
      continue;
    }
    if (pending) out.push(pending);
    pending = null;
    out.push(...regionsOf(part));
  }
  if (pending) out.push(pending);
  return out;
}

/**
 * A page's words as column regions, in reading order. The page's own rectangle is its words'
 * extent, widened on the right to mirror the left margin — a line is "wrapped" (it reaches 90% of
 * its column) against the page's text width, not against its own longest line.
 */
export function columnRegions<W extends CutWord>(
  words: readonly W[],
  decide: (decision: CutDecision) => void,
  maxDepth = MAX_CUT_DEPTH,
): Region<W>[] {
  if (words.length === 0) return [];
  const extent = unionBox(words.map((word) => word.box));
  const rect = { ...extent, x1: Math.max(extent.x1, 10_000 - extent.x0) };
  return regionsOf(cut(words, rect, maxDepth, decide));
}

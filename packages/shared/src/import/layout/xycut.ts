import type { Evidence } from '../debug.js';
import { lowerMedian, unionBox } from '../ir/geometry.js';
import type { Box } from '../ir/types.js';
import { grammar } from '../enumerate/grammar.js';
import { isBlankWord, isCheckboxWord } from './hints.js';

/**
 * Column regions by recursive XY-cut — `IMPORT-PIPELINE.md` §2.2.
 *
 * A region is cut at its widest vertical gutter (C1). Failing one, it is cut into its rows at
 * every gap between them (C3), and each row is tried again. The cut order is the reading order: top
 * before bottom, left before right. Then the rows are put back together: consecutive rows that did
 * not cut any further are one region — a page of paragraphs is one region, not one per line — and
 * consecutive rows that cut at the same gutter are columns (C4), each read top to bottom, left then
 * right. That finds a two-column list inside the flow of a page, with full-width text above and
 * below it and only line spacing between, which no gutter crosses from top to bottom.
 *
 * A gutter is at least 200 iu and two ems of its region's type wide: a space in a large heading,
 * whose width pdf.js shares out by character, is not one. And two kinds of gutter are not columns,
 * and are kept together (C2): one whose left side is nothing but list markers or checkboxes — the
 * tab after "1." — and one whose right side is nothing but answer space — blanks, or rows that
 * start with a checkbox — which belongs to the labels beside it.
 */

/** §2.2: a vertical gutter is at least this wide, in iu of the page width, */
export const MIN_GUTTER = 200;
/** and at least this many ems of its region's median type size. */
export const GUTTER_EMS = 2;
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
  readonly rule: 'C1' | 'C2' | 'C3' | 'C4';
  readonly verdict: 'cut' | 'kept' | 'columns';
  readonly evidence: Evidence;
}

interface Gap {
  readonly start: number;
  readonly end: number;
}

type Node<W extends CutWord> =
  | { readonly kind: 'leaf'; readonly rect: Box; readonly words: readonly W[] }
  | { readonly kind: 'v'; readonly parts: readonly [Node<W>, Node<W>]; readonly gutter: Gap }
  | { readonly kind: 'h'; readonly parts: readonly Node<W>[] };

/** The empty stretches between the words' extents along one axis, longer than `min`. */
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
    Math.max(MIN_GUTTER, GUTTER_EMS * em),
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
      gutter,
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

  // No gutter: the region's rows, at every gap of empty page between them.
  const between = gaps(
    words,
    (w) => w.box.y0,
    (w) => w.box.y1,
    1,
  );
  if (between.length === 0) return leaf;
  decide({
    rule: 'C3',
    verdict: 'cut',
    evidence: { y0: rect.y0, y1: rect.y1, rows: between.length + 1 },
  });
  const parts: Node<W>[] = [];
  let top = -1;
  for (const bottom of [...between.map((gap) => gap.start), Number.MAX_SAFE_INTEGER]) {
    const band = words.filter((word) => word.box.y0 > top && word.box.y1 <= bottom);
    top = bottom;
    const box = unionBox(band.map((word) => word.box));
    parts.push(cut(band, { ...rect, y0: box.y0, y1: box.y1 }, depth - 1, decide));
  }
  return { kind: 'h', parts };
}

/** A row cut into columns and nothing else: its columns, and the gutters between them. */
interface Row<W extends CutWord> {
  columns: Region<W>[];
  gutters: Gap[];
}

/** A vertical cut whose pieces are leaves or vertical cuts of leaves, as a row; else null. */
function rowOf<W extends CutWord>(node: Node<W>): Row<W> | null {
  if (node.kind === 'leaf')
    return { columns: [{ rect: node.rect, words: node.words }], gutters: [] };
  if (node.kind === 'h') return null;
  const left = rowOf(node.parts[0]);
  const right = rowOf(node.parts[1]);
  if (!left || !right) return null;
  return {
    columns: [...left.columns, ...right.columns],
    gutters: [...left.gutters, node.gutter, ...right.gutters],
  };
}

const overlaps = (a: Gap, b: Gap) => Math.max(a.start, b.start) < Math.min(a.end, b.end);

/** Rows merged into columns: how many, and what they are so far. */
type Group<W extends CutWord> = Row<W> & { rows: number };

/** Where a column's words are, across the page. */
const span = <W extends CutWord>(column: Region<W>): Gap => ({
  start: Math.min(...column.words.map((word) => word.box.x0)),
  end: Math.max(...column.words.map((word) => word.box.x1)),
});

/**
 * A row continues a group of columns: as many columns, at gutters that overlap, and each of its
 * columns where that column already is — an indented line still overlaps its column, a label that
 * merely has a gap after it does not.
 */
const sameColumns = <W extends CutWord>(group: Group<W>, row: Row<W>) =>
  group.columns.length === row.columns.length &&
  group.gutters.every((gutter, i) => overlaps(gutter, row.gutters[i]!)) &&
  group.columns.every((column, i) => overlaps(span(column), span(row.columns[i]!)));
const merged = <W extends CutWord>(a: Region<W>, b: Region<W>): Region<W> => ({
  rect: unionBox([a.rect, b.rect]),
  words: [...a.words, ...b.words],
});

/**
 * Regions in reading order. Under a horizontal cut, consecutive rows that did not cut are one
 * region, and consecutive rows that cut into the same number of columns at overlapping gutters are
 * those columns (C4).
 */
function regionsOf<W extends CutWord>(
  node: Node<W>,
  decide: (decision: CutDecision) => void,
): Region<W>[] {
  if (node.kind === 'leaf') return [{ rect: node.rect, words: node.words }];
  if (node.kind === 'v') return node.parts.flatMap((part) => regionsOf(part, decide));
  const out: Region<W>[] = [];
  let flow: Region<W> | null = null;
  let group: Group<W> | null = null;
  const emit = (columns: Group<W>) => {
    if (columns.rows > 1) {
      decide({
        rule: 'C4',
        verdict: 'columns',
        evidence: { rows: columns.rows, columns: columns.columns.length },
      });
    }
    out.push(...columns.columns);
  };
  for (const part of node.parts) {
    if (part.kind === 'leaf') {
      if (group) emit(group);
      group = null;
      const region: Region<W> = { rect: part.rect, words: part.words };
      flow = flow ? merged(flow, region) : region;
      continue;
    }
    if (flow) out.push(flow);
    flow = null;
    const row = rowOf(part);
    if (row && group && sameColumns(group, row)) {
      group = {
        rows: group.rows + 1,
        columns: group.columns.map((column, i) => merged(column, row.columns[i]!)),
        gutters: group.gutters.map((gutter, i) => ({
          start: Math.max(gutter.start, row.gutters[i]!.start),
          end: Math.min(gutter.end, row.gutters[i]!.end),
        })),
      };
      continue;
    }
    if (group) emit(group);
    group = null;
    if (row) group = { ...row, rows: 1 };
    else out.push(...regionsOf(part, decide));
  }
  if (flow) out.push(flow);
  if (group) emit(group);
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
  return regionsOf(cut(words, rect, maxDepth, decide), decide);
}

import { inputsSha256, type Decision, type Evidence, type StageResult } from '../debug.js';
import type { EnumerateResult, Family, Item } from '../enumerate/types.js';
import type { BlockRole, IrBlock, IrColumn, IrLine, IrWord, LayoutDocument } from '../ir/types.js';
import { halfWidth, isBlankWord, isCheckboxWord, joinLines } from '../layout/hints.js';
import { folded, isBooleanPair, isMetaLine, mentionsTable } from './lexicon.js';
import type {
  Answer,
  GridSegment,
  QuestionSegment,
  Segment,
  SegmentFlag,
  SegmentResult,
  TableSegment,
} from './types.js';

/**
 * Stage 4, segment: what each part of the document is — a heading, an instruction, a form number,
 * a question and what answers it, a grid, a table — `docs/plan/IMPORT-PIPELINE.md` §4, which is the
 * specification. Every rule's id is in the debug artifact, with its evidence.
 *
 * The input is stage 2's layout document and stage 3's reading of it. It runs in three passes:
 * structures that span several lines claim them first (grids and tables, §4.2–4.3); then items
 * with items under them (options, or a section, §4.5); then every line or item left, rule by
 * rule, first match wins. (First written as one list with the heading rule first: a real ruled
 * table's header row comes out of stage 2 as one bold region per cell, which H2 calls a heading, so
 * the grid lost its columns to three section headings — `grid-header-cells`.)
 */

/** Bumped when the stage's output changes on purpose (the debug artifact records it). */
export const SEGMENT_STAGE_VERSION = 6;
/** More options than this and the question is flagged (#30). */
export const MAX_OPTIONS = 30;
/** A label longer than this is prose to read, not a label (rules 1, 7, 8). */
const LABEL_MAX = 120;
/** A line ending in ":" this short, with nothing after it, is a label (§4.7). */
const COLON_LABEL_MAX = 60;
/** A numbered section heading is at most this long (§4.5). */
const SECTION_MAX = 80;
/** How far back a grid with no label looks for the question that points at it (§4.2). */
const REFERENCE_REACH = 6;
/** Families whose items can be a question's answers (§4.5): letters and bullets, never numbers. */
const OPTION_FAMILIES: ReadonlySet<Family> = new Set([
  'alpha-lower',
  'alpha-upper',
  'bullet',
  'roman-lower',
]);

interface Line {
  ir: IrLine;
  block: IrBlock;
  role: BlockRole;
  column: IrColumn;
  /** Index in the document's reading order. */
  order: number;
}

/** A piece of text on the page, with the blank runs to write in marked. */
interface Part {
  blank: boolean;
  text: string;
}

const dotCount = (run: string) => [...run].reduce((n, c) => n + (c === '…' ? 3 : 1), 0);
const BLANKISH = /_{3,}|[.…]{2,}/gu;

/**
 * Text split at its blank runs: ≥ 3 underscores, or ≥ 4 leader dots (a "…" counts three). Found in
 * the text with its full-width forms read as ASCII ("＿＿＿", #144), which keeps every position, and
 * cut from the text as it is.
 */
function partsOf(text: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of halfWidth(text).matchAll(BLANKISH)) {
    const run = match[0];
    if (!run.startsWith('_') && dotCount(run) < 4) continue;
    const end = match.index + run.length;
    if (match.index > at) parts.push({ blank: false, text: text.slice(at, match.index) });
    parts.push({ blank: true, text: text.slice(match.index, end) });
    at = end;
  }
  if (at < text.length) parts.push({ blank: false, text: text.slice(at) });
  return parts;
}

/**
 * Text with its blank runs taken out, spaces closed up, and one trailing colon removed (§4.6) — "："
 * as well as ":" (#144).
 */
function labelOf(text: string): string {
  const joined = joinLines(
    partsOf(text)
      .filter((part) => !part.blank)
      .map((part) => part.text.trim())
      .filter(Boolean),
  );
  return (halfWidth(joined).endsWith(':') ? joined.slice(0, -1) : joined).trim();
}

const hasLetter = (text: string) => /\p{L}/u.test(text);
/** The mark a text ends with, a full-width or ideographic one read as its ASCII form (#144). */
const lastMark = (text: string) => {
  const mark = text.trim().slice(-1);
  return mark === '。' ? '.' : mark === '！' ? '!' : halfWidth(mark);
};
const endsWithAny = (text: string, marks: string) => marks.includes(lastMark(text));
/** A short sentence that asks — "?" or "？", then perhaps a note in brackets: "(max 8)", "（最多8人）". */
const ASKS = /[?？](?:\s*[(（][^()（）]*[)）])?$/u;

/** Words are verbatim; a line's words joined by one space are its text. */
const joinWords = (words: readonly IrWord[]) => words.map((word) => word.text).join(' ');

/** Part of a word, between two UTF-16 offsets, its box that part's share of the word's by character. */
function pieceOf(word: IrWord, from: number, to: number): IrWord {
  const chars = [...word.text].length;
  const width = word.box.x1 - word.box.x0;
  const x = (offset: number) =>
    word.box.x0 + Math.trunc((width * [...word.text.slice(0, offset)].length) / chars);
  return {
    ...word,
    text: word.text.slice(from, to),
    start: word.start + from,
    box: { ...word.box, x0: x(from), x1: x(to) },
  };
}

/**
 * Words as stage 4 reads boxes in them: a box glyph at the start of a word is a word of its own,
 * and the rest another — Chinese and Japanese set a box against its option, "□はい" (#147).
 */
const boxesApart = (words: readonly IrWord[]): IrWord[] =>
  words.flatMap((word) =>
    word.text.length > 1 && isCheckboxWord(word.text[0]!)
      ? [pieceOf(word, 0, 1), pieceOf(word, 1, word.text.length)]
      : [word],
  );

export function segment(doc: LayoutDocument, lists: EnumerateResult): StageResult<SegmentResult> {
  const decisions: Decision[] = [];
  const decide = (
    id: string,
    rule: string,
    subject: string[],
    verdict: string,
    evidence: Evidence = {},
  ) => decisions.push({ id: `segment:${id}`, rule, subject, verdict, evidence });

  // ── The document in reading order ────────────────────────────────────────────────────────────
  const lines: Line[] = [];
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      const column = page.columns[block.columnIndex]!;
      for (const ir of block.lines) {
        lines.push({ ir, block, role: block.role, column, order: lines.length });
      }
    }
  }
  const byId = new Map(lines.map((line) => [line.ir.id, line]));
  const at = (id: string) => byId.get(id)!;

  const items = lists.items;
  const itemOfLine = new Map<string, Item>();
  const ownerOfDetail = new Map<string, Item>();
  const childrenOf = new Map<string, Item[]>();
  for (const item of items) {
    for (const id of item.lineIds) itemOfLine.set(id, item);
    for (const id of item.detailLineIds) ownerOfDetail.set(id, item);
    if (item.parentId)
      childrenOf.set(item.parentId, [...(childrenOf.get(item.parentId) ?? []), item]);
  }
  const isProse = (id: string) => !itemOfLine.has(id) && !ownerOfDetail.has(id);

  /** Lines already in a segment, or dropped. */
  const claimed = new Set<string>();
  /** Lines whose rule underneath is a table's edge, not an answer line (#100). */
  const edges = new Set<string>();
  const out: Array<{ order: number; sub: number; segment: Segment }> = [];
  const emit = (segment: Segment, sub = 0) => {
    for (const id of segment.lineIds) claimed.add(id);
    out.push({ order: Math.min(...segment.lineIds.map((id) => at(id).order)), sub, segment });
  };
  const sorted = (ids: Iterable<string>) =>
    [...new Set(ids)].sort((a, b) => at(a).order - at(b).order);

  // ── Evidence ──────────────────────────────────────────────────────────────────────────────────
  const ruled = (line: Line) => line.ir.hints.ruleBelow && !edges.has(line.ir.id);
  /** Something on the line to answer in: a blank run, a checkbox, a printed answer line. */
  const answerSpace = (line: Line) =>
    line.ir.hints.blankRun || line.ir.hints.checkboxes > 0 || ruled(line);
  const itemAnswerSpace = (item: Item) => item.lineIds.some((id) => answerSpace(at(id)));
  const free = (ids: readonly string[]) => ids.every((id) => !claimed.has(id));

  /** A line that is only blank runs: the answer space of the label above it (#24). */
  const onlyBlank = (line: Line) => line.ir.words.every((word) => isBlankWord(word.text));
  /** A row number and nothing else: "1", "2.", "3)". */
  const onlyRowNumber = (line: Line) =>
    line.ir.words.length === 1 && /^\d{1,3}[.)]?$/u.test(line.ir.words[0]!.text);

  /**
   * An item's words after its marker, line by line; a line's words, for a line. A glued marker's
   * label starts inside its word (M10, M12): that word's rest is the first.
   */
  const textWords = (line: Line): IrWord[] => {
    const item = itemOfLine.get(line.ir.id);
    const words = line.ir.words;
    if (!item || item.lineIds[0] !== line.ir.id) return boxesApart(words);
    const glued = item.marker.glued;
    if (glued === undefined) return boxesApart(words.slice(item.marker.wordCount));
    const first = words[0]!;
    return boxesApart([pieceOf(first, glued, first.text.length), ...words.slice(1)]);
  };

  // ── Pass 1: structures ────────────────────────────────────────────────────────────────────────

  /**
   * The label of a grid or table: the line just before it, when it is a body line that reads as a
   * label — at most 120 characters, not ending in "." or "!", with no answer space of its own —
   * whether prose or an item of one line. Failing that, a question within the section that
   * points at a table and has no answer space (`grid-table-reference`).
   */
  function labelFor(first: Line): {
    label: string | null;
    itemId: string | null;
    lineIds: string[];
    flags: SegmentFlag[];
    rule: string;
  } {
    const before = lines[first.order - 1];
    const none = { label: null, itemId: null, lineIds: [], flags: [], rule: 'none' };
    if (!before || before.ir.pageNo !== first.ir.pageNo || claimed.has(before.ir.id)) return none;
    edges.add(before.ir.id);
    const labelUnit = (line: Line): { text: string; item: Item | null; ids: string[] } | null => {
      if (line.role !== 'body' || ownerOfDetail.has(line.ir.id)) return null;
      const item = itemOfLine.get(line.ir.id);
      if (!item) return { text: line.ir.text, item: null, ids: [line.ir.id] };
      if (childrenOf.has(item.id) || !free(item.lineIds)) return null;
      return { text: item.label, item, ids: [...item.lineIds] };
    };
    const direct = labelUnit(before);
    if (
      direct &&
      [...direct.text].length <= LABEL_MAX &&
      !endsWithAny(direct.text, '.!') &&
      !direct.ids.some((id) => answerSpace(at(id)))
    ) {
      return {
        label: labelOf(direct.text),
        itemId: direct.item?.id ?? null,
        lineIds: direct.ids,
        flags: [],
        rule: 'direct',
      };
    }
    for (let i = before.order, n = 0; i >= 0 && n < REFERENCE_REACH; i -= 1, n += 1) {
      const line = lines[i]!;
      if (line.ir.pageNo !== first.ir.pageNo || line.role === 'heading') break;
      if (claimed.has(line.ir.id)) continue;
      const unit = labelUnit(line);
      if (!unit || !mentionsTable(unit.text) || unit.ids.some((id) => answerSpace(at(id)))) {
        continue;
      }
      if (unit.item && unit.item.lineIds[0] !== line.ir.id) continue;
      return {
        label: labelOf(unit.text),
        itemId: unit.item?.id ?? null,
        lineIds: unit.ids,
        flags: ['label-by-reference'],
        rule: 'reference',
      };
    }
    return none;
  }

  /** Words into header cells: adjacent words closer than one em are one cell ("Vet ej"). */
  function cellsOf(words: readonly IrWord[]): Array<{ x0: number; x1: number; text: string }> {
    const cells: Array<{ x0: number; x1: number; words: IrWord[] }> = [];
    for (const word of [...words].sort((a, b) => a.box.x0 - b.box.x0)) {
      const last = cells[cells.length - 1];
      if (last && word.box.x0 - last.x1 < word.fontSize) {
        last.words.push(word);
        last.x1 = Math.max(last.x1, word.box.x1);
      } else {
        cells.push({ x0: word.box.x0, x1: word.box.x1, words: [word] });
      }
    }
    return cells.map((cell) => ({ x0: cell.x0, x1: cell.x1, text: joinWords(cell.words) }));
  }

  /**
   * The header row just above a structure's first row: the lines on the nearest baseline above
   * it, across regions — stage 2 cuts a header of separate cells into a region per cell.
   */
  function headerAbove(first: Line): Line[] {
    const header: Line[] = [];
    const nearest = lines[first.order - 1];
    if (!nearest || nearest.ir.pageNo !== first.ir.pageNo) return header;
    if (nearest.ir.baseline >= first.ir.baseline) return header;
    for (let i = nearest.order; i >= 0; i -= 1) {
      const line = lines[i]!;
      if (line.ir.pageNo !== first.ir.pageNo || claimed.has(line.ir.id)) break;
      if (Math.abs(line.ir.baseline - nearest.ir.baseline) * 2 > nearest.ir.fontSize) break;
      header.unshift(line);
    }
    return header;
  }

  // 1a. Grids from geometry (rule 2): rows of a label and then only checkboxes, aligned.
  /** The checkbox words of a grid row — a label, then only checkboxes — or null. */
  const gridBoxes = (line: Line): IrWord[] | null => {
    if (line.role === 'table' || line.role === 'page-furniture') return null;
    const words = textWords(line);
    const first = words.findIndex((word) => isCheckboxWord(word.text));
    if (first < 1 || !hasLetter(joinWords(words.slice(0, first)))) return null;
    const boxes = words.slice(first);
    return boxes.every((word) => isCheckboxWord(word.text)) ? boxes : null;
  };
  const aligned = (a: readonly IrWord[], b: readonly IrWord[], width: number) =>
    a.length === b.length &&
    a.every((word, i) => Math.abs(word.box.x0 - b[i]!.box.x0) * 50 <= width);

  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!;
    const boxes = gridBoxes(first);
    if (!boxes || claimed.has(first.ir.id)) continue;
    const rows = [first];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!;
      const more = gridBoxes(next);
      const width = first.column.x1 - first.column.x0;
      if (!more || next.ir.pageNo !== first.ir.pageNo || !aligned(boxes, more, width)) break;
      rows.push(next);
    }
    if (rows.length < 2) continue;

    const header = headerAbove(first);
    const cells = cellsOf(header.flatMap((line) => line.ir.words));
    if (cells.some((cell) => /[_☐☑☒□■▢○●◯◻◼]/u.test(cell.text))) continue;
    // Each checkbox column under one header cell (its centre within the cell, give or take an
    // em), left to right. Cells left of the first answer column head the row labels (Session,
    // Day); a cell anywhere else means the header is not this grid's.
    const matched: number[] = [];
    for (const box of boxes) {
      const centre = Math.floor((box.box.x0 + box.box.x1) / 2);
      const em = box.fontSize;
      const from = matched.length ? matched[matched.length - 1]! + 1 : 0;
      const k = cells.findIndex(
        (cell, index) => index >= from && cell.x0 - em <= centre && centre <= cell.x1 + em,
      );
      if (k < 0) break;
      matched.push(k);
    }
    const contiguous = matched.every((k, n) => k === matched[0]! + n);
    if (
      header.length === 0 ||
      matched.length !== boxes.length ||
      !contiguous ||
      matched[matched.length - 1] !== cells.length - 1
    )
      continue;
    const columns = matched.map((k) => cells[k]!.text);

    const structureStart = header[0]!;
    for (const line of header) edges.add(line.ir.id);
    const label = labelFor(structureStart);
    const segment: GridSegment = {
      kind: 'grid',
      lineIds: sorted([
        ...label.lineIds,
        ...header.map((line) => line.ir.id),
        ...rows.map((row) => row.ir.id),
      ]),
      label: label.label,
      itemId: label.itemId,
      rows: rows.map((row) => {
        const words = textWords(row);
        return joinWords(
          words.slice(
            0,
            words.findIndex((word) => isCheckboxWord(word.text)),
          ),
        );
      }),
      columns,
      flags: label.flags,
    };
    emit(segment);
    decide(first.ir.id, label.flags.length ? 'S2r' : 'S2', segment.lineIds, 'grid', {
      rows: rows.length,
      columns: columns.length,
      label: label.rule,
    });
    i = rows[rows.length - 1]!.order;
  }

  // 1b. Tables from geometry (rule 3): numbered or empty rows under a header of widely spaced
  // words. The rows are found first, because a header is only a line of words until rows follow.
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!;
    const rowLike = (line: Line) =>
      line.role !== 'table' &&
      line.role !== 'page-furniture' &&
      !claimed.has(line.ir.id) &&
      (onlyRowNumber(line) || onlyBlank(line));
    if (!rowLike(first)) continue;
    const rows = [first];
    for (let j = i + 1; j < lines.length && rowLike(lines[j]!); j += 1) {
      if (lines[j]!.ir.pageNo !== first.ir.pageNo) break;
      rows.push(lines[j]!);
    }
    const numbers = rows.filter(onlyRowNumber).map((row) => Number.parseInt(row.ir.text, 10));
    const counted = numbers.every((n, k) => n === k + 1);
    const header = headerAbove(first);
    const cells = cellsOf(header.flatMap((line) => line.ir.words));
    const em = header[0]?.ir.fontSize ?? 0;
    const spread =
      cells.length >= 2 &&
      cells.every((cell, k) => k === 0 || cell.x0 - cells[k - 1]!.x1 >= 4 * em) &&
      header.every((line) => !line.ir.hints.blankRun && line.ir.hints.checkboxes === 0);
    if (rows.length < 2 || !counted || !spread) continue;
    for (const line of header) edges.add(line.ir.id);
    const label = labelFor(header[0]!);
    const table: TableSegment = {
      kind: 'table',
      lineIds: sorted([
        ...label.lineIds,
        ...header.map((line) => line.ir.id),
        ...rows.map((row) => row.ir.id),
      ]),
      label: label.label,
      itemId: label.itemId,
      columns: cells.map((cell) => cell.text),
      rowCount: rows.length,
      shape: 'repeating-rows',
      flags: label.flags,
    };
    emit(table);
    decide(first.ir.id, 'S3', table.lineIds, 'table', {
      rows: rows.length,
      columns: cells.length,
      label: label.rule,
    });
    i = rows[rows.length - 1]!.order;
  }

  // 1c. Word tables (`w:tbl`): the cells say what geometry would have to guess.
  for (const block of doc.pages.flatMap((page) => page.blocks)) {
    if (block.role !== 'table') continue;
    const cellLines = block.lines.filter((line) => line.cell !== null);
    if (cellLines.length === 0 || !free(cellLines.map((line) => line.id))) continue;
    const rowsOf = new Map<number, Map<number, IrLine[]>>();
    for (const line of cellLines) {
      const { row, col } = line.cell!;
      const cols = rowsOf.get(row) ?? new Map<number, IrLine[]>();
      cols.set(col, [...(cols.get(col) ?? []), line]);
      rowsOf.set(row, cols);
    }
    const rowNumbers = [...rowsOf.keys()].sort((a, b) => a - b);
    const headerRow = rowsOf.get(rowNumbers[0]!)!;
    const body = rowNumbers.slice(1).map((row) => rowsOf.get(row)!);
    const text = (cell: IrLine[]) => joinLines(cell.map((line) => line.text));
    const isBoxCell = (cell: IrLine[]) => cell.length === 1 && isCheckboxWord(cell[0]!.text);
    const boxCols = (row: Map<number, IrLine[]>) =>
      [...row.entries()]
        .filter(([, cell]) => isBoxCell(cell))
        .map(([col]) => col)
        .sort((a, b) => a - b);
    const firstCols = body.length ? boxCols(body[0]!) : [];
    const isGrid =
      body.length >= 2 &&
      firstCols.length > 0 &&
      body.every((row) => {
        const cols = boxCols(row);
        const texts = [...row.entries()].filter(([, cell]) => !isBoxCell(cell));
        return (
          cols.join() === firstCols.join() &&
          texts.length > 0 &&
          texts.every(([col]) => col < firstCols[0]!)
        );
      }) &&
      firstCols.every((col) => headerRow.has(col) && !isBoxCell(headerRow.get(col)!));
    if (!isGrid) continue;
    const first = at(cellLines[0]!.id);
    const label = labelFor(first);
    const grid: GridSegment = {
      kind: 'grid',
      lineIds: sorted([...label.lineIds, ...cellLines.map((line) => line.id)]),
      label: label.label,
      itemId: label.itemId,
      rows: body.map((row) =>
        [...row.entries()]
          .filter(([, cell]) => !isBoxCell(cell))
          .sort(([a], [b]) => a - b)
          .map(([, cell]) => text(cell))
          .join(' '),
      ),
      columns: firstCols.map((col) => text(headerRow.get(col)!)),
      flags: label.flags,
    };
    emit(grid);
    decide(first.ir.id, label.flags.length ? 'S2r' : 'S2c', grid.lineIds, 'grid', {
      rows: body.length,
      columns: firstCols.length,
      label: label.rule,
    });
  }

  // 1d. Tables of text: read across each row, never down the columns (§4.3, `lagerschema`).
  // A PDF's table of text is cut by stage 2 into a region per header cell and a region per column
  // of cells, which it then reads column by column, exactly as it would two columns of text; the
  // geometry of the two is the same (`CAVEATS.md`, "Table or columns"). What says table: a header
  // row of two or more cells on one baseline, in regions side by side, none of them a list item,
  // either set in bold or over rows that are ruled; under it, rows of cells until a line that runs
  // the header's whole width. Each row, header included, is then one instruction, its words left
  // to right. A table of text is text to read; one with a blank or a box in it is left to the
  // line-by-line rules. (Stage 2 is unchanged: the two-column list in `anmalan-tva-spalter` has
  // numbered items where a header would be, and still reads down its columns.)
  // A cell of a table of text: no answer space, no list item, and not a label ending in ":" — a
  // form laid out in a table is questions (`docx-layout-table`).
  const plainCells = (line: Line) =>
    !line.ir.hints.blankRun &&
    line.ir.hints.checkboxes === 0 &&
    !itemOfLine.has(line.ir.id) &&
    !line.ir.hints.endsWithColon;
  // A cell does not fill its column; a line of prose runs to its column's edge
  // (`two-columns-of-prose`: two columns under bold headings are not a table).
  const fillsColumn = (line: Line) =>
    (line.ir.box.x1 - line.column.x0) * 10 >= (line.column.x1 - line.column.x0) * 9;
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!;
    if (claimed.has(first.ir.id) || first.role === 'table' || first.role === 'page-furniture') {
      continue;
    }
    const header: Line[] = [];
    for (let j = i; j < lines.length; j += 1) {
      const line = lines[j]!;
      const sameRow = Math.abs(line.ir.baseline - first.ir.baseline) * 2 <= first.ir.fontSize;
      if (line.ir.pageNo !== first.ir.pageNo || !sameRow || claimed.has(line.ir.id)) break;
      if (header.some((cell) => cell.column.index === line.column.index)) break;
      header.push(line);
    }
    if (header.length < 2 || !header.every(plainCells)) continue;
    const left = Math.min(...header.map((cell) => cell.column.x0));
    const right = Math.max(...header.map((cell) => cell.column.x1));
    const body: Line[] = [];
    for (let j = i + header.length; j < lines.length; j += 1) {
      const line = lines[j]!;
      const across = line.column.x0 <= left && line.column.x1 >= right;
      if (line.ir.pageNo !== first.ir.pageNo || across || claimed.has(line.ir.id)) break;
      if (!plainCells(line) || line.role === 'page-furniture') break;
      body.push(line);
    }
    const rows: Line[][] = [];
    for (const line of [...body].sort(
      (a, b) => a.ir.baseline - b.ir.baseline || a.order - b.order,
    )) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(line.ir.baseline - row[0]!.ir.baseline) * 2 <= line.ir.fontSize) {
        row.push(line);
      } else rows.push([line]);
    }
    const acrossRegions = rows.some((row) => new Set(row.map((l) => l.column.index)).size >= 2);
    const bold = header.every((cell) => cell.ir.fontWeight === 700 || cell.role === 'heading');
    const ruled =
      rows.filter((row) => row.some((l) => l.ir.hints.ruleBelow)).length * 2 >= rows.length;
    if (rows.length < 2 || !acrossRegions || !(bold || ruled) || body.some(fillsColumn)) continue;
    for (const row of [header, ...rows]) {
      const words = row.flatMap((line) => line.ir.words).sort((a, b) => a.box.x0 - b.box.x0);
      const ids = sorted(row.map((line) => line.ir.id));
      for (const id of ids) edges.add(id);
      emit({ kind: 'instruction', lineIds: ids, text: joinWords(words) });
      decide(ids[0]!, 'S3t', ids, 'instruction', { cells: row.length });
    }
    const before = lines[first.order - 1];
    if (before) edges.add(before.ir.id);
    i = Math.max(...[...header, ...body].map((line) => line.order));
  }

  // 1e. Word tables of text: the same, from the cells — each row, its cells in order.
  for (const block of doc.pages.flatMap((page) => page.blocks)) {
    if (block.role !== 'table') continue;
    const cellLines = block.lines.filter((line) => line.cell !== null && !claimed.has(line.id));
    if (cellLines.length === 0 || !cellLines.every((line) => plainCells(at(line.id)))) continue;
    const rows = new Map<number, IrLine[]>();
    for (const line of cellLines)
      rows.set(line.cell!.row, [...(rows.get(line.cell!.row) ?? []), line]);
    // A table of text has two cells or more in each row; a label alone in its row, its answer
    // cell empty, is a form laid out in a table.
    const cellsIn = (row: IrLine[]) => new Set(row.map((line) => line.cell!.col)).size;
    if (rows.size < 2 || [...rows.values()].some((row) => cellsIn(row) < 2)) continue;
    for (const row of [...rows.keys()].sort((a, b) => a - b)) {
      const cells = [...rows.get(row)!].sort((a, b) => a.cell!.col - b.cell!.col);
      const ids = sorted(cells.map((line) => line.id));
      emit({ kind: 'instruction', lineIds: ids, text: cells.map((line) => line.text).join(' ') });
      decide(ids[0]!, 'S3tc', ids, 'instruction', { cells: cells.length });
    }
  }

  // 1f. Word tables of rows to fill in (S3c, #153): a header row of two cells or more, and rows
  // that hold nothing but their number, 1, 2, 3 … in order — S3 from the cells, which say what
  // geometry has to find. A table whose rows are empty, unnumbered, has no lines to count them by
  // (IR version 1 keeps no empty cell), and is left to the line rules.
  for (const block of doc.pages.flatMap((page) => page.blocks)) {
    if (block.role !== 'table') continue;
    const cellLines = block.lines.filter((line) => line.cell !== null && !claimed.has(line.id));
    if (cellLines.length === 0) continue;
    const rows = new Map<number, IrLine[]>();
    for (const line of cellLines)
      rows.set(line.cell!.row, [...(rows.get(line.cell!.row) ?? []), line]);
    const order = [...rows.keys()].sort((a, b) => a - b);
    const headerCells = new Map<number, IrLine[]>();
    for (const line of rows.get(order[0]!)!)
      headerCells.set(line.cell!.col, [...(headerCells.get(line.cell!.col) ?? []), line]);
    const columns = [...headerCells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, cell]) => joinLines(cell.map((line) => line.text)));
    const body = order.slice(1).map((row) => rows.get(row)!);
    const numbered = body.every(
      (row, k) =>
        row.length === 1 &&
        /^\d{1,3}[.)]?$/u.test(row[0]!.text) &&
        Number.parseInt(row[0]!.text, 10) === k + 1,
    );
    const plainHeader = [...headerCells.values()]
      .flat()
      .every((line) => !line.hints.blankRun && line.hints.checkboxes === 0);
    if (body.length < 2 || columns.length < 2 || !numbered || !plainHeader) continue;
    const first = at(cellLines[0]!.id);
    for (const line of cellLines) edges.add(line.id);
    const label = labelFor(first);
    const table: TableSegment = {
      kind: 'table',
      lineIds: sorted([...label.lineIds, ...cellLines.map((line) => line.id)]),
      label: label.label,
      itemId: label.itemId,
      columns,
      rowCount: body.length,
      shape: 'repeating-rows',
      flags: label.flags,
    };
    emit(table);
    decide(first.ir.id, 'S3c', table.lineIds, 'table', {
      rows: body.length,
      columns: columns.length,
      label: label.rule,
    });
  }

  // ── Pass 2: items with items under them ───────────────────────────────────────────────────────

  const optionLike = (item: Item) =>
    OPTION_FAMILIES.has(item.marker.family) &&
    !itemAnswerSpace(item) &&
    !endsWithAny(item.label, '?:') &&
    free(item.lineIds);
  const question = (
    lineIds: Iterable<string>,
    label: string,
    itemId: string | null,
    answer: Answer,
    options: string[] = [],
    details: string[] = [],
    flags: SegmentFlag[] = [],
  ): QuestionSegment => ({
    kind: 'question',
    lineIds: sorted(lineIds),
    label,
    itemId,
    answer,
    options,
    details,
    flags,
  });
  const detailsOf = (item: Item) =>
    item.detailLineIds.filter((id) => !claimed.has(id)).map((id) => at(id).ir.text);

  /** A run of option-like items starting at a line: letters or bullets of one run and level. */
  function optionRunAt(line: Line | undefined): Item[] {
    const head = line && itemOfLine.get(line.ir.id);
    if (!head || head.lineIds[0] !== line.ir.id || !optionLike(head)) return [];
    const run = [head];
    for (const item of items.slice(items.indexOf(head) + 1)) {
      if (item.level > head.level) continue;
      if (item.runId !== head.runId || item.level !== head.level || !optionLike(item)) break;
      run.push(item);
    }
    return run;
  }

  /** Lines that each start with one checkbox and then words: the options under a question. */
  function boxLinesAfter(line: Line): Line[] {
    const run: Line[] = [];
    for (let i = line.order + 1; i < lines.length; i += 1) {
      const next = lines[i]!;
      const words = boxesApart(next.ir.words);
      // Within the question's block: a paragraph break ends its answers (`single-checkbox-line`).
      const single =
        !claimed.has(next.ir.id) &&
        next.block.id === line.block.id &&
        words.length >= 2 &&
        isCheckboxWord(words[0]!.text) &&
        next.ir.hints.checkboxes === 1 &&
        !next.ir.hints.blankRun;
      if (!single) break;
      run.push(next);
    }
    return run;
  }

  // In reading order, so that the question that comes first claims the answers under it: letters
  // under "Vilken nivå har du?" are its answers even when stage 3 nested bullets under the last
  // of them (`prose-question`).
  for (const line of lines) {
    if (claimed.has(line.ir.id) || line.role !== 'body' || ownerOfDetail.has(line.ir.id)) continue;
    const item = itemOfLine.get(line.ir.id);
    if (item && item.lineIds[0] !== line.ir.id) continue;
    const ids = item ? item.lineIds : [line.ir.id];
    const text = item ? item.label : line.ir.text;
    if (!free(ids) || ids.some((id) => answerSpace(at(id)))) continue;
    const kids = item ? (childrenOf.get(item.id) ?? []) : [];

    if (item && kids.length > 0) {
      // 2a. Answers lettered or bulleted under an item, none with an answer space (§4.5).
      if (kids.length >= 2 && kids.every(optionLike)) {
        const segment = question(
          [
            ...item.lineIds,
            ...item.detailLineIds,
            ...kids.flatMap((kid) => [...kid.lineIds, ...kid.detailLineIds]),
          ],
          labelOf(item.label),
          item.id,
          'choice',
          kids.map((kid) => kid.label),
          detailsOf(item),
        );
        emit(segment);
        decide(line.ir.id, 'S5b', segment.lineIds, 'question:choice', { options: kids.length });
        continue;
      }
      // 2b. A numbered line whose own items are the questions is a section (§4.5).
      if (!endsWithAny(item.label, '?') && [...item.label].length <= SECTION_MAX) {
        emit({ kind: 'heading', lineIds: sorted(item.lineIds), text: item.label });
        decide(line.ir.id, 'S1c', item.lineIds, 'heading', { children: kids.length });
      }
      continue;
    }
    if ([...text].length > LABEL_MAX) continue;
    const last = at(ids[ids.length - 1]!);
    // 2c. Lettered answers under a sentence that asks (§4.7).
    if (!item && endsWithAny(text, '?')) {
      const run = optionRunAt(lines[last.order + 1]);
      if (run.length >= 2) {
        const segment = question(
          [...ids, ...run.flatMap((option) => [...option.lineIds, ...option.detailLineIds])],
          labelOf(text),
          null,
          'choice',
          run.map((option) => option.label),
        );
        emit(segment);
        decide(line.ir.id, 'S5c', segment.lineIds, 'question:choice', { options: run.length });
        continue;
      }
    }
    // 2d. Lines of one checkbox each under a question (§4.4) — one that asks as §4.7 reads it: a
    // note in brackets after its question mark asks too (#150).
    if (endsWithAny(text, '?:') || ASKS.test(text)) {
      const boxes = boxLinesAfter(last);
      if (boxes.length >= 2) {
        // Stage 3 may have kept the boxes as the item's notes: as its options, they are not its
        // notes too, or the question would show its answers twice (`CAVEATS.md` #134).
        const boxIds = new Set(boxes.map((box) => box.ir.id));
        const notes = item
          ? item.detailLineIds
              .filter((id) => !claimed.has(id) && !boxIds.has(id))
              .map((id) => at(id).ir.text)
          : [];
        const segment = question(
          [...ids, ...boxes.map((box) => box.ir.id)],
          labelOf(text),
          item?.id ?? null,
          'choice',
          boxes.map((box) => joinWords(boxesApart(box.ir.words).slice(1))),
          notes,
        );
        emit(segment);
        decide(line.ir.id, 'S5d', segment.lineIds, 'question:choice', { options: boxes.length });
      }
    }
  }

  // ── Pass 3: every line or item left, rule by rule ────────────────────────────────────────────

  /** The lines of nothing but a blank directly under a line, in its block (#24). */
  function blankLinesAfter(line: Line): string[] {
    const room: string[] = [];
    for (let i = line.order + 1; i < lines.length; i += 1) {
      const next = lines[i]!;
      if (next.block.id !== line.block.id || claimed.has(next.ir.id)) break;
      if (!isProse(next.ir.id) || !onlyBlank(next)) break;
      room.push(next.ir.id);
    }
    return room;
  }

  /** A block's line pitch: the lower quartile of its baseline gaps, as stage 2 measures it. */
  const pitches = new Map<string, number>();
  const pitchOf = (block: IrBlock): number => {
    const known = pitches.get(block.id);
    if (known !== undefined) return known;
    const gaps = block.lines
      .slice(1)
      .map((line, i) => line.baseline - block.lines[i]!.baseline)
      .sort((a, b) => a - b);
    const pitch = gaps.length ? gaps[Math.floor((gaps.length - 1) / 4)]! : 0;
    pitches.set(block.id, pitch);
    return pitch;
  };

  const wrapped = (line: Line) =>
    (line.ir.box.x1 - line.column.x0) * 10 >= (line.column.x1 - line.column.x0) * 9;
  const measured = (line: Line) => line.ir.source === 'text-layer' || line.ir.source === 'ocr';

  for (const line of lines) {
    const id = line.ir.id;
    if (claimed.has(id)) continue;

    if (line.role === 'page-furniture') {
      claimed.add(id);
      decide(id, 'S0', [id], 'dropped');
      continue;
    }

    const item = itemOfLine.get(id);
    const owner = ownerOfDetail.get(id);
    // A detail line or a continuation line whose item was not claimed is read on its own.
    const asItem = item && item.lineIds[0] === id && free(item.lineIds) ? item : null;
    let ids = asItem ? asItem.lineIds.filter((x) => !claimed.has(x)) : [id];
    let words = asItem
      ? asItem.lineIds.flatMap((x) => textWords(at(x)))
      : boxesApart(line.ir.words);
    let text = asItem ? asItem.label : line.ir.text;
    const unitLines = ids.map(at);
    const space = unitLines.some(answerSpace);
    const boxes = words.filter((word) => isCheckboxWord(word.text));
    const blanks = partsOf(text);

    // Rule 1: headings, and the small print that is a footnote.
    if (line.role === 'heading') {
      const heading = line.block.lines
        .map((l) => l.id)
        .filter((x) => !claimed.has(x) && (!itemOfLine.has(x) || x === id));
      const headingText = asItem ? asItem.label : joinLines(heading.map((x) => at(x).ir.text));
      const headingIds = asItem ? ids : heading;
      emit({ kind: 'heading', lineIds: sorted(headingIds), text: headingText });
      decide(id, 'S1', headingIds, 'heading', { lines: headingIds.length });
      continue;
    }
    if (line.role === 'footnote') {
      const note = line.block.lines.map((l) => l.id).filter((x) => !claimed.has(x));
      emit({ kind: 'instruction', lineIds: note, text: joinLines(note.map((x) => at(x).ir.text)) });
      decide(id, 'S8b', note, 'instruction', { lines: note.length });
      continue;
    }
    // Rule 9: a form number or a revision.
    if (!asItem && isMetaLine(text)) {
      emit({ kind: 'meta', lineIds: [id], text });
      decide(id, 'S9', [id], 'meta');
      continue;
    }
    // Rule 1: a line in capitals inside the text is a heading, never a field (#23).
    const cased = [...text].filter((c) => c.toLowerCase() !== c.toUpperCase());
    if (
      !asItem &&
      !owner &&
      !space &&
      cased.length >= 3 &&
      cased.every((c) => c === c.toUpperCase()) &&
      [...text].length <= 60 &&
      !endsWithAny(text, '.,:;?!')
    ) {
      emit({ kind: 'heading', lineIds: [id], text });
      decide(id, 'S1b', [id], 'heading');
      continue;
    }

    const itemId = asItem?.id ?? null;
    const details = asItem ? detailsOf(asItem) : [];
    const withDetails = (lineIds: string[]) =>
      asItem ? [...lineIds, ...asItem.detailLineIds.filter((x) => !claimed.has(x))] : lineIds;

    // A box's words run on as a paragraph does (#154): a box line that reaches its column's edge
    // goes on in the lines of text after it in its block, at the block's pitch. (An item's lines
    // are joined by stage 3 already.)
    if (!asItem && boxes.length > 0) {
      for (let last = line; measured(last) && wrapped(last);) {
        const following = lines[last.order + 1];
        if (
          !following ||
          following.block.id !== line.block.id ||
          claimed.has(following.ir.id) ||
          !isProse(following.ir.id) ||
          answerSpace(following) ||
          (following.ir.baseline - last.ir.baseline) * 10 > pitchOf(line.block) * 11
        )
          break;
        ids = [...ids, following.ir.id];
        words = [...words, ...boxesApart(following.ir.words)];
        last = following;
      }
    }

    // Rules 4 and 5: checkboxes.
    if (boxes.length > 0) {
      const first = words.findIndex((word) => isCheckboxWord(word.text));
      const options: string[] = [];
      for (let k = first; k < words.length; k += 1) {
        if (!isCheckboxWord(words[k]!.text)) continue;
        let end = k + 1;
        while (end < words.length && !isCheckboxWord(words[end]!.text)) end += 1;
        options.push(joinWords(words.slice(k + 1, end)));
      }
      const label = labelOf(joinWords(words.slice(0, first)));
      // Rule 4b: one checkbox and words, the box first or last — ticked or not; the words are the
      // label ("☐ Jag godkänner …", "Har du allergier? ☐").
      const last = boxes.length === 1 && first === words.length - 1 && label !== '';
      if (boxes.length === 1 && ((first === 0 && options[0]) || last)) {
        const segment = question(
          withDetails(ids),
          last ? label : options[0]!,
          itemId,
          'boolean',
          [],
          details,
        );
        emit(segment);
        decide(id, 'S4b', segment.lineIds, 'question:boolean', { box: last ? 'last' : 'first' });
        continue;
      }
      if (options.every(Boolean) && options.length >= 2) {
        const boolean = isBooleanPair(options);
        const segment = question(
          withDetails(ids),
          label,
          itemId,
          boolean ? 'boolean' : 'choice',
          options,
          details,
        );
        emit(segment);
        decide(id, boolean ? 'S4' : 'S5', segment.lineIds, `question:${segment.answer}`, {
          options: options.length,
        });
        continue;
      }
      // Checkboxes with no words to name them, and no header: what they answer is not on the line.
      const segment = question(
        withDetails(ids),
        labelOf(joinWords(words.filter((word) => !isCheckboxWord(word.text)))),
        itemId,
        'unknown',
        [],
        details,
      );
      emit(segment);
      decide(id, 'S5', segment.lineIds, 'question:unknown', { checkboxes: boxes.length });
      continue;
    }

    // Rule 6: labelled blanks.
    const pairs: string[] = [];
    let pending = '';
    for (const part of blanks) {
      if (part.blank) {
        if (hasLetter(pending)) pairs.push(pending);
        else if (pairs.length) pairs[pairs.length - 1] += ` ${pending}`;
        pending = '';
      } else pending += part.text;
    }
    if (pairs.length >= 2) {
      if (pending.trim()) pairs[pairs.length - 1] += ` ${pending}`;
      pairs.forEach((pair, k) => {
        const segment = question(
          k === 0 ? withDetails(ids) : ids,
          labelOf(pair),
          itemId,
          'blank',
          [],
          k === 0 ? details : [],
          ['split-line'],
        );
        emit(segment, k);
        decide(k === 0 ? id : `${id}#${k + 1}`, 'S6c', segment.lineIds, 'question:blank', {
          pairs: pairs.length,
        });
      });
      continue;
    }
    // Lines of nothing but a blank under a question's own are more room for its answer.
    const room = blankLinesAfter(unitLines[unitLines.length - 1]!);
    if (blanks.some((part) => part.blank) || unitLines.some(ruled)) {
      const rule = blanks.some((part) => part.blank) ? 'S6' : 'S6d';
      const segment = question(
        withDetails([...ids, ...room]),
        labelOf(text),
        itemId,
        'blank',
        [],
        details,
      );
      emit(segment);
      decide(id, rule, segment.lineIds, 'question:blank', { room: room.length });
      continue;
    }
    // #24: a label ending in ":" and, under it in its block, a line of nothing but a blank — or a
    // label with no colon, short and not ending a sentence, the test a grid's label meets (#151).
    const colon = halfWidth(text.trim()).endsWith(':');
    const labelLike = [...text].length <= LABEL_MAX && hasLetter(text) && !endsWithAny(text, '.!');
    if ((colon || labelLike) && room.length > 0) {
      const segment = question(
        withDetails([...ids, ...room]),
        labelOf(text),
        itemId,
        'blank',
        [],
        details,
      );
      emit(segment);
      decide(id, 'S6b', segment.lineIds, 'question:blank', { room: room.length, colon });
      continue;
    }

    // Rule 7: any other item is a question — but a bullet with nothing to answer is text. A
    // candidate is a question too, however it ends: a numbered sentence with nothing to fill in is
    // as often a prompt ("1. Berätta om …") as a note, and its low score has the review ask (#149).
    if (asItem) {
      if (asItem.marker.family === 'bullet') {
        emit({ kind: 'instruction', lineIds: ids, text: joinLines(ids.map((x) => at(x).ir.text)) });
        decide(id, 'S8c', ids, 'instruction');
        continue;
      }
      // Lines of nothing but a blank under it are its answer's room, as under a label (#24, #149).
      const answer = room.length > 0 ? 'blank' : 'unknown';
      const segment = question(
        withDetails([...ids, ...room]),
        labelOf(text),
        itemId,
        answer,
        [],
        details,
      );
      emit(segment);
      decide(id, 'S7', segment.lineIds, `question:${answer}`, {
        verdict: asItem.verdict,
        room: room.length,
      });
      continue;
    }

    // A paragraph: prose lines of one block, read as one (measured sources only; a Word or
    // pasted line is a paragraph of its own). The next line goes on with the paragraph when it is
    // at the block's line pitch — a paragraph's own spacing is more than a tenth larger — and the
    // line before it did not end a sentence short of the margin. (First written as "the line
    // before reached the margin", which cut a paragraph wherever a long word wrapped early and
    // joined two whenever a last line happened to be long — `arsmote-anmalan`.)
    let last = line;
    while (measured(last)) {
      const following = lines[last.order + 1];
      if (
        !following ||
        following.block.id !== line.block.id ||
        claimed.has(following.ir.id) ||
        !isProse(following.ir.id) ||
        answerSpace(following)
      )
        break;
      const gap = following.ir.baseline - last.ir.baseline;
      const pitch = pitchOf(line.block);
      const ended = !wrapped(last) && /[.!?:。！？：]$/u.test(last.ir.text);
      if (gap * 10 > pitch * 11 || ended) break;
      ids = [...ids, following.ir.id];
      last = following;
    }
    text = joinLines(ids.map((x) => at(x).ir.text));
    const length = [...text].length;

    // §4.7: a short sentence that asks, or a short label with its colon, is a question.
    const nextItem = lines[last.order + 1] && itemOfLine.get(lines[last.order + 1]!.ir.id);
    const introducesBullets = nextItem?.marker.family === 'bullet';
    // "Hur många gäster? (max 8)": a note in brackets after the question mark still asks.
    const asks = ASKS.test(text);
    // S1d (#156): a bold sentence that asks, with nothing to answer in, followed by a sentence
    // that ends — "¿Puedo llevar a mi perro?" and "Sí, siempre que vaya atado." — is the heading
    // of the note that answers it, not a field. Without the bold, or with room, boxes or another
    // question after it, it is a question.
    const after = lines[last.order + 1];
    if (
      asks &&
      ids.every((x) => at(x).ir.fontWeight === 700) &&
      after &&
      after.role === 'body' &&
      !claimed.has(after.ir.id) &&
      isProse(after.ir.id) &&
      !answerSpace(after) &&
      !ASKS.test(after.ir.text) &&
      endsWithAny(after.ir.text, '.!')
    ) {
      emit({ kind: 'heading', lineIds: ids, text });
      decide(id, 'S1d', ids, 'heading', { answeredBy: after.ir.id });
      continue;
    }
    if (
      (length <= LABEL_MAX && asks) ||
      (length <= COLON_LABEL_MAX && halfWidth(text).endsWith(':') && !introducesBullets)
    ) {
      const segment = question(ids, labelOf(text), null, 'unknown');
      emit(segment);
      decide(id, 'S7b', segment.lineIds, 'question:unknown');
      continue;
    }
    // Rule 8: everything else is text to read.
    emit({ kind: 'instruction', lineIds: ids, text });
    decide(id, 'S8', ids, 'instruction', { lines: ids.length });
  }

  // ── Flags over the whole document ─────────────────────────────────────────────────────────────
  out.sort((a, b) => a.order - b.order || a.sub - b.sub);
  const seen = new Set<string>();
  for (const { segment: s } of out) {
    if (s.kind !== 'question') continue;
    const key = folded(s.label)
      .replace(/[\s*:]+/gu, ' ')
      .trim();
    const flags = new Set(s.flags);
    if (key && seen.has(key)) flags.add('same-as-earlier');
    seen.add(key);
    if (s.options.length > MAX_OPTIONS) flags.add('many-options');
    s.flags = [...flags].sort();
  }

  return {
    output: { segments: out.map((entry) => entry.segment) },
    debug: {
      stage: 'segment',
      stageVersion: SEGMENT_STAGE_VERSION,
      irVersion: 1,
      inputSha256: inputsSha256({ layout: doc, lists }),
      decisions: decisions.sort(
        (a, b) =>
          at(a.id.slice('segment:'.length).split('#')[0]!).order -
            at(b.id.slice('segment:'.length).split('#')[0]!).order ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    },
  };
}

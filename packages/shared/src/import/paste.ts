import type { Box, IrBlock, IrColumn, IrLine, IrPage, IrWord, LayoutDocument } from './ir/types.js';

/**
 * Pasted text as a layout document — `docs/plan/LAYOUT-IR.md`, "How each source fills it", the
 * `paste` column. One pasted line is one line, blank lines separate blocks, and the geometry is
 * synthetic and says only what the paste said: order, indentation and paragraph breaks.
 *
 * A string is not a file's bytes, so this is pure and lives in the core rather than in
 * `apps/forms/src/screens/builder/paper/`: the ladder's T6 reads a pasted list through it and the
 * list-number detector, exactly as the importer reads a pasted document (`INTENT-LADDER.md`).
 * There is no stage 2 to run: with synthetic geometry there are no columns to find, no soft wraps
 * and no hyphenation to repair, so the document is built already reassembled.
 */

/** Which adapter made the document, for `source.extractor`. */
export const PASTE_EXTRACTOR = 'paste@1';
/** `IMPORT-PIPELINE.md`, the limits: longer text is refused before it is read. */
export const MAX_PASTE = 200_000;

// The synthetic metrics: a virtual A4 page, text area x 1000–9000, the first baseline at 1000 and
// each next line 180 lower, a new page after 9000, 131 iu type, 92 iu a character, a tab stop
// every 368 iu. A word's box reaches 105 above its baseline and 26 below, as the fixtures' do.
const LEFT = 1000;
const RIGHT = 9000;
const TOP = 1000;
const BOTTOM = 9000;
const PITCH = 180;
const SIZE = 131;
const ADVANCE = 92;
const TAB = 368;
const ASCENT = 105;
const DESCENT = 26;
const EDGE = 10_000;

const CHECKBOXES = /[☐☑☒□■▢○●◯◻◼]/gu;

/** A line past the page's edge is pinned to it: geometry here is synthetic, never measured. */
const pinned = (x: number) => Math.min(x, EDGE);

function union(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** `LineHints`, from the text alone — the only facts a paste can know. */
function hintsOf(text: string): IrLine['hints'] {
  const dots = /[.…]{2,}/gu;
  let leader = false;
  for (const run of text.match(dots) ?? []) {
    const count = [...run].reduce((n, c) => n + (c === '…' ? 3 : 1), 0);
    if (count >= 4) leader = true;
  }
  const blankRun = /_{3,}/u.test(text) || leader;
  const withoutBlanks = text.replace(/_{3,}/gu, '').replace(/[.…]{2,}/gu, (run) => {
    const count = [...run].reduce((n, c) => n + (c === '…' ? 3 : 1), 0);
    return count >= 4 ? '' : run;
  });
  return {
    blankRun,
    checkboxes: (text.match(CHECKBOXES) ?? []).length,
    endsWithColon: withoutBlanks.trim().endsWith(':'),
    ruleBelow: false,
    docxNumbering: null,
  };
}

/** A pasted line's words, placed; null for a blank line. */
function wordsOf(line: string, baseline: number): { words: IrWord[]; x0: number } | null {
  const box = (x0: number, length: number): Box => ({
    x0: pinned(x0),
    y0: baseline - ASCENT,
    x1: pinned(x0 + ADVANCE * length),
    y1: baseline + DESCENT,
  });
  const leading = /^[ \t]*/u.exec(line)![0];
  const indent = [...leading].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
  const x0 = LEFT + ADVANCE * indent;
  const words: IrWord[] = [];
  let x = x0;
  let offset = 0;
  let text = '';
  for (const piece of line.slice(leading.length).split(/([ \t]+)/u)) {
    if (piece === '') continue;
    if (/^[ \t]+$/u.test(piece)) {
      for (const c of piece)
        x = c === '\t' ? x0 + (Math.floor((x - x0) / TAB) + 1) * TAB : x + ADVANCE;
      continue;
    }
    const length = [...piece].length;
    if (text !== '') {
      text += ' ';
      offset += 1;
    }
    words.push({
      text: piece,
      start: offset,
      box: box(x, length),
      baseline,
      fontSize: SIZE,
      fontWeight: 400,
      italic: false,
      ocrConfidence: null,
      repair: null,
    });
    text += piece;
    offset += piece.length;
    x += ADVANCE * length;
  }
  return words.length === 0 ? null : { words, x0: pinned(x0) };
}

/**
 * Indent bands (`LAYOUT-IR.md`, "Indent bands"): starts sorted, a start joins the band opened by
 * the band's first value when within 2% of the column's width of it.
 */
function bandsOf(starts: readonly number[], width: number): number[] {
  const bands: number[] = [];
  for (const x of [...new Set(starts)].sort((a, b) => a - b)) {
    const open = bands[bands.length - 1];
    if (open === undefined || (x - open) * 50 > width) bands.push(x);
  }
  return bands;
}

function bandOf(bands: readonly number[], x: number): number {
  let band = 0;
  bands.forEach((start, i) => {
    if (start <= x) band = i;
  });
  return band;
}

/** Pasted text, as a layout document; nothing but blank lines is a document of no pages. */
export function pasteDocument(text: string): LayoutDocument {
  if (text.length > MAX_PASTE) throw new RangeError(`A paste is at most ${MAX_PASTE} characters`);
  const pages: IrPage[] = [];
  let page: { lines: IrLine[][]; open: IrLine[] } | null = null;
  let baseline = TOP;

  const finishPage = () => {
    if (!page) return;
    if (page.open.length > 0) page.lines.push(page.open);
    const pageNo = pages.length + 1;
    const blocks = page.lines.filter((lines) => lines.length > 0);
    if (blocks.length > 0) {
      const all = blocks.flat();
      const bands = bandsOf(
        all.map((line) => line.box.x0),
        RIGHT - LEFT,
      );
      const area = union(all.map((line) => line.box));
      const column: IrColumn = {
        index: 0,
        x0: LEFT,
        x1: RIGHT,
        y0: area.y0,
        y1: area.y1,
        bands,
      };
      let lineNo = 0;
      const irBlocks: IrBlock[] = blocks.map((lines, b) => {
        const id = `p${pageNo}-b${b + 1}`;
        const placed = lines.map((line) => {
          lineNo += 1;
          return {
            ...line,
            id: `p${pageNo}-l${lineNo}`,
            pageNo,
            blockId: id,
            indentBand: bandOf(bands, line.box.x0),
          };
        });
        return {
          id,
          pageNo,
          columnIndex: 0,
          role: 'body',
          box: union(placed.map((line) => line.box)),
          lines: placed,
        };
      });
      pages.push({ pageNo, widthPt: 595, heightPt: 842, columns: [column], blocks: irBlocks });
    }
    page = null;
  };

  for (const raw of text.split(/\r\n|\r|\n/u)) {
    if (baseline > BOTTOM) {
      finishPage();
      baseline = TOP;
    }
    page ??= { lines: [], open: [] };
    const placed = wordsOf(raw, baseline);
    if (!placed) {
      // A blank line ends the block it follows.
      if (page.open.length > 0) {
        page.lines.push(page.open);
        page.open = [];
      }
    } else {
      const { words } = placed;
      const lineText = words.map((word) => word.text).join(' ');
      page.open.push({
        id: '',
        pageNo: 0,
        columnIndex: 0,
        blockId: '',
        text: lineText,
        words,
        box: union(words.map((word) => word.box)),
        baseline,
        fontSize: SIZE,
        fontWeight: 400,
        indentBand: 0,
        source: 'paste',
        ocrConfidence: null,
        hints: hintsOf(lineText),
        cell: null,
      });
    }
    baseline += PITCH;
  }
  finishPage();
  return {
    irVersion: 1,
    source: { kind: 'paste', extractor: PASTE_EXTRACTOR, sha256: null },
    locale: null,
    pages,
  };
}

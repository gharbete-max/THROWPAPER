import type { z } from 'zod';
import { LayoutDocumentSchema, RawDocumentSchema } from './schema.js';
import type { Box, IrBlock, IrColumn, IrLine, LayoutDocument, RawDocument } from './types.js';

/**
 * The IR validator: `docs/plan/LAYOUT-IR.md`, "Invariants".
 *
 * A problem is a sentence naming where it is, never an exception, so a fixture author sees every
 * mistake at once. `parseLayoutDocument` is the one entry that throws, for callers that want a
 * typed document or nothing. The numbers in the comments are the document's invariant numbers.
 */

/** How many shape problems to list before summarising the rest; a broken file lists thousands. */
const MAX_SHAPE_PROBLEMS = 20;

export class IrError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Not a valid layout document: ${problems.slice(0, 3).join('; ')}`);
    this.name = 'IrError';
  }
}

/** Every problem with a layout document, as sentences. An empty list is a valid document. */
export function layoutProblems(input: unknown): string[] {
  const parsed = LayoutDocumentSchema.safeParse(input);
  return parsed.success ? layoutInvariants(parsed.data) : shapeProblems(parsed.error);
}

/** Every problem with a raw (stage 1) document, as sentences. */
export function rawProblems(input: unknown): string[] {
  const parsed = RawDocumentSchema.safeParse(input);
  return parsed.success ? rawInvariants(parsed.data) : shapeProblems(parsed.error);
}

/** The document, typed, or an `IrError` listing every problem. */
export function parseLayoutDocument(input: unknown): LayoutDocument {
  const problems = layoutProblems(input);
  if (problems.length > 0) throw new IrError(problems);
  return input as LayoutDocument;
}

function shapeProblems(error: z.ZodError): string[] {
  const problems = error.issues
    .slice(0, MAX_SHAPE_PROBLEMS)
    .map((issue) => `${issue.path.join('.') || '(document)'}: ${issue.message}`);
  const more = error.issues.length - MAX_SHAPE_PROBLEMS;
  if (more > 0) problems.push(`… and ${more} more`);
  return problems;
}

function inverted(box: Box): boolean {
  return box.x0 > box.x1 || box.y0 > box.y1;
}

/** The smaller of the two middle values for an even count (`LAYOUT-IR.md`, `IrLine`). */
function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1] ?? 0;
}

/** The band a furniture or footnote line is given: the one its x0 falls in, else 0. */
function bandContaining(column: IrColumn, x: number): number {
  const width = column.x1 - column.x0;
  const index = column.bands.findIndex((band) => band <= x && (x - band) * 50 <= width);
  return index < 0 ? 0 : index;
}

function layoutInvariants(doc: LayoutDocument): string[] {
  const problems: string[] = [];
  const say = (where: string, what: string) => problems.push(`${where}: ${what}`);

  doc.pages.forEach((page, pageIndex) => {
    const p = page.pageNo;
    // 2. pageNo runs 1, 2, 3… with no gaps.
    if (p !== pageIndex + 1) say(`page ${pageIndex + 1}`, `pageNo is ${p}`);

    page.columns.forEach((column, index) => {
      const at = `p${p} column ${index}`;
      if (column.index !== index) say(at, `index is ${column.index}`);
      if (inverted(column)) say(at, 'the region is inverted'); // 1.
      if (column.bands.some((band, i) => i > 0 && band <= (column.bands[i - 1] ?? -1))) {
        say(at, 'bands are not strictly ascending');
      }
    });

    let lineNo = 0;
    page.blocks.forEach((block, blockIndex) => {
      // 2. ids match their pattern and are numbered in reading order, so they are unique.
      const expectedBlockId = `p${p}-b${blockIndex + 1}`;
      if (block.id !== expectedBlockId) say(block.id, `expected id ${expectedBlockId}`);
      if (block.pageNo !== p) say(block.id, `pageNo is ${block.pageNo}, on page ${p}`);
      if (inverted(block.box)) say(block.id, 'box is inverted');
      const column = page.columns[block.columnIndex];
      if (!column) say(block.id, `no column ${block.columnIndex}`);

      let previousBaseline = -1;
      for (const line of block.lines) {
        lineNo += 1;
        const expectedLineId = `p${p}-l${lineNo}`;
        if (line.id !== expectedLineId) say(line.id, `expected id ${expectedLineId}`);
        if (line.baseline < previousBaseline) say(line.id, 'is above the line before it');
        previousBaseline = line.baseline;
        lineProblems(line, block, column, p, say);
      }
    });
  });
  return problems;
}

function lineProblems(
  line: IrLine,
  block: IrBlock,
  column: IrColumn | undefined,
  pageNo: number,
  say: (where: string, what: string) => void,
): void {
  const at = line.id;
  // 2. A line belongs to its block, its page and its block's column.
  if (line.blockId !== block.id) say(at, `blockId is ${line.blockId}, in ${block.id}`);
  if (line.pageNo !== pageNo) say(at, `pageNo is ${line.pageNo}, on page ${pageNo}`);
  if (line.columnIndex !== block.columnIndex) say(at, `columnIndex differs from ${block.id}'s`);

  // 1. Boxes.
  if (inverted(line.box)) say(at, 'box is inverted');
  for (const word of line.words) if (inverted(word.box)) say(at, `"${word.text}" box is inverted`);

  // 3. The text is the words joined by single spaces, and each start points at its word.
  const joined = line.words.map((word) => word.text).join(' ');
  if (line.text !== joined) say(at, 'text is not its words joined by single spaces');
  let offset = 0;
  for (const word of line.words) {
    if (word.start !== offset) say(at, `"${word.text}" starts at ${word.start}, not ${offset}`);
    offset += word.text.length + 1;
  }

  // 4. The indent band exists and the line's x0 lies in it.
  const band = column?.bands[line.indentBand];
  if (!column || band === undefined) {
    say(at, `no band ${line.indentBand} in column ${line.columnIndex}`);
  } else if (block.role === 'page-furniture' || block.role === 'footnote') {
    const expected = bandContaining(column, line.box.x0);
    if (line.indentBand !== expected) say(at, `indentBand should be ${expected}`);
  } else if (line.box.x0 < band || (line.box.x0 - band) * 50 > column.x1 - column.x0) {
    say(at, `x0 ${line.box.x0} is not in band ${line.indentBand} (${band})`);
  }

  // 5. OCR confidence exists exactly when the source is OCR.
  const ocr = line.source === 'ocr';
  if (ocr !== (line.ocrConfidence !== null)) say(at, `ocrConfidence for source ${line.source}`);
  if (line.words.some((word) => ocr !== (word.ocrConfidence !== null))) {
    say(at, `a word's ocrConfidence for source ${line.source}`);
  }

  // 6 holds by construction here: layout words carry no source of their own, only their line.

  // 7. The line's derived fields are what their definitions say.
  const union = {
    x0: Math.min(...line.words.map((word) => word.box.x0)),
    y0: Math.min(...line.words.map((word) => word.box.y0)),
    x1: Math.max(...line.words.map((word) => word.box.x1)),
    y1: Math.max(...line.words.map((word) => word.box.y1)),
  };
  if (
    line.box.x0 !== union.x0 ||
    line.box.y0 !== union.y0 ||
    line.box.x1 !== union.x1 ||
    line.box.y1 !== union.y1
  ) {
    say(at, 'box is not the union of its words');
  }
  if (line.baseline !== lowerMedian(line.words.map((word) => word.baseline))) {
    say(at, "baseline is not the median of its words'");
  }
  if (line.fontSize !== lowerMedian(line.words.map((word) => word.fontSize))) {
    say(at, "fontSize is not the median of its words'");
  }
  const bold = line.words.every((word) => word.fontWeight === 700) ? 700 : 400;
  if (line.fontWeight !== bold) say(at, `fontWeight should be ${bold}`);
  if (ocr) {
    const least = Math.min(...line.words.map((word) => word.ocrConfidence ?? 0));
    if (line.ocrConfidence !== least) say(at, `ocrConfidence should be ${least}`);
  }

  // 8. Facts only one kind of source can know.
  if (line.hints.ruleBelow && line.source !== 'text-layer') say(at, `ruleBelow on ${line.source}`);
  if (line.hints.docxNumbering && line.source !== 'docx') say(at, 'docxNumbering off DOCX');
  if (line.cell && line.source !== 'docx') say(at, 'cell off DOCX');
}

function rawInvariants(doc: RawDocument): string[] {
  const problems: string[] = [];
  const say = (where: string, what: string) => problems.push(`${where}: ${what}`);
  doc.pages.forEach((page, pageIndex) => {
    const p = page.pageNo;
    if (p !== pageIndex + 1) say(`page ${pageIndex + 1}`, `pageNo is ${p}`); // 2.
    page.rules.forEach((rule, i) => {
      if (inverted(rule)) say(`p${p} rule ${i}`, 'box is inverted'); // 1.
    });
    page.words.forEach((word, i) => {
      const at = `p${p} word ${i} ("${word.text}")`;
      if (inverted(word.box)) say(at, 'box is inverted'); // 1.
      if ((word.source === 'ocr') !== (word.ocrConfidence !== null)) {
        say(at, `ocrConfidence for source ${word.source}`); // 5.
      }
      // 8.
      const synthetic = word.source === 'docx' || word.source === 'paste';
      if (word.paragraph !== null && !synthetic) say(at, `paragraph on ${word.source}`);
      if (word.docxNumbering && word.source !== 'docx') say(at, 'docxNumbering off DOCX');
      if (word.cell && word.source !== 'docx') say(at, 'cell off DOCX');
    });
  });
  return problems;
}

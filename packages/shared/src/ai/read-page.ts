import type { PageRange } from '../summary/proofread.js';
import { Block, StructuredDocument, StructuredPage } from './document.js';
import type { ReadPageTask } from './task.js';

/**
 * Reading a page with the vision model: the pure parts (docs/plan/AI-SYSTEM.md D4).
 *
 * The model is asked for a small JSON shape under a grammar; whatever it answers is turned here
 * into a `StructuredPage`, never trusted as one. A page that cannot be turned into blocks is a
 * `failed` page with a reason, not a dropped one. A page whose words do not match the PDF's own
 * text layer is `uncertain`: neither reading overrides the other, the person is told.
 */

/** Part of every cache key: change it when the prompt or this file's rules change what a page reads as. */
export const PAGE_PIPELINE_VERSION = 2;

/** Pixels in a page picture. The server is started to take up to `high`'s worth (`imageMaxTokens`). */
export const PIXEL_BUDGET = { normal: 1_000_000, high: 2_000_000 } as const;
export type ReadQuality = keyof typeof PIXEL_BUDGET;
export const MAX_PNG_BYTES = 12 * 1024 * 1024;

/** The size to draw a page of `width` by `height` at so it holds within the budget; long side capped. */
export function pictureSize(
  width: number,
  height: number,
  quality: ReadQuality,
): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(PIXEL_BUDGET[quality] / (width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The shape of a page-reading task from a window; the picture's bytes are checked by the reader. */
export function isReadPageTask(value: unknown): value is ReadPageTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  const whole = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  return (
    task.kind === 'read-page' &&
    typeof task.fileSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(task.fileSha256) &&
    whole(task.page, 1, 5000) &&
    whole(task.longEdge, 64, 4096) &&
    (task.turn === 0 || task.turn === 90 || task.turn === 180 || task.turn === 270) &&
    (task.language === null || (typeof task.language === 'string' && task.language.length <= 12)) &&
    task.png instanceof Uint8Array &&
    task.png.byteLength > 0 &&
    task.png.byteLength <= MAX_PNG_BYTES
  );
}

/**
 * The long side to draw a page of this shape at so that it fills the budget, never more than
 * {@link MAX_LONG_EDGE}: a PDF page has no pixel size of its own, only a shape.
 */
export const MAX_LONG_EDGE = 2400;
export function longEdgeFor(width: number, height: number, quality: ReadQuality): number {
  const long = Math.max(width, height);
  const short = Math.max(1, Math.min(width, height));
  return Math.min(MAX_LONG_EDGE, Math.round(Math.sqrt((PIXEL_BUDGET[quality] * long) / short)));
}

/** The same page as page `n` of a document: a file's third page can be a document's tenth. */
export function renumber(page: StructuredPage, n: number): StructuredPage {
  return { ...page, page: n, blocks: page.blocks.map((block) => ({ ...block, page: n })) };
}

/** What the model answers with. Everything but the type is optional: a heading has no `label`. */
export const MODEL_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', maxLength: 12 },
    blocks: {
      type: 'array',
      maxItems: 120,
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['heading', 'paragraph', 'table', 'field', 'checkbox', 'figure'],
          },
          level: { type: 'integer', minimum: 1, maximum: 6 },
          text: { type: 'string', maxLength: 3000 },
          label: { type: 'string', maxLength: 300 },
          value: { type: 'string', maxLength: 600 },
          checked: { type: 'boolean' },
          caption: { type: 'string', maxLength: 300 },
          // A table is its rows, each a list of its cells' texts: the model spends most of a
          // page's time writing, and `{"row":1,"column":2,"text":..}` per cell was half of it
          // (docs/plan/VISION-TUNING.md: 49% faster on the 7B, same strings found).
          rows: {
            type: 'array',
            maxItems: 60,
            items: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  required: ['language', 'blocks'],
  additionalProperties: false,
} as const;

/** Confidence given to what the model read when no other reading could be compared with it. */
export const UNCHECKED_CONFIDENCE = 0.7;

interface Raw {
  language?: unknown;
  blocks?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function parseLoose(json: string): { raw: Raw; cutOff: boolean } | null {
  try {
    return { raw: JSON.parse(json) as Raw, cutOff: false };
  } catch {
    // Output that ran out of room: keep the blocks that were completed.
    const end = json.lastIndexOf('},');
    if (end < 0) return null;
    try {
      const raw = JSON.parse(`${json.slice(0, end + 1)}]}`) as Raw;
      return { raw, cutOff: true };
    } catch {
      return null;
    }
  }
}

function blockOf(item: unknown, page: number, language: string | null): Block | null {
  if (typeof item !== 'object' || item === null) return null;
  const raw = item as Record<string, unknown>;
  const common = { page, box: null, language, confidence: UNCHECKED_CONFIDENCE };
  let block: unknown = null;
  switch (raw.type) {
    case 'heading': {
      const level =
        typeof raw.level === 'number' ? Math.min(6, Math.max(1, Math.round(raw.level))) : 1;
      block = text(raw.text) && { type: 'heading', level, text: text(raw.text), ...common };
      break;
    }
    case 'paragraph':
      block = text(raw.text) && { type: 'paragraph', text: text(raw.text), ...common };
      break;
    case 'field':
      block = (text(raw.label) || text(raw.value)) && {
        type: 'field',
        label: text(raw.label),
        value: text(raw.value),
        ...common,
      };
      break;
    case 'checkbox':
      block = text(raw.label) && {
        type: 'checkbox',
        label: text(raw.label),
        checked: raw.checked === true,
        ...common,
      };
      break;
    case 'figure':
      block = { type: 'figure', caption: text(raw.caption) || null, ...common };
      break;
    case 'table': {
      // `rows` is what the model is asked for; `cells` (row and column given) is still read.
      const fromRows = (Array.isArray(raw.rows) ? raw.rows : []).flatMap((line: unknown, row) =>
        (Array.isArray(line) ? line : []).map((cell: unknown, column) => ({
          row,
          column,
          text: cell,
        })),
      );
      const given = Array.isArray(raw.cells) ? raw.cells : [];
      const cells = [...fromRows, ...given].flatMap((cell: unknown) => {
        const c = (typeof cell === 'object' && cell !== null ? cell : {}) as Record<
          string,
          unknown
        >;
        return Number.isInteger(c.row) &&
          Number.isInteger(c.column) &&
          (c.row as number) >= 0 &&
          (c.column as number) >= 0
          ? [
              {
                row: c.row as number,
                column: c.column as number,
                text: text(c.text),
                rowSpan: 1,
                columnSpan: 1,
              },
            ]
          : [];
      });
      if (cells.length === 0) break;
      block = {
        type: 'table',
        rows: Math.max(...cells.map((c) => c.row)) + 1,
        columns: Math.max(...cells.map((c) => c.column)) + 1,
        cells,
        ...common,
      };
      break;
    }
  }
  const parsed = Block.safeParse(block);
  return parsed.success ? parsed.data : null;
}

/**
 * Tables that follow one another are one table. The model, asked for a table, sometimes writes each
 * row as a table of its own (and spends most of its time doing it): their rows are put back
 * together, a block that starts again at row 0 below the last one, one that carries on from it
 * where it is.
 */
function mergeTables(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.type !== 'table' || last?.type !== 'table') {
      out.push(block);
      continue;
    }
    const first = Math.min(...block.cells.map((cell) => cell.row));
    const shift = first >= last.rows ? 0 : last.rows - first;
    const cells = [
      ...last.cells,
      ...block.cells.map((cell) => ({ ...cell, row: cell.row + shift })),
    ];
    out[out.length - 1] = {
      ...last,
      rows: Math.max(...cells.map((cell) => cell.row)) + 1,
      columns: Math.max(last.columns, block.columns),
      cells,
    };
  }
  return out;
}

/** A page that could not be read: listed with why, never dropped. */
export const failedPage = (page: number, reason: string): StructuredPage => ({
  page,
  status: 'failed',
  reason,
  blocks: [],
});

/**
 * The model's answer for one page, as a page. Never throws. `unreadable-output`: not the shape
 * asked for; `cut-off`: the answer ran out of room and only its finished blocks are kept.
 */
export function pageFromModel(page: number, json: string): StructuredPage {
  const parsed = parseLoose(json.trim());
  if (
    !parsed ||
    typeof parsed.raw !== 'object' ||
    parsed.raw === null ||
    Array.isArray(parsed.raw)
  ) {
    return failedPage(page, 'unreadable-output');
  }
  const language = text(parsed.raw.language) || null;
  const items = Array.isArray(parsed.raw.blocks) ? parsed.raw.blocks : [];
  const blocks = mergeTables(items.flatMap((item) => blockOf(item, page, language) ?? []));
  const result = StructuredPage.safeParse({
    page,
    status: parsed.cutOff ? 'uncertain' : 'ok',
    reason: parsed.cutOff ? 'cut-off' : null,
    blocks,
  });
  return result.success ? result.data : failedPage(page, 'unreadable-output');
}

// --- Cross-check -----------------------------------------------------------------------------

const words = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** How much of `reference` is found in `other`, counting repeats: 0 to 1. */
function overlap(reference: readonly string[], other: readonly string[]): number {
  if (reference.length === 0) return 1;
  const have = new Map<string, number>();
  for (const word of other) have.set(word, (have.get(word) ?? 0) + 1);
  let hit = 0;
  for (const word of reference) {
    const left = have.get(word) ?? 0;
    if (left > 0) {
      hit += 1;
      have.set(word, left - 1);
    }
  }
  return hit / reference.length;
}

/** Fewer words than this on the page's own text layer is not enough to judge a reading by. */
export const MIN_REFERENCE_WORDS = 15;
export const MIN_AGREEMENT = 0.6;
export const MIN_NUMBER_AGREEMENT = 0.8;

/** The words of a page as it will be read out and compared: everything the blocks hold. */
export function pageText(page: StructuredPage): string {
  return page.blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          return block.text;
        case 'field':
          return `${block.label}: ${block.value}`;
        case 'checkbox':
          return `${block.checked ? '[x]' : '[ ]'} ${block.label}`;
        case 'figure':
          return block.caption ?? '';
        case 'table': {
          const rows: string[][] = Array.from({ length: block.rows }, () => []);
          for (const cell of block.cells) (rows[cell.row] ??= [])[cell.column] = cell.text;
          return rows
            .filter((row) => row.some((cell) => cell))
            .map((row) => Array.from(row, (c) => c ?? '').join(' | '))
            .join('\n');
        }
      }
    })
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Compares a reading with the PDF's own text layer (or any other reading). Too different, in words
 * or in numbers, makes the page `uncertain` with reason `mismatch`; agreement sets the confidence of
 * every block. A layer with too little text to judge by leaves the page as it was.
 */
export function crossCheck(page: StructuredPage, layerText: string): StructuredPage {
  if (page.status === 'failed') return page;
  const layer = words(layerText);
  if (layer.length < MIN_REFERENCE_WORDS) return page;
  const read = words(pageText(page));
  const recall = overlap(layer, read);
  const precision = overlap(read, layer);
  const agreement = Math.min(recall, precision);
  const numbers = layer.filter((word) => /^\d+$/.test(word));
  const numbersOk = numbers.length < 3 || overlap(numbers, read) >= MIN_NUMBER_AGREEMENT;
  const agrees = agreement >= MIN_AGREEMENT && numbersOk;
  const confidence = Math.round(agreement * 100) / 100;
  const blocks = page.blocks.map((block) => ({ ...block, confidence }));
  if (agrees || page.status === 'uncertain') {
    return { ...page, blocks };
  }
  return { ...page, status: 'uncertain', reason: 'mismatch', blocks };
}

// --- The document ----------------------------------------------------------------------------

/** Pages in order from 1; a page nobody read yet is a failed page, never missing. */
export function assembleDocument(
  fileSha256: string,
  pageCount: number,
  read: ReadonlyMap<number, StructuredPage>,
): StructuredDocument {
  const pages = Array.from(
    { length: pageCount },
    (_, index) => read.get(index + 1) ?? failedPage(index + 1, 'not-read'),
  );
  return StructuredDocument.parse({ version: 1, fileSha256, pageCount, pages });
}

/**
 * The whole document as plain text, page after page, with where each page's words stand in it.
 * `heading` puts a line before each page ("Page 2"), so a summary can point back at pages.
 */
export function documentText(
  doc: StructuredDocument,
  heading?: (page: number) => string,
): { text: string; pages: PageRange[] } {
  let out = '';
  const pages: PageRange[] = [];
  for (const page of doc.pages) {
    const body = pageText(page);
    if (body === '') continue;
    if (out !== '') out += '\n\n';
    if (heading) out += `${heading(page.page)}\n`;
    const start = out.length;
    out += body;
    pages.push({ page: page.page, start, end: out.length });
  }
  return { text: out, pages };
}

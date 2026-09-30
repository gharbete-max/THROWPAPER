import { z } from 'zod';
import type {
  Box,
  Cell,
  DocxNumbering,
  IrLine,
  IrSourceInfo,
  IrWord,
  LayoutDocument,
  LineHints,
  RawDocument,
  Repair,
} from './types.js';

/**
 * The shape of the Layout IR, as Zod schemas typed against `types.ts`.
 *
 * Shape only: types, ranges, closed vocabularies, no unknown keys. The invariants that relate one
 * field to another (a line's text is its words, a line sits in its band, ids run 1, 2, 3…) are
 * `validate.ts`, because they need the whole document and read better as sentences than as
 * refinements. Objects are strict: a key the contract does not have is a different `irVersion`.
 */

const iu = z.number().int().min(0).max(10000);
const count = z.number().int().min(0);
const confidence = z.number().int().min(0).max(100).nullable();

const box: z.ZodType<Box> = z.object({ x0: iu, y0: iu, x1: iu, y1: iu }).strict();
const source = z.enum(['text-layer', 'ocr', 'docx', 'paste']);
const fontWeight = z.union([z.literal(400), z.literal(700)]);

const repair: z.ZodType<Repair> = z
  .object({ kind: z.enum(['dehyphenated', 'joined-at-break', 'ligature']), raw: z.string() })
  .strict();

const docxNumbering: z.ZodType<DocxNumbering> = z
  .object({
    numId: count,
    ilvl: z.number().int().min(0).max(8),
    rendered: z.string(),
    format: z.string().min(1),
  })
  .strict();

const cell: z.ZodType<Cell> = z.object({ row: count, col: count }).strict();

const sourceInfo: z.ZodType<IrSourceInfo> = z
  .object({
    kind: z.enum(['pdf', 'image', 'docx', 'paste']),
    extractor: z.string().min(1),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict();

const wordFields = {
  text: z.string().min(1),
  box,
  baseline: iu,
  fontSize: iu,
  fontWeight,
  italic: z.boolean(),
  ocrConfidence: confidence,
  repair: repair.nullable(),
};

const word: z.ZodType<IrWord> = z.object({ ...wordFields, start: count }).strict();

const hints: z.ZodType<LineHints> = z
  .object({
    blankRun: z.boolean(),
    checkboxes: count,
    endsWithColon: z.boolean(),
    ruleBelow: z.boolean(),
    docxNumbering: docxNumbering.nullable(),
  })
  .strict();

const line: z.ZodType<IrLine> = z
  .object({
    id: z.string(),
    pageNo: z.number().int().min(1),
    columnIndex: count,
    blockId: z.string(),
    text: z.string().min(1),
    words: z.array(word).min(1),
    box,
    baseline: iu,
    fontSize: iu,
    fontWeight,
    indentBand: count,
    source,
    ocrConfidence: confidence,
    hints,
    cell: cell.nullable(),
  })
  .strict();

export const LayoutDocumentSchema: z.ZodType<LayoutDocument> = z
  .object({
    irVersion: z.literal(1),
    source: sourceInfo,
    locale: z.string().min(1).nullable(),
    pages: z.array(
      z
        .object({
          pageNo: z.number().int().min(1),
          widthPt: z.number().int().min(1),
          heightPt: z.number().int().min(1),
          columns: z.array(
            z
              .object({
                index: count,
                x0: iu,
                x1: iu,
                y0: iu,
                y1: iu,
                bands: z.array(iu),
              })
              .strict(),
          ),
          blocks: z.array(
            z
              .object({
                id: z.string(),
                pageNo: z.number().int().min(1),
                columnIndex: count,
                role: z.enum(['body', 'heading', 'page-furniture', 'footnote', 'table']),
                box,
                lines: z.array(line).min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const RawDocumentSchema: z.ZodType<RawDocument> = z
  .object({
    irVersion: z.literal(1),
    source: sourceInfo,
    pages: z.array(
      z
        .object({
          pageNo: z.number().int().min(1),
          widthPt: z.number().int().min(1),
          heightPt: z.number().int().min(1),
          words: z.array(
            z
              .object({
                ...wordFields,
                source,
                paragraph: count.nullable(),
                docxNumbering: docxNumbering.nullable(),
                cell: cell.nullable(),
              })
              .strict(),
          ),
          rules: z.array(box),
        })
        .strict(),
    ),
  })
  .strict();

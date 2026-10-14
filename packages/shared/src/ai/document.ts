import { z } from 'zod';

/**
 * What reading a document produces (docs/plan/AI-SYSTEM.md D4): pages of blocks, each with where
 * it is, what language it is in and how sure the reader is. Whatever read it (the vision model,
 * the PDF's text layer, OCR), the result is this shape, so a summary, a question and a translation
 * consume one thing.
 *
 * A page that could not be read is listed with a reason, never dropped, and a page the readers
 * disagree on is `uncertain`: neither source silently overrides the other.
 */
const Unit = z.number().min(0).max(1);

/** A rectangle on the page as fractions of its width and height, origin top left. */
export const Box = z
  .object({ x: Unit, y: Unit, width: Unit, height: Unit })
  .strict()
  .refine((box) => box.x + box.width <= 1.0001 && box.y + box.height <= 1.0001, {
    message: 'the box leaves the page',
  });
export type Box = z.infer<typeof Box>;

const common = {
  page: z.number().int().positive(),
  box: Box,
  /** BCP 47, or null when it could not be told. */
  language: z.string().min(2).nullable(),
  confidence: z.number().min(0).max(1),
};

export const TableCell = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text: z.string(),
    rowSpan: z.number().int().positive().default(1),
    columnSpan: z.number().int().positive().default(1),
  })
  .strict();

export const Block = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('heading'),
      level: z.number().int().min(1).max(6),
      text: z.string(),
      ...common,
    })
    .strict(),
  z.object({ type: z.literal('paragraph'), text: z.string(), ...common }).strict(),
  z
    .object({
      type: z.literal('table'),
      rows: z.number().int().positive(),
      columns: z.number().int().positive(),
      cells: z.array(TableCell),
      ...common,
    })
    .strict(),
  z.object({ type: z.literal('field'), label: z.string(), value: z.string(), ...common }).strict(),
  z
    .object({ type: z.literal('checkbox'), label: z.string(), checked: z.boolean(), ...common })
    .strict(),
  z.object({ type: z.literal('figure'), caption: z.string().nullable(), ...common }).strict(),
]);
export type Block = z.infer<typeof Block>;

export const PAGE_STATUSES = ['ok', 'uncertain', 'failed'] as const;

export const StructuredPage = z
  .object({
    page: z.number().int().positive(),
    status: z.enum(PAGE_STATUSES),
    /** Why a page is not `ok`; null for an `ok` page. */
    reason: z.string().min(1).nullable(),
    blocks: z.array(Block),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.status !== 'ok' && page.reason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'a page that is not ok says why',
      });
    }
    if (page.status === 'failed' && page.blocks.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blocks'],
        message: 'a failed page has no blocks',
      });
    }
    page.blocks.forEach((block, index) => {
      if (block.page !== page.page) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocks', index, 'page'],
          message: `a block of page ${block.page} is on page ${page.page}`,
        });
      }
    });
  });
export type StructuredPage = z.infer<typeof StructuredPage>;

export const StructuredDocument = z
  .object({
    version: z.literal(1),
    /** SHA-256 of the original file. */
    fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
    pageCount: z.number().int().nonnegative(),
    pages: z.array(StructuredPage),
  })
  .strict()
  .superRefine((doc, context) => {
    doc.pages.forEach((page, index) => {
      if (page.page !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', index, 'page'],
          message: 'pages are in order from 1, none missing',
        });
      }
    });
    if (doc.pages.length > doc.pageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pageCount'],
        message: 'more pages than the document has',
      });
    }
  });
export type StructuredDocument = z.infer<typeof StructuredDocument>;

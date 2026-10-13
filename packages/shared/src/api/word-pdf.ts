import { z } from 'zod';

/**
 * A Word document as the rough Word-to-PDF route takes it (`POST /v1/pdf/word`, Phase 1c).
 *
 * The browser reads the `.docx` (rule 1: `api-forms` may not import `apps/forms`, so the reader
 * cannot move) and sends this: blocks in reading order, with only what the PDF keeps — headings,
 * paragraphs, bold and italic, Word's own list markers, tables, images and page breaks. The server
 * never sees the zip. Pure data; no model reads or writes it.
 */
export const WORD_PDF_LIMITS = {
  blocks: 20_000,
  runsPerParagraph: 2_000,
  textPerRun: 100_000,
  /** One picture, as bytes, and all of them together. */
  imageBytes: 4 * 1024 * 1024,
  imagesBytes: 8 * 1024 * 1024,
} as const;

export const WordRun = z.object({
  text: z.string().max(WORD_PDF_LIMITS.textPerRun),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
export type WordRun = z.infer<typeof WordRun>;

const Runs = z.array(WordRun).max(WORD_PDF_LIMITS.runsPerParagraph);

export const WordBlock = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), level: z.number().int().min(1).max(6), runs: Runs }),
  z.object({
    kind: z.literal('paragraph'),
    runs: Runs,
    /** Word's rendered list marker ("1.", "a)", a bullet), and the list level from 0. */
    marker: z.string().max(32).optional(),
    depth: z.number().int().min(0).max(8).optional(),
  }),
  z.object({
    kind: z.literal('table'),
    rows: z
      .array(
        z
          .array(
            z.object({
              colSpan: z.number().int().min(1).max(64),
              paragraphs: z.array(Runs).max(200),
            }),
          )
          .max(64),
      )
      .max(2_000),
  }),
  z.object({
    kind: z.literal('image'),
    mime: z.enum(['image/png', 'image/jpeg', 'image/gif']),
    /** Base64 of the picture's bytes (4/3 of `imageBytes`). */
    data: z.string().max(Math.ceil((WORD_PDF_LIMITS.imageBytes * 4) / 3) + 8),
    /** The size Word drew it at, in points, when it said. */
    widthPt: z.number().min(1).max(2_000).optional(),
  }),
  z.object({ kind: z.literal('pageBreak') }),
]);
export type WordBlock = z.infer<typeof WordBlock>;

export const WordPdfRequest = z.object({
  blocks: z.array(WordBlock).min(1).max(WORD_PDF_LIMITS.blocks),
  /** The document's language, as a BCP 47 tag, so Chromium picks the right CJK glyph forms. */
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/)
    .optional(),
});
export type WordPdfRequest = z.infer<typeof WordPdfRequest>;

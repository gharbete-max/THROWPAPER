import { z } from 'zod';

/**
 * A digital copy of a photographed page, to be drawn as a PDF (`POST /v1/pdf/copy`): lines and
 * words at points on the page, nothing else. `mode: 'searchable'` is sent with the photograph
 * itself, which becomes the page image, and the words become an invisible text layer over it.
 */
export const COPY_PDF_LIMITS = { lines: 4_000, words: 20_000, wordChars: 200 } as const;

const pt = z.number().finite().min(-100).max(20_000);

export const CopyPdfRequest = z.object({
  mode: z.enum(['copy', 'searchable']),
  widthPt: z.number().finite().min(50).max(2_000),
  heightPt: z.number().finite().min(50).max(4_000),
  lines: z
    .array(
      z.object({
        x1: pt,
        y1: pt,
        x2: pt,
        y2: pt,
        width: z.number().finite().min(0.1).max(10),
      }),
    )
    .max(COPY_PDF_LIMITS.lines),
  words: z
    .array(
      z.object({
        text: z.string().min(1).max(COPY_PDF_LIMITS.wordChars),
        x: pt,
        y: pt,
        size: z.number().finite().min(1).max(200),
      }),
    )
    .max(COPY_PDF_LIMITS.words),
});
export type CopyPdfRequest = z.infer<typeof CopyPdfRequest>;

import type { PayableWord } from '@tp/shared/payable';
import { openPdf, SCANNED_RUNS, type PaperPdf } from '../builder/paper/extract.js';
import { openPageReader, READ_LONG_SIDE, type PageReader } from '../builder/paper/ocr.js';
import { preparePhoto } from '../scan-photo.js';
import { wordsFromRecognised, wordsFromRuns } from './words.js';

/** A supplier invoice is a few pages; a longer file is something else. */
export const MAX_INVOICE_PAGES = 8;

export class TooManyInvoicePages extends Error {
  constructor() {
    super('too many pages');
    this.name = 'TooManyInvoicePages';
  }
}

/** A page as the review draws it: a PDF's page by pdf.js, a photograph as itself. */
export type PageSource = { pdf: PaperPdf; index: number } | { url: string };

export interface InvoicePages {
  words: PayableWord[];
  pages: PageSource[];
  /** Releases the drawings. */
  close(): void;
}

/**
 * A file read into words, in this browser and nowhere else: a PDF's text layer where it has one,
 * optical reading (Tesseract, from this origin — `paper/ocr.ts`) for a photograph or a scanned
 * page. Nothing is sent anywhere, and no rule runs here: that is `@tp/shared/payable`.
 */
export async function readInvoicePages(
  file: File,
  locale: string,
  progress: (page: number, count: number) => void,
): Promise<InvoicePages> {
  let reader: PageReader | null = null;
  const words: PayableWord[] = [];
  const pages: PageSource[] = [];
  const release = () => {
    for (const page of pages) {
      if ('url' in page) URL.revokeObjectURL(page.url);
    }
    const pdf = pages.find((page): page is { pdf: PaperPdf; index: number } => 'pdf' in page);
    if (pdf) void pdf.pdf.close();
  };
  try {
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      progress(1, 1);
      const photo = await preparePhoto(file);
      pages.push({ url: URL.createObjectURL(photo) });
      reader = await openPageReader(locale);
      words.push(...wordsFromRecognised(await reader.read(photo), 1));
    } else {
      const pdf = await openPdf(await file.arrayBuffer());
      if (pdf.pageCount > MAX_INVOICE_PAGES) {
        await pdf.close();
        throw new TooManyInvoicePages();
      }
      for (let index = 0; index < pdf.pageCount; index += 1) {
        pages.push({ pdf, index });
      }
      for (let index = 0; index < pdf.pageCount; index += 1) {
        progress(index + 1, pdf.pageCount);
        const runs = await pdf.text(index);
        if (runs.length >= SCANNED_RUNS) {
          words.push(...wordsFromRuns(runs, index + 1));
        } else {
          reader ??= await openPageReader(locale);
          const picture = await pdf.picture(index, READ_LONG_SIDE);
          words.push(...wordsFromRecognised(await reader.read(picture), index + 1));
        }
      }
    }
  } catch (error) {
    release();
    throw error;
  } finally {
    await reader?.close();
  }
  return { words, pages, close: release };
}

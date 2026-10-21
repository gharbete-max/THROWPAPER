import { longEdgeFor, pictureSize, type ReadQuality } from '@tp/shared/ai';
import { sha256, type PaperPdf } from '../../forms/builder/paper/extract.js';
import type { ScanPage } from '../../scan/scan-plan.js';
import type { ReadablePage } from './read-document.js';

/** What Scan shows for a file: a PDF drawn by pdf.js, or a photograph as itself. */
export type ScanSource = { pdf: PaperPdf } | { url: string };

/** A canvas turned clockwise by 0, 90, 180 or 270 degrees, as a new canvas; the same one when 0. */
function turned(canvas: HTMLCanvasElement, turn: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (turn === 0) return canvas;
  const out = document.createElement('canvas');
  const sideways = turn === 90 || turn === 270;
  out.width = sideways ? canvas.height : canvas.width;
  out.height = sideways ? canvas.width : canvas.height;
  const context = out.getContext('2d')!;
  context.translate(out.width / 2, out.height / 2);
  context.rotate((turn * Math.PI) / 180);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/** PNG for a rendered page (clean edges), JPEG for a photograph (smaller, no more to lose). */
async function encode(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg') {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error('the page could not be drawn');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    longEdge: Math.max(canvas.width, canvas.height),
  };
}

/** A photograph drawn within the budget (never enlarged). */
async function photoCanvas(file: File, quality: ReadQuality): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = pictureSize(bitmap.width, bitmap.height, quality);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * The pages Scan holds, in their order, as pages the AI reader can read. Files are hashed one at a
 * time (the hash is half of every page's cache key); pictures are drawn only when a page's turn
 * comes, and layers only when asked, so nothing but the file list is held for a long PDF.
 */
export async function readablePages(
  files: readonly File[],
  sources: readonly ScanSource[],
  pages: readonly ScanPage[],
): Promise<ReadablePage[]> {
  const hashes = new Map<number, string>();
  for (const page of pages) {
    if (!hashes.has(page.file)) {
      hashes.set(page.file, await sha256(await files[page.file]!.arrayBuffer()));
    }
  }
  return pages.map((page): ReadablePage => {
    const source = sources[page.file]!;
    const base = {
      fileSha256: hashes.get(page.file)!,
      pageInFile: page.page + 1,
      turn: page.turn,
      language: null,
    };
    if ('pdf' in source) {
      const pdf = source.pdf;
      return {
        ...base,
        async picture(quality) {
          // A PDF page has a shape and no pixels: a small drawing says which, then it is drawn to fill the budget.
          const probe = await pdf.picture(page.page, 64);
          const edge = longEdgeFor(probe.width, probe.height, quality);
          return encode(turned(await pdf.picture(page.page, edge), page.turn), 'image/png');
        },
        async layer() {
          const runs = await pdf.text(page.page);
          return runs.length === 0 ? null : runs.map((run) => run.text).join(' ');
        },
      };
    }
    return {
      ...base,
      async picture(quality) {
        return encode(
          turned(await photoCanvas(files[page.file]!, quality), page.turn),
          'image/jpeg',
        );
      },
      layer: () => Promise.resolve(null),
    };
  });
}

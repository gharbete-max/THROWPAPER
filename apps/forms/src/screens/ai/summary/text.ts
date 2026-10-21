import type { TextRun } from '../../forms/builder/paper/extract.js';

/**
 * Turning a source into plain text for the summary centre.
 *
 * Reading order only: runs of printed text become lines, lines become paragraphs. No model is
 * involved and nothing here touches the server (`bundle-split.test.ts`). A PDF is read with the
 * reader and OCR the paper door already has, loaded on demand, so none of it is in the centre's
 * own chunk.
 */

/** Page-fraction runs, as `PaperPdf.text` gives them, as lines and paragraphs of text. */
export function runsToText(runs: readonly TextRun[]): string {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; h: number; runs: TextRun[] }> = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(run.y - line.y) <= Math.max(line.h, run.h) * 0.5) {
      line.runs.push(run);
    } else {
      lines.push({ y: run.y, h: run.h, runs: [run] });
    }
  }
  const out: string[] = [];
  let previous: { y: number; h: number } | null = null;
  for (const line of lines) {
    const text = line.runs
      .sort((a, b) => a.x - b.x)
      .map((run) => run.text.trim())
      .filter((part) => part !== '')
      .join(' ');
    if (text === '') continue;
    // A gap well over a line's height is a new paragraph.
    if (previous && line.y - previous.y > Math.max(previous.h, line.h) * 1.8) out.push('');
    out.push(text);
    previous = line;
  }
  return out.join('\n');
}

/** Text of a PDF, a page at a time; a scanned page is read by OCR. */
export async function textOfPdf(
  bytes: ArrayBuffer,
  locale: string,
  onPage?: (done: number, total: number) => void,
): Promise<string> {
  const { openPdf } = await import('../../forms/builder/paper/extract.js');
  const pdf = await openPdf(bytes);
  try {
    const pages: string[] = [];
    for (let index = 0; index < pdf.pageCount; index += 1) {
      onPage?.(index, pdf.pageCount);
      let text = runsToText(await pdf.text(index));
      if (text === '') {
        const { readPage, READ_LONG_SIDE } = await import('../../forms/builder/paper/ocr.js');
        const canvas = await pdf.picture(index, READ_LONG_SIDE);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (blob) text = runsToText(await readPage(blob, locale));
      }
      if (text !== '') pages.push(text);
    }
    onPage?.(pdf.pageCount, pdf.pageCount);
    return pages.join('\n\n');
  } finally {
    await pdf.close();
  }
}

/** A chosen file as text: a PDF is read, a plain-text file is taken as it is. */
export async function textOfFile(
  file: File,
  locale: string,
  onPage?: (done: number, total: number) => void,
): Promise<string> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return textOfPdf(await file.arrayBuffer(), locale, onPage);
  }
  return (await file.text()).replace(/\r\n?/g, '\n');
}

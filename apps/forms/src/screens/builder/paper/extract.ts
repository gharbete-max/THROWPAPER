import type { AcroField, PaperAnchor } from '@tp/shared/forms';
import { MAX_PAPER_PAGES } from '@tp/shared/forms';

/**
 * Reads a PDF in the browser: its pages as pictures, its form fields, its printed text.
 *
 * `docs/adr/0004-old-forms-on-paper.md`. This is the half of the importer that touches bytes;
 * the mapping half is `importAcroFields` in `@tp/shared`, which takes the `AcroField` list this
 * produces and never sees a PDF.
 *
 * ## In the browser, and lazily
 *
 * `pdfjs-dist` is about a megabyte. It is loaded with `import()` from here and nowhere else, so
 * it enters the bundle only when somebody presses "From paper" — never for a member of the
 * public opening a form on a phone. `bundle-split.test.ts` keeps it that way.
 *
 * Rendering in the browser also means the server never draws a stranger's PDF: it stores the
 * bytes and hands them back to the author who uploaded them, and that is all.
 */

/** One printed run of text, in page fractions like an anchor. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PaperPdf {
  pageCount: number;
  /** Fields the document declares, with anchors, ready for `importAcroFields`. */
  fields: AcroField[];
  /** The printed words on a page, for suggesting labels. Empty on a scanned page. */
  text(page: number): Promise<TextRun[]>;
  /** Draws the page at `width` CSS pixels wide. */
  render(page: number, width: number, canvas: HTMLCanvasElement): Promise<void>;
  close(): Promise<void>;
}

export class TooManyPages extends Error {
  constructor(public readonly pages: number) {
    super(`${pages} pages`);
    this.name = 'TooManyPages';
  }
}

export async function openPdf(bytes: ArrayBuffer, firstPage = 0): Promise<PaperPdf> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const document = await pdfjs.getDocument({ data: bytes }).promise;
  if (document.numPages > MAX_PAPER_PAGES) {
    await document.loadingTask.destroy();
    throw new TooManyPages(document.numPages);
  }

  const fields: AcroField[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const annotations = (await page.getAnnotations()) as Widget[];
    const rect = (r: number[]) => anchorFor(toViewport(viewport, r), viewport);
    mergeWidgets(fields, annotations, firstPage + index - 1, rect);
  }

  return {
    pageCount: document.numPages,
    fields,
    async text(index) {
      const page = await document.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      return content.items.flatMap((item) => {
        if (!('str' in item) || item.str.trim() === '') return [];
        // `transform` is the text matrix; e and f are the baseline origin in PDF space.
        const [, , , d = 0, e = 0, f = 0] = item.transform as number[];
        const height = item.height || Math.abs(d);
        const anchor = anchorFor(
          toViewport(viewport, [e, f, e + item.width, f + height]),
          viewport,
        );
        return [{ text: item.str, ...anchor }];
      });
    },
    async render(index, width, canvas) {
      const page = await document.getPage(index + 1);
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // 'print' draws the same picture but does not pace itself with requestAnimationFrame, so
      // a builder opened in a background tab has its pages when somebody switches to it.
      await page.render({ canvas, viewport, intent: 'print' }).promise;
    },
    close: () => document.loadingTask.destroy(),
  };
}

/** A PDF-space rectangle as viewport corners: y flipped, rotation applied. */
function toViewport(
  viewport: { convertToViewportPoint(x: number, y: number): unknown[] },
  [x1 = 0, y1 = 0, x2 = 0, y2 = 0]: number[],
): number[] {
  const a = viewport.convertToViewportPoint(x1, y1) as number[];
  const b = viewport.convertToViewportPoint(x2, y2) as number[];
  return [a[0] ?? 0, a[1] ?? 0, b[0] ?? 0, b[1] ?? 0];
}

/** The subset of a pdfjs Widget annotation this reads. Our own shape, so a pdfjs upgrade lands here. */
export interface Widget {
  subtype: string;
  fieldType: 'Tx' | 'Btn' | 'Ch' | 'Sig' | null;
  fieldName: string;
  alternativeText?: string;
  rect: number[];
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  multiLine?: boolean;
  maxLen?: number | null;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string | null;
  options?: Array<{ exportValue: string; displayValue: string }>;
  multiSelect?: boolean;
}

/**
 * Widgets on one page, folded into the field list.
 *
 * A radio group is one field but several widgets — one per button, each with its own rectangle
 * and `buttonValue`. They are folded into one `AcroField` whose options are the buttons and whose
 * anchor is the box around all of them. Everything else is one widget, one field.
 */
export function mergeWidgets(
  into: AcroField[],
  widgets: readonly Widget[],
  page: number,
  anchorOf: (rect: number[]) => Omit<PaperAnchor, 'page'>,
): void {
  for (const widget of widgets) {
    if (widget.subtype !== 'Widget' || !widget.fieldType || !widget.fieldName) continue;
    const anchor = { page, ...anchorOf(widget.rect) };

    if (widget.fieldType === 'Btn' && widget.radioButton) {
      const value = widget.buttonValue ?? '';
      const existing = into.find((f) => f.name === widget.fieldName && f.type === 'radio');
      if (existing) {
        existing.options?.push({ value, label: value });
        if (existing.paper && existing.paper.page === page) {
          existing.paper = union(existing.paper, anchor);
        }
        continue;
      }
      into.push({
        ...common(widget),
        type: 'radio',
        options: [{ value, label: value }],
        paper: anchor,
      });
      continue;
    }

    into.push({ ...common(widget), ...typed(widget), paper: anchor });
  }
}

function common(
  widget: Widget,
): Pick<AcroField, 'name' | 'label' | 'required' | 'readOnly' | 'hidden'> {
  return {
    name: widget.fieldName,
    label: widget.alternativeText || undefined,
    required: widget.required === true,
    readOnly: widget.readOnly === true,
    hidden: widget.hidden === true,
  };
}

function typed(
  widget: Widget,
): Omit<AcroField, 'name' | 'label' | 'required' | 'readOnly' | 'hidden' | 'paper'> {
  switch (widget.fieldType) {
    case 'Tx':
      return {
        type: 'text',
        multiline: widget.multiLine === true,
        charLimit: widget.maxLen ?? undefined,
      };
    case 'Btn':
      return { type: widget.pushButton ? 'button' : 'checkbox' };
    case 'Ch':
      return {
        type: 'choice',
        multiSelect: widget.multiSelect === true,
        options: (widget.options ?? []).map((o) => ({
          value: o.exportValue,
          label: o.displayValue,
        })),
      };
    case 'Sig':
      return { type: 'signature' };
    default:
      return { type: 'button' };
  }
}

/** A viewport rectangle `[x1, y1, x2, y2]` (any corner order) as fractions of the page. */
export function anchorFor(
  box: number[],
  size: { width: number; height: number },
): Omit<PaperAnchor, 'page'> {
  const [ax = 0, ay = 0, bx = 0, by = 0] = box;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(Math.min(ax, bx) / size.width);
  const y = clamp(Math.min(ay, by) / size.height);
  return {
    x,
    y,
    w: clamp(Math.max(ax, bx) / size.width) - x,
    h: clamp(Math.max(ay, by) / size.height) - y,
  };
}

function union(a: PaperAnchor, b: PaperAnchor): PaperAnchor {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    page: a.page,
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * The printed words a box most plausibly belongs to: the nearest run ending just left of it on
 * the same line, else the nearest run just above it. Verbatim — rule 8 — or nothing.
 */
export function labelNear(
  box: Omit<PaperAnchor, 'page'>,
  runs: readonly TextRun[],
): string | undefined {
  const midY = box.y + box.h / 2;
  // Starts left of the box, not ends: a box drawn over the tail of its own label is still that
  // label's box. Nearest start wins.
  const sameLine = runs
    .filter((r) => r.x < box.x && Math.abs(r.y + r.h / 2 - midY) < Math.max(r.h, box.h))
    .sort((a, b) => b.x - a.x);
  if (sameLine[0]) return sameLine[0].text.trim();

  const above = runs
    .filter((r) => r.y + r.h <= box.y + 0.005 && r.x < box.x + box.w && r.x + r.w > box.x)
    .sort((a, b) => b.y + b.h - (a.y + a.h));
  if (above[0] && box.y - (above[0].y + above[0].h) < above[0].h * 2) return above[0].text.trim();
  return undefined;
}

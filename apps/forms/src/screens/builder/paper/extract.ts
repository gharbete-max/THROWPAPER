import type { AcroField, PaperAnchor } from '@tp/shared/forms';
import { MAX_PAPER_PAGES } from '@tp/shared/forms';
import type { Box, FormFieldBox, RawDocument, RawPage, RawWord } from '@tp/shared/import';
import { ocrWords, type RecognisedWords } from './ocr-words.js';
import { toIu } from './units.js';

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
  /**
   * The whole document as stage 1's raw document: its words and its printed rules. A scanned page
   * — a picture, with fewer than {@link SCANNED_RUNS} text runs — is read by `ocr` when one is
   * given (S14, `docs/plan/SCANS.md`), and is empty without it.
   */
  raw(options?: { ocr?: (pageIndex: number) => Promise<RecognisedWords> }): Promise<RawDocument>;
  /**
   * Draws the page at `width` CSS pixels wide. Aborting `signal` cancels a drawing still under way,
   * and must come before the same canvas is drawn on again: pdf.js refuses a canvas in use, and the
   * first drawing would go on over the second.
   */
  render(
    page: number,
    width: number,
    canvas: HTMLCanvasElement,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * The page as a picture to read by OCR: drawn with its longer side `longSide` pixels, whatever
   * the screen's pixel ratio, on a canvas of its own.
   */
  picture(page: number, longSide: number): Promise<HTMLCanvasElement>;
  close(): Promise<void>;
}

/** Anything the review screen can draw pages of: a PDF, or a photograph (S14). */
export type PageDrawer = Pick<PaperPdf, 'render' | 'close'>;

/**
 * A page that paints a picture and has fewer text runs than this is a scan (S14): a scanner may
 * stamp a line or two of text on its picture, never a page's worth. A page with no picture is never
 * one, however little text it has: "1. Namn: ____" alone is a form, and its text is exact.
 */
export const SCANNED_RUNS = 3;

/**
 * Whether a page's drawing paints an image: any of pdf.js's image operators, an image mask among
 * them, since a black-and-white scan is usually stored as one.
 */
export function paintsAPicture(fnArray: readonly number[], ops: Record<string, number>): boolean {
  const painting = new Set(
    Object.entries(ops)
      .filter(([name]) => /^paint.*Image/iu.test(name))
      .map(([, code]) => code),
  );
  return fnArray.some((fn) => painting.has(fn));
}

export class TooManyPages extends Error {
  constructor(public readonly pages: number) {
    super(`${pages} pages`);
    this.name = 'TooManyPages';
  }
}

/**
 * A PDF's own fields as the import's stages take them (`CAVEATS.md` #54): each widget's anchor —
 * fractions of the page, y down, as `anchorFor` makes them — in layout units, on its page counted
 * from 1 within this PDF (`firstPage` is where this PDF's pages start among the files read).
 * Buttons, read-only and hidden fields ask nothing, as `importAcroFields` also says, and a field
 * with no widget has nowhere to be.
 */
export function fieldBoxes(fields: readonly AcroField[], firstPage: number): FormFieldBox[] {
  const iu = (fraction: number) => Math.min(10_000, Math.max(0, Math.round(fraction * 10_000)));
  return fields.flatMap((field) => {
    const anchor = field.paper;
    if (!anchor || field.type === 'button' || field.readOnly || field.hidden) return [];
    return [
      {
        name: field.name,
        label: field.label ?? null,
        type: field.type,
        multiline: field.multiline ?? false,
        multiSelect: field.multiSelect ?? false,
        pageNo: anchor.page - firstPage + 1,
        box: {
          x0: iu(anchor.x),
          y0: iu(anchor.y),
          x1: iu(anchor.x + anchor.w),
          y1: iu(anchor.y + anchor.h),
        },
      },
    ];
  });
}

/** The pdf.js module, as `openPdf` uses it. */
export type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * pdf.js in the browser — the **legacy** build, not the default one.
 *
 * pdf.js 6's default build calls `Map.prototype.getOrInsertComputed`, a 2026 addition to the
 * language, while drawing a page. Any browser older than that — Safari before it shipped, a
 * Chrome a few versions behind, the Chromium this repository's own e2e container carries —
 * threw `getOrInsertComputed is not a function` the moment "From paper" drew its first page.
 * The legacy build is the same code with that method (and its kin) polyfilled; it is what
 * pdf.js itself recommends for anything that must run in browsers people actually have.
 */
async function browserPdfjs(): Promise<Pdfjs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/**
 * Opens a PDF. `load` is how pdf.js is reached: the browser's lazy chunk by default; the corpus
 * test (`corpus.test.ts`) passes Node's, so a real document is read by exactly this code.
 */
export async function openPdf(
  bytes: ArrayBuffer,
  firstPage = 0,
  load: () => Promise<Pdfjs> = browserPdfjs,
): Promise<PaperPdf> {
  // Hashed first: pdf.js may hand the buffer to its worker, and a transferred buffer is empty.
  const digest = await sha256(bytes);
  const pdfjs = await load();

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
    async raw(options = {}) {
      const pages: RawPage[] = [];
      let engine: string | null = null;
      for (let index = 0; index < document.numPages; index += 1) {
        const page = await document.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        // The operator list first: it is what loads the page's fonts, whose names say "Bold".
        const operators = await page.getOperatorList();
        const content = await page.getTextContent();
        const size = { width: viewport.width, height: viewport.height };
        const words = content.items.flatMap((item) => {
          if (!('str' in item) || item.str.trim() === '') return [];
          const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform as number[];
          // Horizontal runs only: a rotated run has no left-to-right words to split.
          if (Math.abs(b) > Math.abs(a) / 10 || Math.abs(c) > Math.abs(d) / 10) return [];
          const height = item.height || Math.abs(d);
          const [x0 = 0, baseline = 0] = viewport.convertToViewportPoint(e, f) as number[];
          const [x1 = 0] = viewport.convertToViewportPoint(e + item.width, f) as number[];
          const [, top = 0] = viewport.convertToViewportPoint(e, f + height) as number[];
          const font = page.commonObjs.has(item.fontName)
            ? (page.commonObjs.get(item.fontName) as PdfFont)
            : undefined;
          return runWords(
            { text: item.str, x0, x1, baseline, size: Math.abs(baseline - top) },
            size,
            fontLook(font),
          );
        });
        const runs = content.items.filter((item) => 'str' in item && item.str.trim() !== '');
        const scanned =
          runs.length < SCANNED_RUNS &&
          paintsAPicture(operators.fnArray, pdfjs.OPS as unknown as Record<string, number>);
        const recognised = scanned && options.ocr ? await options.ocr(index) : null;
        if (recognised) engine ??= recognised.engine;
        pages.push({
          pageNo: index + 1,
          widthPt: Math.round(viewport.width),
          heightPt: Math.round(viewport.height),
          words: recognised ? ocrWords(recognised) : words,
          rules: horizontalRules(operators, pdfjs.OPS, viewport.transform, size),
        });
      }
      return {
        irVersion: 1,
        source: {
          kind: 'pdf',
          // A scanned page's words are Tesseract's: the extractor says both.
          extractor: engine
            ? `pdfjs-dist@${pdfjs.version} + ${engine}`
            : `pdfjs-dist@${pdfjs.version}`,
          sha256: digest,
        },
        pages,
      };
    },
    async render(index, width, canvas, signal) {
      const page = await document.getPage(index + 1);
      if (signal?.aborted) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      // 'print' draws the same picture but does not pace itself with requestAnimationFrame, so
      // a builder opened in a background tab has its pages when somebody switches to it.
      const task = page.render({ canvas, viewport, intent: 'print' });
      const cancel = () => task.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await task.promise;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    },
    async picture(index, longSide) {
      const page = await document.getPage(index + 1);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: longSide / Math.max(natural.width, natural.height),
      });
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      return canvas;
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
        existing.options?.push({ value, label: value, paper: anchor });
        if (existing.paper && existing.paper.page === page) {
          existing.paper = union(existing.paper, anchor);
        }
        continue;
      }
      into.push({
        ...common(widget),
        type: 'radio',
        options: [{ value, label: value, paper: anchor }],
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

// ------------------------------------------------------------------ stage 1, text layer

/** The part of a pdf.js font this reads. Our own shape, so an upgrade lands here. */
export interface PdfFont {
  name?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
}

/** 700 when the font says bold, black, heavy or semibold (`IMPORT-PIPELINE.md` §1). */
export function fontLook(font: PdfFont | undefined): { fontWeight: 400 | 700; italic: boolean } {
  const heavy = /bold|black|heavy|semibold/i.test(font?.name ?? '');
  return {
    fontWeight: font?.bold || font?.black || heavy ? 700 : 400,
    italic: !!font?.italic || /italic|oblique/i.test(font?.name ?? ''),
  };
}

/** A text run in viewport units (points, y down): where it starts and ends on its baseline. */
export interface ViewportRun {
  text: string;
  x0: number;
  x1: number;
  baseline: number;
  /** Its em height. */
  size: number;
}

/**
 * A pdf.js run as words (`CAVEATS.md` #58): pdf.js gives runs, not words, and no per-glyph
 * advances without a much slower path. The run is split at whitespace, and its width is shared
 * out among its characters by count — exact for monospace, within a character for proportional
 * type, which is below every tolerance downstream. Geometry becomes integer iu here, once.
 */
export function runWords(
  run: ViewportRun,
  page: { width: number; height: number },
  look: { fontWeight: 400 | 700; italic: boolean },
): RawWord[] {
  const chars = [...run.text];
  const left = Math.min(run.x0, run.x1);
  const width = Math.abs(run.x1 - run.x0);
  const baseline = toIu(run.baseline, page.height);
  const fontSize = Math.max(1, toIu(run.size, page.height));
  const words: RawWord[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const text = chars.slice(start, end).join('');
    words.push({
      text,
      box: {
        x0: toIu(left + (width * start) / chars.length, page.width),
        y0: Math.max(0, baseline - Math.round((fontSize * 4) / 5)),
        x1: toIu(left + (width * end) / chars.length, page.width),
        y1: Math.min(10_000, baseline + Math.round(fontSize / 5)),
      },
      baseline,
      fontSize,
      fontWeight: look.fontWeight,
      italic: look.italic,
      ocrConfidence: null,
      repair: null,
      source: 'text-layer',
      paragraph: null,
      docxNumbering: null,
      cell: null,
    });
    start = -1;
  };
  chars.forEach((c, i) => {
    if (/\s/u.test(c)) flush(i);
    else if (start < 0) start = i;
  });
  flush(chars.length);
  return words;
}

/** The pdf.js operator codes this reads. */
export interface Ops {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `outer` after `inner`: a point goes through `inner` first. */
const compose = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** A painted segment is a rule when it is this nearly level (points) and this long (of the width). */
const LEVEL = 0.5;
const MIN_RULE = 0.05;

/**
 * The page's printed horizontal rules, from its drawing operations (`IMPORT-PIPELINE.md` §1): the
 * straight, level segments of every path that is stroked or filled, at least 5% of the page wide —
 * an answer line under a label, the edge of a box around a field. Whether a rule belongs to a line
 * is stage 2's question (`ruleBelow`, which asks for 20% of the column past the last word).
 */
export function horizontalRules(
  list: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  ops: Ops,
  viewport: readonly number[],
  page: { width: number; height: number },
): Box[] {
  const painted = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  const toPage = viewport as unknown as Matrix;
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  const rules: Box[] = [];
  const segment = (from: [number, number], to: [number, number]) => {
    const m = compose(toPage, ctm);
    const [ax, ay] = apply(m, from[0], from[1]);
    const [bx, by] = apply(m, to[0], to[1]);
    if (Math.abs(ay - by) > LEVEL || Math.abs(ax - bx) < page.width * MIN_RULE) return;
    const y = toIu((ay + by) / 2, page.height);
    rules.push({
      x0: toIu(Math.min(ax, bx), page.width),
      y0: y,
      x1: toIu(Math.max(ax, bx), page.width),
      y1: y,
    });
  };
  list.fnArray.forEach((fn, index) => {
    const args = list.argsArray[index] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.transform && args?.length === 6) {
      ctm = compose(ctm, args as unknown as Matrix);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0];
      if (Array.isArray(matrix) && matrix.length === 6)
        ctm = compose(ctm, matrix as unknown as Matrix);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops.constructPath && args && painted.has(args[0] as number)) {
      const data = (args[1] as ArrayLike<unknown>[] | undefined)?.[0];
      if (!data || typeof data !== 'object' || !('length' in data)) return;
      const path = Array.from(data as ArrayLike<number>);
      let current: [number, number] = [0, 0];
      let first: [number, number] = [0, 0];
      for (let i = 0; i < path.length;) {
        const op = path[i];
        if (op === 0) {
          current = [path[i + 1] ?? 0, path[i + 2] ?? 0];
          first = current;
          i += 3;
        } else if (op === 1) {
          const next: [number, number] = [path[i + 1] ?? 0, path[i + 2] ?? 0];
          segment(current, next);
          current = next;
          i += 3;
        } else if (op === 2) {
          current = [path[i + 5] ?? 0, path[i + 6] ?? 0];
          i += 7;
        } else if (op === 3) {
          current = [path[i + 3] ?? 0, path[i + 4] ?? 0];
          i += 5;
        } else if (op === 4) {
          segment(current, first);
          current = first;
          i += 1;
        } else break;
      }
    }
  });
  return rules;
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Where a signature, initials or a date go on a page — the arithmetic, kept apart from the screen
 * so it can be tested without one.
 *
 * Two spaces. **Seen** space is the page as a person looks at it: points, origin at the top left,
 * y running down, whatever the page's own turn. **PDF** space is the file's own: origin at the
 * lower left of the page's box, y running up, on the page *before* it is turned. A page marked
 * `/Rotate 90` is stored sideways and shown upright, so the two spaces differ by that turn; the
 * conversions below are the whole of it (pdf.js's own `convertToPdfPoint` agrees — see the test).
 *
 * Marks are sent to `POST /v1/pdf/edit` in PDF space. The server turns what it draws the other
 * way by the page's `/Rotate`, so a mark reads upright on a turned page, exactly as text does.
 */

export type MarkKind = 'signature' | 'initials' | 'date';

/** What pdf.js says of a page: its box (`view`) and its turn (`rotate`, a multiple of 90). */
export interface PageGeometry {
  view: readonly [number, number, number, number];
  rotate: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A mark on a page, in seen space: the top left of its box, and the box. */
export interface Placement extends Point, Size {
  id: number;
  /** From 0. */
  page: number;
  kind: MarkKind;
}

/** The page as a person sees it: sideways pages swap their sides. */
export function seenSize(geometry: PageGeometry): Size {
  const width = geometry.view[2] - geometry.view[0];
  const height = geometry.view[3] - geometry.view[1];
  return turns(geometry) % 2 === 0 ? { width, height } : { width: height, height: width };
}

/** Quarter turns clockwise, 0 to 3, however the file writes the angle (-90, 450). */
function turns(geometry: PageGeometry): number {
  return (((Math.round(geometry.rotate / 90) % 4) + 4) % 4) as number;
}

/** A point seen on the page, in the file's own space. */
export function toPdfPoint(geometry: PageGeometry, seen: Point): Point {
  const [x0, y0, x1, y1] = geometry.view;
  switch (turns(geometry)) {
    case 1:
      return { x: x0 + seen.y, y: y0 + seen.x };
    case 2:
      return { x: x1 - seen.x, y: y0 + seen.y };
    case 3:
      return { x: x1 - seen.y, y: y1 - seen.x };
    default:
      return { x: x0 + seen.x, y: y1 - seen.y };
  }
}

/** The way back: a point in the file's space, as it is seen. */
export function toSeenPoint(geometry: PageGeometry, pdf: Point): Point {
  const [x0, y0, x1, y1] = geometry.view;
  switch (turns(geometry)) {
    case 1:
      return { x: pdf.y - y0, y: pdf.x - x0 };
    case 2:
      return { x: x1 - pdf.x, y: pdf.y - y0 };
    case 3:
      return { x: y1 - pdf.y, y: x1 - pdf.x };
    default:
      return { x: pdf.x - x0, y: y1 - pdf.y };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Keeps the whole box on the page. A box larger than the page sits at its top left. */
export function clampToPage<T extends Point & Size>(box: T, page: Size): T {
  return {
    ...box,
    x: round(Math.max(0, Math.min(box.x, page.width - box.width))),
    y: round(Math.max(0, Math.min(box.y, page.height - box.height))),
  };
}

/** Moves a mark by (dx, dy) points as seen — an arrow key — and keeps it on the page. */
export function nudge<T extends Point & Size>(box: T, dx: number, dy: number, page: Size): T {
  return clampToPage({ ...box, x: box.x + dx, y: box.y + dy }, page);
}

/** What one arrow press moves: a point, or ten with Shift. */
export const NUDGE = 1;
export const NUDGE_BIG = 10;

/** The arrow keys as (dx, dy), or null for any other key. */
export function arrowDelta(key: string, shift: boolean): Point | null {
  const step = shift ? NUDGE_BIG : NUDGE;
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}

/** The smallest and largest a picture mark is shown, in points wide. */
export const MIN_WIDTH = 16;
export const MAX_WIDTH = 400;
/** The smallest and largest a date is set, in points. */
export const MIN_DATE_SIZE = 6;
export const MAX_DATE_SIZE = 48;

/** A picture mark made `width` points wide, its height following the picture's own proportions. */
export function resizePicture<T extends Point & Size>(
  box: T,
  width: number,
  aspect: number,
  page: Size,
): T {
  const wide = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, page.width, width));
  return clampToPage({ ...box, width: round(wide), height: round(wide / aspect) }, page);
}

/** A date's line is this much taller than its letters; its baseline sits this far down. */
const LINE = 1.3;
const BASELINE = 0.8;
/** Digits and separators average about this wide, in letters' height — enough to keep a date on the page. */
const ADVANCE = 0.6;

export const dateSize = (box: Size): number => round(box.height / LINE);

/** A date set `size` points tall: its box follows the text, which is measured by estimate. */
export function resizeDate<T extends Point & Size>(
  box: T,
  text: string,
  size: number,
  page: Size,
): T {
  const set = Math.max(MIN_DATE_SIZE, Math.min(MAX_DATE_SIZE, size));
  return clampToPage(
    { ...box, width: round([...text].length * set * ADVANCE), height: round(set * LINE) },
    page,
  );
}

/** The date, in the order and with the separators the locale writes it — digits always Latin. */
export function formatStampDate(date: Date, locale: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // A locale the engine does not know: the ISO form, which every reader can read.
    return date.toISOString().slice(0, 10);
  }
}

/** One page after another, the same box on each — "initials on every page". */
export function onEveryPage(
  template: Omit<Placement, 'id' | 'page'>,
  pages: readonly PageGeometry[],
  nextId: () => number,
): Placement[] {
  return pages.map((geometry, page) => ({
    ...clampToPage(template, seenSize(geometry)),
    id: nextId(),
    page,
  }));
}

/** An op for `POST /v1/pdf/edit` — a picture. `image` names a PNG sent with the request. */
export interface PictureOp {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  image: 'signature' | 'initials';
}

/** An op for `POST /v1/pdf/edit` — text. */
export interface TextOp {
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
}

/**
 * The marks as the server wants them. A picture's point is the lower left of the picture as seen;
 * a date's is where its baseline starts.
 */
export function toOps(
  placements: readonly Placement[],
  pages: readonly PageGeometry[],
  dateText: string,
): Array<PictureOp | TextOp> {
  return placements.map((mark) => {
    const geometry = pages[mark.page]!;
    if (mark.kind === 'date') {
      const at = toPdfPoint(geometry, { x: mark.x, y: mark.y + mark.height * BASELINE });
      return {
        page: mark.page,
        x: round(at.x),
        y: round(at.y),
        text: dateText,
        size: dateSize(mark),
      };
    }
    const at = toPdfPoint(geometry, { x: mark.x, y: mark.y + mark.height });
    return {
      page: mark.page,
      x: round(at.x),
      y: round(at.y),
      width: mark.width,
      height: mark.height,
      image: mark.kind,
    };
  });
}

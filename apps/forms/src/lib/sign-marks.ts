/**
 * A person's saved signature and initials, kept on this computer only.
 *
 * They live in the browser's (or the desktop app's) own storage and nowhere else: they are never
 * sent to a server by saving, only as part of a document when the person places them on one and
 * confirms. Storage can be missing, full, blocked or private, so every read and write is guarded
 * and the screen works — without a saved mark — when it fails.
 */
export type MarkSlot = 'signature' | 'initials';

export interface SavedMark {
  /** `data:image/png;base64,…` — what is drawn on the page. */
  png: string;
  /** The picture's own size in pixels; its proportions decide the mark's shape on a page. */
  width: number;
  height: number;
}

export type SavedMarks = Partial<Record<MarkSlot, SavedMark>>;

/** The part of `Storage` this uses, so a test can hand in a map. */
export interface MarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORE_NAME = 'tp.sign.marks.v1';
const PREFIX = 'data:image/png;base64,';
/** A mark is a few KB; anything near this is not one, and storage is small. */
const MAX_PNG_CHARS = 300_000;

function browserStorage(): MarkStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function valid(mark: unknown): mark is SavedMark {
  if (typeof mark !== 'object' || mark === null) return false;
  const { png, width, height } = mark as Record<string, unknown>;
  return (
    typeof png === 'string' &&
    png.startsWith(PREFIX) &&
    png.length <= MAX_PNG_CHARS &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    width > 0 &&
    height > 0 &&
    Number.isFinite(width) &&
    Number.isFinite(height)
  );
}

/** What is saved. Anything unreadable or not a mark is treated as nothing. */
export function loadMarks(storage: MarkStorage | null = browserStorage()): SavedMarks {
  try {
    const raw = storage?.getItem(STORE_NAME);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SavedMarks = {};
    for (const slot of ['signature', 'initials'] as const) {
      if (valid(parsed[slot])) out[slot] = parsed[slot];
    }
    return out;
  } catch {
    return {};
  }
}

function write(marks: SavedMarks, storage: MarkStorage | null): boolean {
  try {
    if (!storage) return false;
    if (Object.keys(marks).length === 0) storage.removeItem(STORE_NAME);
    else storage.setItem(STORE_NAME, JSON.stringify(marks));
    return true;
  } catch {
    return false;
  }
}

/** Keeps a mark. False when it is not a mark or storage refused it. */
export function saveMark(
  slot: MarkSlot,
  mark: SavedMark,
  storage: MarkStorage | null = browserStorage(),
): boolean {
  return valid(mark) && write({ ...loadMarks(storage), [slot]: mark }, storage);
}

/** Forgets one mark; the other stays. */
export function forgetMark(
  slot: MarkSlot,
  storage: MarkStorage | null = browserStorage(),
): boolean {
  const { [slot]: _gone, ...rest } = loadMarks(storage);
  return write(rest, storage);
}

/** Forgets both. */
export function forgetAllMarks(storage: MarkStorage | null = browserStorage()): boolean {
  return write({}, storage);
}

/**
 * The tight box around the ink of a picture: the smallest rectangle holding every pixel that is
 * not transparent, grown by `pad`. Null for an empty picture. `rgba` is a canvas's pixel data.
 */
export function inkBounds(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  pad = 0,
): { x: number; y: number; width: number; height: number } | null {
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

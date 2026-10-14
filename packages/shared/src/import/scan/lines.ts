/**
 * The line finder of the digital copy (`docs/plan/IMPROVEMENTS.md`, Track B): ruled lines, box
 * sides and table-cell borders found in a picture of a page, with no model and no network. Same
 * pixels in, same lines out.
 *
 * Three steps, all integer arithmetic and all pure (this folder reads no DOM; the pixels are handed
 * in by `apps/forms`):
 *
 * 1. {@link binarise}: ink or paper, by comparing each pixel with the average of its
 *    neighbourhood, so a shadow across a photograph does not turn into ink and a pale blue rule
 *    still does.
 * 2. {@link estimateSkew}: how far the sheet is turned, by trying small turns and keeping the one
 *    that makes the rows of ink sharpest. The picture is straightened by that much before the
 *    lines are looked for, and the copy is drawn straight.
 * 3. {@link findLines}: long horizontal runs of ink (a morphological opening with a line as its
 *    element, done as run lengths), joined across rows into strokes. A stroke that is long, thin
 *    and much longer than it is thick is a line; text is none of those, because a letter's
 *    stroke is as long as the letter. The same is done on the transposed picture for the
 *    vertical lines, and strokes on one line with a small gap between them are one line.
 *
 * Everything is in pixels of the picture it was given; `copy.ts` turns them into the page.
 */

/** A picture reduced to ink (1) and paper (0), row by row. */
export interface Bitmap {
  width: number;
  height: number;
  ink: Uint8Array;
}

/** One ruled line, axis-aligned in the straightened picture. `at` is its middle, across. */
export interface RuledLine {
  dir: 'h' | 'v';
  /** Its y (horizontal) or x (vertical), the middle of its thickness. */
  at: number;
  /** Where it starts and ends along itself. */
  from: number;
  to: number;
  /** How thick it is drawn, in pixels. */
  thick: number;
}

export interface FoundLines {
  /** The size of the picture the pixels below are in. */
  width: number;
  height: number;
  /** The turn that was taken out, as a slope in ten-thousandths (see {@link straighten}). */
  skew: number;
  lines: RuledLine[];
}

export interface FindOptions {
  /** Shortest line, in pixels. Default: a sixteenth of the picture's shorter side, and 24 at least. */
  minLength?: number;
  /** Thickest line, in pixels. Default: a hundred-and-fiftieth of the shorter side, 4 at least. */
  maxThickness?: number;
  /** Take out the sheet's turn first. Default true. */
  straighten?: boolean;
}

/** A pixel is ink when it is this many hundredths darker than the average around it. */
const DARKER_PERCENT = 18;
/** The turn tried, in ten-thousandths of a slope: 2.9 degrees either way. */
const MAX_SKEW = 500;
/** A turn smaller than this is not worth taking out (a tenth of a degree). */
const MIN_SKEW = 15;
/** Ink gaps this narrow inside a run are bridged (a one-pixel break in a scanned rule). */
const BRIDGE = 1;

/**
 * Ink and paper from a picture's RGBA pixels. A pixel is ink when it is clearly darker than the
 * average of the window around it (about a twentieth of the picture), the window averaged with an
 * integral image so a large picture costs a few passes.
 */
export function binarise(rgba: ArrayLike<number>, width: number, height: number): Bitmap {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = Math.floor(
      (299 * rgba[i * 4]! + 587 * rgba[i * 4 + 1]! + 114 * rgba[i * 4 + 2]!) / 1000,
    );
  }
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x]!;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
    }
  }
  const radius = Math.max(7, Math.floor(Math.min(width, height) / 20));
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const total =
        sums[y1 * stride + x1]! -
        sums[y0 * stride + x1]! -
        sums[y1 * stride + x0]! +
        sums[y0 * stride + x0]!;
      const area = (x1 - x0) * (y1 - y0);
      // gray < mean * (1 - 18 %), both sides times `area` to stay in integers.
      ink[y * width + x] =
        gray[y * width + x]! * area * 100 < total * (100 - DARKER_PERCENT) ? 1 : 0;
    }
  }
  return { width, height, ink };
}

/**
 * Where a point of the picture goes when the sheet's turn is taken out: turned about the middle of
 * the picture by `skew` ten-thousandths of a slope. The same mapping straightens the ink, the
 * lines and the words, so they stay where they were relative to each other.
 */
export function straighten(
  x: number,
  y: number,
  size: { width: number; height: number },
  skew: number,
): { x: number; y: number } {
  if (skew === 0) return { x, y };
  const cx = size.width / 2;
  const cy = size.height / 2;
  return { x: x + ((y - cy) * skew) / 10000, y: y - ((x - cx) * skew) / 10000 };
}

/**
 * The turn of the sheet, as a slope in ten-thousandths: the one that makes the rows of ink
 * sharpest (sum of the squares of each row's ink). Coarse steps, then fine; 0 unless a turn
 * clearly beats none, so a blank page or a round one does not wobble.
 */
export function estimateSkew(bitmap: Bitmap): number {
  const { width, height, ink } = bitmap;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ink[y * width + x]) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;
  const cx = width / 2;
  const counts = new Float64Array(height * 2 + 2);
  const score = (skew: number) => {
    counts.fill(0);
    for (let i = 0; i < xs.length; i += 1) {
      const row = Math.round(ys[i]! - ((xs[i]! - cx) * skew) / 10000) + height;
      if (row >= 0 && row < counts.length) counts[row]! += 1;
    }
    let sum = 0;
    for (const count of counts) sum += count * count;
    return sum;
  };
  const none = score(0);
  let best = 0;
  let bestScore = none;
  for (let skew = -MAX_SKEW; skew <= MAX_SKEW; skew += 25) {
    const s = score(skew);
    if (s > bestScore) {
      best = skew;
      bestScore = s;
    }
  }
  const coarse = best;
  for (let skew = coarse - 20; skew <= coarse + 20; skew += 5) {
    const s = score(skew);
    if (s > bestScore) {
      best = skew;
      bestScore = s;
    }
  }
  // It must beat no turn by a clear margin (2 %), and be a turn worth taking out.
  if (Math.abs(best) < MIN_SKEW || bestScore * 100 < none * 102) return 0;
  return best;
}

/** The ink turned by `skew`, in a picture of the same size; what falls outside is dropped. */
function turned(bitmap: Bitmap, skew: number): Bitmap {
  if (skew === 0) return bitmap;
  const { width, height, ink } = bitmap;
  const out = new Uint8Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!ink[y * width + x]) continue;
      const nx = Math.round(x + ((y - cy) * skew) / 10000);
      const ny = Math.round(y - ((x - cx) * skew) / 10000);
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) out[ny * width + nx] = 1;
    }
  }
  return { width, height, ink: out };
}

function transposed({ width, height, ink }: Bitmap): Bitmap {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out[x * height + y] = ink[y * width + x]!;
  }
  return { width: height, height: width, ink: out };
}

interface Stroke {
  at: number;
  from: number;
  to: number;
  thick: number;
}

/** The horizontal strokes of a picture: long runs of ink, joined across rows. */
function horizontalStrokes(
  { width, height, ink }: Bitmap,
  minLength: number,
  maxThickness: number,
): Stroke[] {
  const runX0: number[] = [];
  const runX1: number[] = [];
  const runY: number[] = [];
  const parent: number[] = [];
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  let previous: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    let start = -1;
    let last = -1;
    const close = () => {
      if (start >= 0 && last - start + 1 >= minLength) {
        const id = runX0.length;
        runX0.push(start);
        runX1.push(last);
        runY.push(y);
        parent.push(id);
        row.push(id);
      }
      start = -1;
    };
    for (let x = 0; x < width; x += 1) {
      if (ink[y * width + x]) {
        if (start < 0) start = x;
        last = x;
      } else if (start >= 0 && x - last > BRIDGE) {
        close();
      }
    }
    close();
    // Join each run to the runs above it that it touches.
    for (const id of row) {
      for (const above of previous) {
        if (runX0[id]! <= runX1[above]! + 1 && runX0[above]! <= runX1[id]! + 1) {
          parent[find(id)] = find(above);
        }
      }
    }
    previous = row;
  }
  const groups = new Map<number, Stroke & { y0: number; y1: number }>();
  for (let id = 0; id < runX0.length; id += 1) {
    const root = find(id);
    const group = groups.get(root);
    if (!group) {
      groups.set(root, {
        at: 0,
        from: runX0[id]!,
        to: runX1[id]!,
        thick: 0,
        y0: runY[id]!,
        y1: runY[id]!,
      });
    } else {
      group.from = Math.min(group.from, runX0[id]!);
      group.to = Math.max(group.to, runX1[id]!);
      group.y0 = Math.min(group.y0, runY[id]!);
      group.y1 = Math.max(group.y1, runY[id]!);
    }
  }
  const strokes: Stroke[] = [];
  for (const group of groups.values()) {
    const thick = group.y1 - group.y0 + 1;
    const length = group.to - group.from + 1;
    // A line is thin, and far longer than it is thick: a block of ink or a smear is neither.
    if (thick > maxThickness || length < thick * 6) continue;
    strokes.push({
      at: Math.floor((group.y0 + group.y1) / 2),
      from: group.from,
      to: group.to,
      thick,
    });
  }
  return strokes;
}

/** Strokes on one line, with a small gap between them, as one. Sorted by `at`, then `from`. */
function joined(strokes: Stroke[], gap: number): Stroke[] {
  const sorted = [...strokes].sort((a, b) => a.at - b.at || a.from - b.from);
  const out: Stroke[] = [];
  for (const stroke of sorted) {
    const match = out.find(
      (other) =>
        Math.abs(other.at - stroke.at) <= Math.max(2, other.thick, stroke.thick) &&
        stroke.from <= other.to + gap &&
        other.from <= stroke.to + gap,
    );
    if (match) {
      match.from = Math.min(match.from, stroke.from);
      match.to = Math.max(match.to, stroke.to);
      match.thick = Math.max(match.thick, stroke.thick);
    } else {
      out.push({ ...stroke });
    }
  }
  return out
    .map(({ at, from, to, thick }) => ({ at, from, to, thick }))
    .sort((a, b) => a.at - b.at || a.from - b.from);
}

/** The ruled lines of a page picture: straightened, then horizontal and vertical strokes. */
export function findLines(bitmap: Bitmap, options: FindOptions = {}): FoundLines {
  const { width, height } = bitmap;
  const shorter = Math.min(width, height);
  const minLength = options.minLength ?? Math.max(24, Math.floor(shorter / 16));
  const maxThickness = options.maxThickness ?? Math.max(4, Math.floor(shorter / 150));
  const skew = options.straighten === false ? 0 : estimateSkew(bitmap);
  const upright = turned(bitmap, skew);
  const gap = Math.max(4, Math.floor(shorter / 40));
  const horizontal = joined(horizontalStrokes(upright, minLength, maxThickness), gap);
  const vertical = joined(horizontalStrokes(transposed(upright), minLength, maxThickness), gap);
  return {
    width,
    height,
    skew,
    lines: [
      ...horizontal.map((s): RuledLine => ({ dir: 'h', ...s })),
      ...vertical.map((s): RuledLine => ({ dir: 'v', ...s })),
    ],
  };
}

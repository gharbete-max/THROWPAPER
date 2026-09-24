/**
 * Straightening a photographed page: four corners in, a flat upright page out.
 *
 * What a scanner app does after it has found the page's edges. Here `detect.ts` makes a first
 * guess and a person confirms or moves it, by dragging four handles (`CropPhoto.tsx`) — the part
 * a person is reliably better at than an 8 MB computer-vision library on a dark table.
 *
 * ## The maths, briefly
 *
 * A flat page photographed at an angle is a projective transform of the page: straight lines
 * stay straight, parallel ones do not. Eight numbers describe it (a 3×3 matrix up to scale),
 * and four point correspondences give exactly eight equations — the four corners are enough.
 * `homography` solves them directly; `straighten` then asks, for every pixel of the output
 * page, where in the photograph it came from, and samples there.
 *
 * Pure functions over `ImageData`; nothing here knows about React or the DOM beyond a canvas.
 */

export interface Point {
  x: number;
  y: number;
}

/** Top-left, top-right, bottom-right, bottom-left — reading order, like a page. */
export type Corners = [Point, Point, Point, Point];

/** `ImageData` without the DOM: the maths runs the same in a test as in a browser. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Whether four dragged corners still describe a page: a convex quadrilateral with no three
 * corners on a line. A handle dragged across the opposite edge produces a bow-tie, and a bow-tie
 * is not a page — refused here, before any pixel is sampled.
 */
export function isUsable(corners: Corners): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const c = corners[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** The longest side of a straightened page. Enough for OCR and for anchors; kind to storage. */
export const MAX_OUTPUT_PX = 1600;

/**
 * The 3×3 projective matrix taking each `from[i]` to `to[i]`, row-major with `h[8] = 1`.
 *
 * Direct linear solution: eight unknowns, eight equations, Gaussian elimination with partial
 * pivoting. Throws on a degenerate quadrilateral (three corners on a line), which a person
 * dragging handles can produce and the caller should refuse rather than render.
 */
export function homography(from: Corners, to: Corners): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 8; r += 1) {
      if (Math.abs(rows[r]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(rows[pivot]![col]!) < 1e-12) throw new Error('degenerate corners');
    [rows[col], rows[pivot]] = [rows[pivot]!, rows[col]!];
    const lead = rows[col]!;
    for (let r = 0; r < 8; r += 1) {
      if (r === col) continue;
      const factor = rows[r]![col]! / lead[col]!;
      if (factor === 0) continue;
      for (let c = col; c < 9; c += 1) rows[r]![c]! -= factor * lead[c]!;
    }
  }

  const h = rows.map((row, i) => row[8]! / row[i]!);
  h.push(1);
  return h;
}

/** Applies a homography to a point. */
export function apply(h: number[], { x, y }: Point): Point {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return {
    x: (h[0]! * x + h[1]! * y + h[2]!) / w,
    y: (h[3]! * x + h[4]! * y + h[5]!) / w,
  };
}

/** The output page's size for a quadrilateral, from its average edge lengths, capped. */
export function outputSize(corners: Corners): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let width = (dist(tl, tr) + dist(bl, br)) / 2;
  let height = (dist(tl, bl) + dist(tr, br)) / 2;
  const scale = Math.min(1, MAX_OUTPUT_PX / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}

/**
 * The page inside `source`, as its own image.
 *
 * `corners` are in source pixels. Every output pixel is mapped back into the photograph and
 * sampled bilinearly — a plain loop, about 3 million pixels at the cap, under a second.
 */
export function straighten(source: Pixels, corners: Corners): Pixels {
  const { width, height } = outputSize(corners);
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    corners,
  );

  const out: Pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const src = source.data;
  const sw = source.width;
  const sh = source.height;
  const dst = out.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = apply(h, { x: x + 0.5, y: y + 0.5 });
      const sx = Math.min(sw - 1.001, Math.max(0, p.x - 0.5));
      const sy = Math.min(sh - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = src[i00 + c]! * (1 - fx) + src[i10 + c]! * fx;
        const bottom = src[i01 + c]! * (1 - fx) + src[i11 + c]! * fx;
        dst[o + c] = top * (1 - fy) + bottom * fy;
      }
      dst[o + 3] = 255;
    }
  }
  return out;
}

/** Whether the corners are still the picture's own — in which case there is nothing to do. */
export function isWholePicture(corners: Corners, width: number, height: number): boolean {
  const [tl, tr, br, bl] = corners;
  const near = (p: Point, x: number, y: number) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1;
  return near(tl, 0, 0) && near(tr, width, 0) && near(br, width, height) && near(bl, 0, height);
}

/**
 * Straightens an image file in the browser. `corners` are fractions of the picture, as the
 * editor keeps them. Returns the original when the corners are the picture's own. JPEG, because
 * this is a photograph and PNG would be five times the bytes for nothing.
 */
export async function straightenFile(file: File, fractions: Corners): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const corners = fractions.map((c) => ({
      x: c.x * bitmap.width,
      y: c.y * bitmap.height,
    })) as Corners;
    if (isWholePicture(corners, bitmap.width, bitmap.height)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const page = straighten(ctx.getImageData(0, 0, bitmap.width, bitmap.height), corners);
    canvas.width = page.width;
    canvas.height = page.height;
    ctx.putImageData(new ImageData(page.data, page.width, page.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('could not encode the page');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/**
 * Page filters for photographs on the Scan screen, as pure functions on RGBA bytes: the same input
 * always gives the same output, nothing is drawn and nothing leaves the device. The screen lets the
 * person see the result before it is kept (`ScanFilter.tsx`).
 *
 * Every filter that whitens the paper first estimates the page's *background* — a large box mean
 * from an integral image, with the dark ink rejected and the mean taken again — and divides the
 * page by it. A shadow, a lamp's gradient or an uneven phone exposure is then gone before ink is
 * told from paper. A hard-edged shadow is softened over one window width, not removed.
 */
export type FilterId = 'original' | 'enhanced' | 'grey' | 'bw' | 'clean';
export const FILTERS: readonly FilterId[] = ['original', 'enhanced', 'grey', 'bw', 'clean'];
export const DEFAULT_STRENGTH = 0.5;

export interface Pixels {
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Rec. 601 luma. */
export function luma(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
  }
  return out;
}

/**
 * The mean of each pixel's (2r+1)-square neighbourhood. Sums of bytes are kept in a Uint32Array,
 * which holds an image up to 16.7 million pixels; the Scan screen never makes one over 3508 px on
 * its long side (12.3 million).
 */
export function boxMean(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  r: number,
): Float32Array {
  const stride = width + 1;
  const sum = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const total =
        sum[y1 * stride + x1]! -
        sum[y0 * stride + x1]! -
        sum[y1 * stride + x0]! +
        sum[y0 * stride + x0]!;
      out[y * width + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** The paper's brightness under each pixel: smooth, with ink and its halo taken out. */
export function background(gray: Uint8ClampedArray, width: number, height: number): Float32Array {
  const r = Math.max(8, Math.round(Math.max(width, height) / 16));
  let bg = boxMean(gray, width, height, r);
  const work = new Uint8ClampedArray(gray.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < gray.length; i++) {
      // Anything clearly darker than its surroundings is ink: stand the surroundings in for it.
      work[i] = gray[i]! < bg[i]! * 0.92 ? bg[i]! : gray[i]!;
    }
    bg = boxMean(work, width, height, r);
  }
  return bg;
}

/** Brightness 0..255 with the background divided out; paper is 255, ink keeps its contrast. */
export function flatten(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const bg = background(gray, width, height);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < out.length; i++) out[i] = (gray[i]! * 255) / Math.max(1, bg[i]!);
  return out;
}

/** The brightness below which `share` of the pixels lie. */
function percentile(gray: Uint8ClampedArray, share: number): number {
  const histogram = new Uint32Array(256);
  for (const v of gray) histogram[v]!++;
  const wanted = gray.length * share;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]!;
    if (seen >= wanted) return v;
  }
  return 255;
}

function levels(gray: Uint8ClampedArray): { lo: number; scale: number } {
  const lo = percentile(gray, 0.01);
  const hi = Math.max(lo + 32, percentile(gray, 0.99));
  return { lo, scale: 255 / (hi - lo) };
}

/** Ink is 0, paper 255 (both opaque). The threshold follows `strength`: higher catches fainter ink. */
export function bilevel(pixels: Pixels, strength = DEFAULT_STRENGTH): Uint8ClampedArray {
  const { width, height } = pixels;
  const flat = flatten(luma(pixels.data), width, height);
  const cut = 255 * (1 - (0.12 + 0.28 * strength));
  const out = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < flat.length; i++) {
    const v = flat[i]! < cut ? 0 : 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function clean(pixels: Pixels, strength: number): Uint8ClampedArray {
  const { width, height, data } = pixels;
  const bg = background(luma(data), width, height);
  const white = 255 - 30 * strength; // paper at or above this is pure white
  const lift = new Uint8ClampedArray(data.length);
  for (let i = 0; i < bg.length; i++) {
    const k = (255 / Math.max(1, bg[i]!)) * (255 / white);
    lift[i * 4] = data[i * 4]! * k;
    lift[i * 4 + 1] = data[i * 4 + 1]! * k;
    lift[i * 4 + 2] = data[i * 4 + 2]! * k;
    lift[i * 4 + 3] = 255;
  }
  // Unsharp mask on a 3x3 blur: crisper strokes, nothing invented.
  const amount = 0.4 + 0.8 * strength;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let total = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            total += lift[(yy * width + xx) * 4 + c]!;
            n++;
          }
        }
        const v = lift[at + c]!;
        out[at + c] = clamp(v + amount * (v - total / n));
      }
      out[at + 3] = 255;
    }
  }
  return out;
}

/** `pixels` with `filter` applied at `strength` (0..1). The input is not changed. */
export function applyFilter(pixels: Pixels, filter: FilterId, strength = DEFAULT_STRENGTH): Pixels {
  const { width, height } = pixels;
  const s = Math.min(1, Math.max(0, strength));
  let data: Uint8ClampedArray;
  switch (filter) {
    case 'original':
      data = new Uint8ClampedArray(pixels.data);
      break;
    case 'bw':
      data = bilevel(pixels, s);
      break;
    case 'clean':
      data = clean(pixels, s);
      break;
    case 'grey': {
      const g = luma(pixels.data);
      const { lo, scale } = levels(g);
      data = new Uint8ClampedArray(pixels.data.length);
      for (let i = 0; i < g.length; i++) {
        const v = g[i]! + s * ((g[i]! - lo) * scale - g[i]!);
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = clamp(v);
        data[i * 4 + 3] = 255;
      }
      break;
    }
    case 'enhanced': {
      const g = luma(pixels.data);
      const { lo, scale } = levels(g);
      const saturation = 1 + 0.5 * s;
      data = new Uint8ClampedArray(pixels.data.length);
      for (let i = 0; i < g.length; i++) {
        const grey = g[i]! + s * ((g[i]! - lo) * scale - g[i]!);
        for (let c = 0; c < 3; c++) {
          const v = pixels.data[i * 4 + c]!;
          const stretched = v + s * ((v - lo) * scale - v);
          data[i * 4 + c] = clamp(grey + (stretched - grey) * saturation);
        }
        data[i * 4 + 3] = 255;
      }
      break;
    }
  }
  return { data, width, height };
}

/**
 * Whether the page looks like dark ink on light paper — a few per cent of the background-flattened
 * page is dark, on a paper that is not itself dark. Meant for a small copy of the page. Then
 * "Clean document" is the suggestion; anything else stays as it is.
 */
export function suggestFilter(pixels: Pixels): FilterId {
  const { width, height, data } = pixels;
  const g = luma(data);
  const bg = background(g, width, height);
  let paper = 0;
  for (const v of bg) paper += v;
  if (paper / bg.length < 80) return 'original';
  const flat = flatten(g, width, height);
  let dark = 0;
  for (const v of flat) if (v < 170) dark++;
  const share = dark / flat.length;
  return share >= 0.015 && share <= 0.4 ? 'clean' : 'original';
}

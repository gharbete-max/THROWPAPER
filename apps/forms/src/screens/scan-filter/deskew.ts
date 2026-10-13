import { flatten, luma, type Pixels } from './image-filters.js';

/** The tilt found, in degrees clockwise to turn the page by to make its lines level. */
export interface Skew {
  angle: number;
  /** False when the lines are level already, or the page has no lines to go by. */
  found: boolean;
}

const RANGE = 8;
const WORK_SIDE = 640;

/**
 * Small-angle skew by projection profile: the dark pixels are projected onto the vertical axis at
 * each trial angle, and the angle at which the rows are sparsest and densest — lines of text lying
 * level — wins. A coarse sweep, then a fine one around the best. Not offered below 0.3 degrees, or
 * when level is nearly as good as the best (a page of photographs or one line).
 */
export function estimateSkew(pixels: Pixels): Skew {
  const k = Math.max(1, Math.floor(Math.max(pixels.width, pixels.height) / WORK_SIDE));
  const w = Math.floor(pixels.width / k);
  const h = Math.floor(pixels.height / k);
  const small = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (y * k * pixels.width + x * k) * 4;
      small.set(pixels.data.subarray(from, from + 4), (y * w + x) * 4);
    }
  }
  const flat = flatten(luma(small), w, h);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (flat[i]! < 170) {
      xs.push(i % w);
      ys.push(Math.floor(i / w));
    }
  }
  if (xs.length < 50) return { angle: 0, found: false };

  const bins = new Float64Array(h + w + 8);
  const score = (degrees: number) => {
    bins.fill(0);
    const sin = Math.sin((degrees * Math.PI) / 180);
    const cos = Math.cos((degrees * Math.PI) / 180);
    const shift = Math.ceil(w * Math.abs(sin)) + 2;
    for (let i = 0; i < xs.length; i++) bins[Math.round(xs[i]! * sin + ys[i]! * cos) + shift]!++;
    let total = 0;
    for (const n of bins) total += n * n;
    return total;
  };

  let best = 0;
  const level = score(0);
  let top = level;
  for (let d = -RANGE; d <= RANGE; d += 0.5) {
    const s = score(d);
    if (s > top) [best, top] = [d, s];
  }
  const centre = best;
  for (let d = centre - 0.5; d <= centre + 0.5; d += 0.1) {
    const s = score(d);
    if (s > top) [best, top] = [d, s];
  }
  best = Math.round(best * 10) / 10;
  return top > level * 1.05 && Math.abs(best) >= 0.3
    ? { angle: best, found: true }
    : { angle: 0, found: false };
}

/** `degrees` clockwise about the centre, bilinear, the corners that come in left white. */
export function rotatePixels(pixels: Pixels, degrees: number): Pixels {
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length).fill(255);
  const sin = Math.sin((degrees * Math.PI) / 180);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = dx * cos + dy * sin + cx;
      const sy = -dx * sin + dy * cos + cy;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const top =
          data[(y0 * width + x0) * 4 + c]! * (1 - fx) + data[(y0 * width + x1) * 4 + c]! * fx;
        const bottom =
          data[(y1 * width + x0) * 4 + c]! * (1 - fx) + data[(y1 * width + x1) * 4 + c]! * fx;
        out[(y * width + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { data: out, width, height };
}

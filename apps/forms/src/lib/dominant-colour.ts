/**
 * The colour a logo is mostly made of.
 *
 * Uploading a logo and then hand-matching the buttons to it is the sort of chore that makes a
 * brand editor feel like homework, so the logo answers the question itself: the dominant colour
 * becomes the primary, replacing the shipped blue.
 *
 * ## Why the naive answer is wrong
 *
 * "Most frequent pixel" picks the background — a logo on white is mostly white, and a
 * transparent PNG is mostly nothing. It also splits one colour across dozens of near-identical
 * values, because anti-aliasing means no two edge pixels match exactly.
 *
 * So: transparent and near-neutral pixels are discarded, the remainder is bucketed coarsely so
 * shades of one colour count together, and the winning bucket is averaged over its real members
 * rather than snapped to the bucket centre.
 */

/** Alpha below this is a pixel somebody meant to be invisible. */
const MIN_ALPHA = 128;

/** How close to grey a pixel may be before it stops counting as a colour. */
const MIN_SATURATION = 0.15;

/** Pixels this light or this dark are page, not brand. */
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.92;

/** Buckets per channel. Coarse on purpose: anti-aliased edges must land with their own colour. */
const BUCKETS = 6;

export interface DominantColour {
  hex: string;
  /** Share of the colourful pixels this colour accounts for, 0–1. */
  share: number;
}

/**
 * Reads the image in a canvas, so it works for every format the browser can decode and needs no
 * library. Returns `null` when there is no usable answer — a greyscale logo, a monochrome
 * wordmark, an image that failed to decode. A wrong colour is worse than no suggestion.
 */
export async function dominantColour(source: string): Promise<DominantColour | null> {
  const image = await load(source);
  if (!image) return null;

  // Small enough to be quick, large enough that a small mark is not sampled away.
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, size, size);

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {
    // A cross-origin image taints the canvas. Ours are same-origin, but never throw over it.
    return null;
  }

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let counted = 0;

  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at]!;
    const g = pixels[at + 1]!;
    const b = pixels[at + 2]!;
    const alpha = pixels[at + 3]!;

    if (alpha < MIN_ALPHA) continue;

    const { saturation, lightness } = describe(r, g, b);
    if (saturation < MIN_SATURATION) continue;
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue;

    const key =
      Math.floor((r / 256) * BUCKETS) * BUCKETS * BUCKETS +
      Math.floor((g / 256) * BUCKETS) * BUCKETS +
      Math.floor((b / 256) * BUCKETS);

    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
    counted += 1;
  }

  if (counted === 0) return null;

  let winner: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket;
  }
  if (!winner) return null;

  // Averaged over the bucket's actual members, so the answer is a colour that was really there
  // rather than the centre of a range.
  return {
    hex: toHex(
      Math.round(winner.r / winner.count),
      Math.round(winner.g / winner.count),
      Math.round(winner.b / winner.count),
    ),
    share: winner.count / counted,
  };
}

function load(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function describe(r: number, g: number, b: number): { saturation: number; lightness: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { saturation: 0, lightness };
  return { saturation: delta / (1 - Math.abs(2 * lightness - 1)), lightness };
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

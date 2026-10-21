import { isUsable, type Corners, type Pixels } from './warp.js';

/**
 * A first guess at where the page is in a photograph, so the four handles start on its corners
 * instead of the picture's. The person still sees them and can drag any of them (`CropPhoto`);
 * this only saves the dragging in the common case — a light page on a darker table.
 *
 * Deliberately small, no computer-vision library: the picture is shrunk to at most 320 px,
 * split into light and dark at the threshold that separates them best (Otsu), and the light
 * region connected to the middle of the picture is taken as the page. Its corners are the points
 * furthest towards each corner of the picture (smallest and largest x+y and x−y), which is exact
 * for a page seen at the usual angles.
 *
 * It answers null — keep the whole picture — whenever the guess is doubtful: the light region
 * touches most of the border (a page filling the frame, or a scan from a flatbed, which is
 * already straight), it is small, or it is not shaped like a four-sided page.
 */
export const DETECT_MAX_SIDE = 320;

export function findPage(image: Pixels): Corners | null {
  const { width, height, data } = image;
  if (width < 16 || height < 16) return null;
  const count = width * height;

  const grey = new Uint8Array(count);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < count; i += 1) {
    const value = Math.round(
      0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!,
    );
    grey[i] = value;
    histogram[value]! += 1;
  }
  const threshold = otsu(histogram, count);
  if (threshold === null) return null;

  // The light region that contains the middle of the picture: a person aims at the page.
  const light = (i: number) => grey[i]! > threshold;
  const start = Math.floor(height / 2) * width + Math.floor(width / 2);
  if (!light(start)) return null;
  const seen = new Uint8Array(count);
  const stack = [start];
  seen[start] = 1;
  let area = 0;
  let border = 0;
  let tl = { s: Infinity, x: 0, y: 0 };
  let br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 };
  let bl = { s: Infinity, x: 0, y: 0 };
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    area += 1;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border += 1;
    if (x + y < tl.s) tl = { s: x + y, x, y };
    if (x + y > br.s) br = { s: x + y, x, y };
    if (x - y > tr.s) tr = { s: x - y, x, y };
    if (x - y < bl.s) bl = { s: x - y, x, y };
    for (const next of [i - 1, i + 1, i - width, i + width]) {
      if (next < 0 || next >= count || seen[next]) continue;
      // No wrapping from one row's end to the next row's start.
      if ((next === i - 1 && x === 0) || (next === i + 1 && x === width - 1)) continue;
      if (!light(next)) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }

  // Filling the frame — or the page runs off it — means there is nothing to find.
  const perimeter = 2 * (width + height) - 4;
  if (border > perimeter * 0.25) return null;
  if (area < count * 0.15) return null;

  // Pixel centres to edges: the corner pixel's outer corner is the page's.
  const corners: Corners = [
    { x: tl.x / (width - 1), y: tl.y / (height - 1) },
    { x: tr.x / (width - 1), y: tr.y / (height - 1) },
    { x: br.x / (width - 1), y: br.y / (height - 1) },
    { x: bl.x / (width - 1), y: bl.y / (height - 1) },
  ];
  if (!isUsable(corners)) return null;
  // A page fills its own outline; a blob, a hand or a lamp's reflection does not.
  const quad = quadArea(corners) * (width - 1) * (height - 1);
  if (quad <= 0 || area / quad < 0.85 || area / quad > 1.15) return null;
  return corners;
}

/** The threshold that best separates a two-tone histogram, or null when there is one tone. */
function otsu(histogram: number[], total: number): number | null {
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * histogram[t]!;
  let sumBackground = 0;
  let weightBackground = 0;
  let best = -1;
  let threshold: number | null = null;
  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * histogram[t]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function quadArea(corners: Corners): number {
  let twice = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** `findPage` on an image file, shrunk first. Never throws: a failed guess is no guess. */
export async function detectPage(file: File): Promise<Corners | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return findPage(context.getImageData(0, 0, canvas.width, canvas.height));
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

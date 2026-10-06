import type { Box } from './types.js';

/**
 * The two derived quantities `LAYOUT-IR.md` defines once and every producer and checker must agree
 * on: a union of boxes, and the lower median ("for an even count, the smaller of the two middle
 * values"). Integers in, integers out.
 */

/** The smallest box holding every box given. At least one box, or it is a programming error. */
export function unionBox(boxes: readonly Box[]): Box {
  if (boxes.length === 0) throw new RangeError('unionBox: no boxes');
  let { x0, y0, x1, y1 } = boxes[0]!;
  for (const box of boxes) {
    if (box.x0 < x0) x0 = box.x0;
    if (box.y0 < y0) y0 = box.y0;
    if (box.x1 > x1) x1 = box.x1;
    if (box.y1 > y1) y1 = box.y1;
  }
  return { x0, y0, x1, y1 };
}

/** The lower median; 0 for no values. */
export function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1] ?? 0;
}

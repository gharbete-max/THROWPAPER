import { describe, expect, it } from 'vitest';
import { findPage } from './detect.js';
import type { Point, Pixels } from './warp.js';

/** A picture of `background` with a filled quadrilateral of `page` on it. */
function picture(
  width: number,
  height: number,
  quad: Point[] | null,
  page = 235,
  background = 60,
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = quad ? contains(quad, x + 0.5, y + 0.5) : false;
      const value = inside ? page : background;
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function contains(quad: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i]!;
    const b = quad[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('finding the page in a photograph', () => {
  it('finds a tilted light page on a dark table, within a pixel or two', () => {
    const quad = [
      { x: 60, y: 30 },
      { x: 250, y: 45 },
      { x: 235, y: 290 },
      { x: 40, y: 270 },
    ];
    const corners = findPage(picture(300, 320, quad));
    expect(corners).not.toBeNull();
    corners!.forEach((corner, i) => {
      expect(Math.abs(corner.x * 299 - quad[i]!.x)).toBeLessThan(3);
      expect(Math.abs(corner.y * 319 - quad[i]!.y)).toBeLessThan(3);
    });
  });

  it('keeps the whole picture for a page that fills the frame, as a flatbed scan does', () => {
    expect(findPage(picture(200, 280, null, 235, 240))).toBeNull();
    const fills = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 280 },
      { x: 0, y: 280 },
    ];
    expect(findPage(picture(200, 280, fills))).toBeNull();
  });

  it('declines a small or shapeless light patch rather than guessing', () => {
    const small = [
      { x: 90, y: 90 },
      { x: 110, y: 90 },
      { x: 110, y: 110 },
      { x: 90, y: 110 },
    ];
    expect(findPage(picture(200, 200, small))).toBeNull();
    // A light diamond-with-a-bite: its extreme points make a quadrilateral it does not fill.
    const star = [
      { x: 100, y: 10 },
      { x: 120, y: 90 },
      { x: 190, y: 100 },
      { x: 120, y: 110 },
      { x: 100, y: 190 },
      { x: 80, y: 110 },
      { x: 10, y: 100 },
      { x: 80, y: 90 },
    ];
    expect(findPage(picture(200, 200, star))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  apply,
  homography,
  isUsable,
  isWholePicture,
  outputSize,
  straighten,
  type Corners,
  type Pixels,
} from './warp.js';

const square: Corners = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** A page photographed from the left: the right edge is nearer and therefore taller. */
const skewed: Corners = [
  { x: 40, y: 30 },
  { x: 220, y: 10 },
  { x: 230, y: 190 },
  { x: 50, y: 160 },
];

describe('the projective transform', () => {
  it('sends each corner to its counterpart, and the middle to the middle', () => {
    const h = homography(square, skewed);
    for (let i = 0; i < 4; i += 1) {
      const p = apply(h, square[i]!);
      expect(p.x).toBeCloseTo(skewed[i]!.x, 6);
      expect(p.y).toBeCloseTo(skewed[i]!.y, 6);
    }
    // The centre of the square maps to where the skewed quad's diagonals cross.
    const centre = apply(h, { x: 50, y: 50 });
    expect(centre.x).toBeGreaterThan(100);
    expect(centre.x).toBeLessThan(180);
    expect(centre.y).toBeGreaterThan(60);
    expect(centre.y).toBeLessThan(130);
  });

  it('refuses corners that are not a page', () => {
    expect(isUsable(skewed)).toBe(true);
    // Three on a line.
    expect(
      isUsable([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
    // A bow-tie: bottom corners swapped.
    expect(
      isUsable([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ]),
    ).toBe(false);
  });
});

describe('straightening', () => {
  it('sizes the page by its edges and caps the long side', () => {
    expect(outputSize(skewed)).toEqual({ width: 182, height: 155 });
    const huge: Corners = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    expect(outputSize(huge)).toEqual({ width: 1600, height: 1200 });
  });

  it('lifts a white quadrilateral off a dark background into an all-white page', () => {
    // A 300×220 dark picture with the skewed white page painted on it, pixel by pixel.
    const width = 300;
    const height = 220;
    const source: Pixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const toSkewed = homography(square, skewed);
    const toSquare = homography(skewed, square);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = apply(toSquare, { x: x + 0.5, y: y + 0.5 });
        const inside = p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
        const i = (y * width + x) * 4;
        source.data[i] = source.data[i + 1] = source.data[i + 2] = inside ? 255 : 40;
        source.data[i + 3] = 255;
      }
    }
    expect(apply(toSkewed, { x: 0, y: 0 }).x).toBeCloseTo(40);

    const page = straighten(source, skewed);
    expect(page.width).toBe(182);
    // Sample well inside each corner and the centre: all paper, no table.
    const at = (fx: number, fy: number) =>
      page.data[(Math.round(page.height * fy) * page.width + Math.round(page.width * fx)) * 4]!;
    for (const [fx, fy] of [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.95, 0.95],
      [0.05, 0.95],
      [0.5, 0.5],
    ] as const) {
      expect(at(fx, fy)).toBeGreaterThan(240);
    }
  });

  it('knows when the corners are still the whole picture', () => {
    expect(isWholePicture(square, 100, 100)).toBe(true);
    expect(isWholePicture(skewed, 300, 220)).toBe(false);
  });
});

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { estimateSkew, rotatePixels } from './deskew.js';
import { applyFilter, FILTERS, suggestFilter, type Pixels } from './image-filters.js';
import { encodeBilevelPng } from './png1.js';

const W = 320;
const H = 440;

/**
 * Lines of "text" (dashed strokes, 3 px thick) on paper lit by a gradient: 220 at the left edge,
 * 90 at the right — a shadow across the page. `ink[i]` says which pixels are stroke.
 */
function page(width = W, height = H): { pixels: Pixels; ink: boolean[] } {
  const data = new Uint8ClampedArray(width * height * 4);
  const ink: boolean[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const line = y > 40 && y < height - 40 && y % 22 < 3;
      const stroke = line && x > 30 && x < width - 30 && x % 12 < 8;
      const light = 220 - (130 * x) / width;
      const v = stroke ? light * 0.2 : light;
      const at = (y * width + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = v;
      data[at + 3] = 255;
      ink.push(stroke);
    }
  }
  return { pixels: { data, width, height }, ink };
}

describe('filters on a shadowed page', () => {
  const { pixels, ink } = page();

  it('black and white keeps the strokes dark and turns the shadow white', () => {
    const out = applyFilter(pixels, 'bw');
    let strokes = 0;
    let strokeDark = 0;
    let paper = 0;
    let paperWhite = 0;
    for (let i = 0; i < ink.length; i++) {
      // Stay off the edges of the page, where the window is cut short.
      const x = i % W;
      if (x < 20 || x > W - 20) continue;
      const v = out.data[i * 4]!;
      if (ink[i]) {
        strokes++;
        if (v === 0) strokeDark++;
      } else {
        paper++;
        if (v === 255) paperWhite++;
      }
    }
    expect(strokeDark / strokes).toBeGreaterThan(0.95);
    expect(paperWhite / paper).toBeGreaterThan(0.99);
    // Only ink and paper, never grey or all black.
    expect(new Set(Array.from({ length: W * H }, (_, i) => out.data[i * 4])).size).toBe(2);
  });

  it('clean document whitens the shadowed paper and keeps ink dark', () => {
    const out = applyFilter(pixels, 'clean');
    let paperSum = 0;
    let paperN = 0;
    let inkMax = 0;
    for (let i = 0; i < ink.length; i++) {
      const x = i % W;
      if (x < 20 || x > W - 20) continue;
      const v = out.data[i * 4]!;
      if (ink[i]) inkMax = Math.max(inkMax, v);
      else {
        paperSum += v;
        paperN++;
      }
    }
    expect(paperSum / paperN).toBeGreaterThan(235);
    expect(inkMax).toBeLessThan(110);
  });

  it('every filter returns an opaque page of the same size and leaves its input alone', () => {
    const before = new Uint8ClampedArray(pixels.data);
    for (const filter of FILTERS) {
      for (const strength of [0, 0.5, 1]) {
        const out = applyFilter(pixels, filter, strength);
        expect(out.width).toBe(W);
        expect(out.data.length).toBe(pixels.data.length);
        expect(out.data[3]).toBe(255);
        expect(out.data.some((v, i) => i % 4 === 0 && v > 0)).toBe(true); // not all black
      }
    }
    expect(pixels.data).toEqual(before);
  });

  it('original is the page unchanged; grey has equal channels', () => {
    expect(applyFilter(pixels, 'original').data).toEqual(pixels.data);
    const grey = applyFilter(pixels, 'grey');
    expect(grey.data[4 * 100]).toBe(grey.data[4 * 100 + 1]);
    expect(grey.data[4 * 100]).toBe(grey.data[4 * 100 + 2]);
  });

  it('suggests Clean document for text on paper, and nothing for a smooth picture', () => {
    expect(suggestFilter(pixels)).toBe('clean');
    const smooth = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      smooth[i * 4] = 40 + ((i % W) * 200) / W;
      smooth[i * 4 + 1] = 90;
      smooth[i * 4 + 2] = 160;
      smooth[i * 4 + 3] = 255;
    }
    expect(suggestFilter({ data: smooth, width: W, height: H })).toBe('original');
  });
});

describe('deskew', () => {
  const level = page(480, 640).pixels;
  const filled = applyFilter(level, 'clean'); // evenly lit lines on white

  it.each([3, -2.2, 0.8, 6])('finds a page turned %f degrees', (tilt) => {
    const found = estimateSkew(rotatePixels(filled, tilt));
    expect(found.found).toBe(true);
    expect(Math.abs(found.angle + tilt)).toBeLessThanOrEqual(0.5);
  });

  it('leaves a level page and a blank page alone', () => {
    expect(estimateSkew(filled).found).toBe(false);
    const blank = new Uint8ClampedArray(480 * 640 * 4).fill(255);
    expect(estimateSkew({ data: blank, width: 480, height: 640 }).found).toBe(false);
  });

  it('turning by the angle found puts the lines level again', () => {
    const tilted = rotatePixels(filled, 4);
    const { angle } = estimateSkew(tilted);
    expect(estimateSkew(rotatePixels(tilted, angle)).found).toBe(false);
  });
});

describe('bilevel PNG', () => {
  it('is a 1-bit greyscale PNG that holds the ink and paper it was given', async () => {
    const w = 21; // not a multiple of 8: the padding bits are exercised
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    data[(1 * w + 5) * 4] = 0; // one ink pixel at (5, 1)
    const png = await encodeBilevelPng(data, w, h);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([w, h, 1, 0]);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const rowBytes = 3;
    expect(raw.length).toBe((rowBytes + 1) * h);
    expect(raw[1 * (rowBytes + 1) + 1]).toBe(0b11111011); // bit 5 of row 1 is ink (0)
    expect(raw[0 * (rowBytes + 1) + 1]).toBe(0xff);
  });
});

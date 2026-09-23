import { describe, expect, it } from 'vitest';
import { SignatureVector } from '@tp/shared/forms';
import { pathFrom } from './DrawingPad.js';

/**
 * The pad writes paths with `pathFrom`; the server refuses any path outside the grammar in
 * `signature-vector.ts`. If the two ever drift, signatures silently lose their vector — so they
 * are held together here rather than by anyone remembering.
 */
describe("the pad's paths and the server's grammar", () => {
  const accepts = (d: string) =>
    SignatureVector.safeParse({ v: 1, kind: 'drawn', width: 600, height: 200, paths: [d] }).success;

  it('agree on a tap, a short stroke and a long one', () => {
    expect(accepts(pathFrom([{ x: 12.345, y: 67.891 }]))).toBe(true);
    expect(
      accepts(
        pathFrom([
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ]),
      ),
    ).toBe(true);

    const long = Array.from({ length: 400 }, (_, index) => ({
      x: 300 + 250 * Math.sin(index / 7),
      y: 100 + 80 * Math.cos(index / 11),
    }));
    expect(accepts(pathFrom(long))).toBe(true);
  });

  it('agree when a captured stroke leaves the box', () => {
    // Pointer capture keeps a stroke going outside the canvas, so coordinates can be negative.
    expect(
      accepts(
        pathFrom([
          { x: -4.5, y: 10 },
          { x: 610, y: -0.001 },
          { x: 5, y: 250 },
        ]),
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { pathFrom } from './DrawingPad.js';
import { Field } from '@tp/shared/forms';

/**
 * The path data the pad produces has to be something the schema will store.
 *
 * `drawing.paths` is validated against a character allow-list — path commands and numbers, nothing
 * else — because path data goes straight into the `d` attribute of an SVG rendered on a public
 * form. A generator that emitted anything outside that set would be refused on save, and the
 * author would lose the drawing at the moment they tried to keep it.
 */
describe('capturing a stroke', () => {
  it('draws a dot for a tap', () => {
    // A single point with no `l` would be an empty path: the tap would appear to do nothing.
    expect(pathFrom([{ x: 5, y: 6 }])).toBe('M 5 6 l 0.01 0');
  });

  it('smooths through the midpoints', () => {
    const d = pathFrom([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d).toBe('M 0 0 Q 10 10 15 5 L 20 0');
  });

  it('rounds to two decimals', () => {
    expect(pathFrom([{ x: 1.23456, y: 7.89012 }])).toBe('M 1.23 7.89 l 0.01 0');
  });

  it('produces paths the schema accepts', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      x: index * 7.777,
      y: Math.sin(index) * 43.21,
    }));
    const parsed = Field.safeParse({
      id: crypto.randomUUID(),
      key: 'drawing',
      type: 'drawing',
      paths: [pathFrom(points), pathFrom([{ x: 0, y: 0 }])],
    });
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});

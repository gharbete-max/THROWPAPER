import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAVICON_MAX_RATIO, imageSize, isNearSquare } from './image-size.js';
import { checkImage } from './image.js';

/**
 * Read against real files rather than hand-built headers.
 *
 * A fixture assembled by the same understanding that wrote the parser proves only that the two
 * agree. These are files the product itself ships — written by the icon script and by a 3D
 * renderer — so the test fails if the reading is wrong rather than if the fixture is.
 */
const asset = (name: string) =>
  readFileSync(new URL(`../../../forms/public/${name}`, import.meta.url));

describe('reading a size from a header', () => {
  it.each([
    ['icon-192.png', 192, 192],
    ['icon-512.png', 512, 512],
    ['mark-angled-256.png', 256, 256],
    ['mark-poster-256.png', 256, 256],
  ])('reads %s', (name, width, height) => {
    const bytes = asset(name);
    const check = checkImage(bytes);
    expect(check.ok, `${name} is not a valid image`).toBe(true);
    expect(imageSize(bytes, 'png')).toEqual({ width, height });
  });

  /** The animated hero loop is an extended WebP, which states a canvas rather than a frame. */
  it('reads an animated WebP’s canvas', () => {
    expect(imageSize(asset('mark-loop-256.webp'), 'webp')).toEqual({ width: 256, height: 256 });
  });

  /**
   * A header it cannot make sense of is `null`, not a guess.
   *
   * Every caller treats "I do not know" as "not square", which falls back to the accent tile — so
   * an unreadable file costs a customer their logo in one 32px slot rather than shipping a broken
   * icon. Guessing would trade the wrong way.
   */
  it.each([
    ['empty', Buffer.alloc(0)],
    ['truncated png', asset('icon-192.png').subarray(0, 12)],
    ['not a png at all', Buffer.from('this is plainly not an image')],
  ])('answers null for %s', (_name, bytes) => {
    expect(imageSize(bytes, 'png')).toBeNull();
  });
});

/**
 * The question the size is read for.
 *
 * A wordmark is a good logo and a bad favicon: squeezed into a square it is an illegible smear, and
 * stretched into one it is a lie about somebody's brand. This is the line between the two.
 */
describe('whether a logo can be a favicon', () => {
  it('accepts a square mark and a slightly wide badge', () => {
    expect(isNearSquare({ width: 512, height: 512 })).toBe(true);
    expect(isNearSquare({ width: 400, height: 320 })).toBe(true);
    expect(isNearSquare({ width: 320, height: 400 })).toBe(true);
  });

  it('refuses a wordmark, in either orientation', () => {
    expect(isNearSquare({ width: 600, height: 180 })).toBe(false);
    expect(isNearSquare({ width: 180, height: 600 })).toBe(false);
  });

  it('refuses what it could not measure, rather than assuming', () => {
    expect(isNearSquare(null)).toBe(false);
    expect(isNearSquare({ width: 0, height: 0 })).toBe(false);
  });

  /** The threshold is symmetric: a tall logo is exactly as unreadable as a wide one. */
  it('draws the same line both ways round', () => {
    const wide = { width: Math.round(100 * FAVICON_MAX_RATIO), height: 100 };
    const tall = { width: 100, height: Math.round(100 * FAVICON_MAX_RATIO) };
    expect(isNearSquare(wide)).toBe(isNearSquare(tall));
  });
});

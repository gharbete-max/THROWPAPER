import type { ImageFormat } from './image.js';

/**
 * How big an uploaded image is, read from its own header.
 *
 * Needed for one question and it is not a cosmetic one: **is this logo square enough to survive
 * being a favicon?** A wordmark two hundred pixels wide and sixty tall is a perfectly good logo and
 * a terrible 32px icon — squeezed into a square it becomes an illegible smear, and stretched into
 * one it becomes a lie about somebody's brand. The answer decides whether a customer's tab shows
 * their mark or a tile in their colour.
 *
 * ## Why the headers rather than a library
 *
 * Four formats are allowed through `AssetPath`, and every one of them states its size in the first
 * few dozen bytes. An image library to read eight numbers would be a dependency, a supply-chain
 * surface and a decoder — and a decoder is the part of an image pipeline that has the memory-safety
 * bugs. Nothing here decodes anything: it reads fixed offsets and stops.
 *
 * ## Why `null` is a real answer
 *
 * A progressive JPEG with an unusual marker order, a WebP variant not covered here, a truncated
 * upload. Every caller treats "I do not know" as "not square", which falls back to the tile — so an
 * unreadable header costs a customer their logo in one 32px slot rather than shipping a broken one.
 * Guessing would be the wrong trade in the other direction.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export function imageSize(bytes: Buffer, format: ImageFormat): ImageSize | null {
  switch (format) {
    case 'png':
      return pngSize(bytes);
    case 'gif':
      return gifSize(bytes);
    case 'webp':
      return webpSize(bytes);
    case 'jpeg':
      return jpegSize(bytes);
    default:
      return null;
  }
}

/**
 * Square enough that a browser tab can show it.
 *
 * 1.3 rather than 1.0, because almost no logo is exactly square and refusing everything that is not
 * would mean nobody ever sees their own favicon. A badge at 4:3 still reads at 32px; a wordmark at
 * 3:1 does not, and that is the shape this is drawing the line against.
 */
export const FAVICON_MAX_RATIO = 1.3;

export function isNearSquare(size: ImageSize | null): boolean {
  if (!size || size.width <= 0 || size.height <= 0) return false;
  const ratio = size.width / size.height;
  return ratio <= FAVICON_MAX_RATIO && ratio >= 1 / FAVICON_MAX_RATIO;
}

/** `IHDR` is always the first chunk, so the two numbers are at fixed offsets. */
function pngSize(bytes: Buffer): ImageSize | null {
  if (bytes.byteLength < 24) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The logical screen descriptor, little-endian, immediately after `GIF89a`. */
function gifSize(bytes: Buffer): ImageSize | null {
  if (bytes.byteLength < 10) return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * Three WebP flavours, because the format is a container and the size lives somewhere different in
 * each: an extended file states a canvas, a lossy one hides it in the VP8 keyframe header, and a
 * lossless one packs two 14-bit numbers across a byte boundary.
 */
function webpSize(bytes: Buffer): ImageSize | null {
  if (bytes.byteLength < 30) return null;
  const chunk = bytes.toString('ascii', 12, 16);

  if (chunk === 'VP8X') {
    // Canvas size is stored minus one, as three little-endian bytes each.
    const width = bytes.readUIntLE(24, 3) + 1;
    const height = bytes.readUIntLE(27, 3) + 1;
    return { width, height };
  }

  if (chunk === 'VP8 ') {
    // A keyframe starts with this three-byte sync code; without it this is not one.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    // 14 bits of width then 14 of height, minus one each, straddling four bytes.
    const packed = bytes.readUInt32LE(21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

/**
 * JPEG states its size in a start-of-frame marker, and where that sits depends on how much metadata
 * the camera or the design tool wrote first — so the markers are walked rather than indexed.
 */
function jpegSize(bytes: Buffer): ImageSize | null {
  let at = 2;
  while (at + 9 < bytes.byteLength) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;

    /*
     * Every start-of-frame carries the dimensions, and there are several because there are several
     * ways to encode: baseline, progressive, arithmetic. `C4`, `C8` and `CC` share the range and
     * are not frames — Huffman tables and the like — which is why this is a list rather than a span.
     */
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isFrame) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }

    const length = bytes.readUInt16BE(at + 2);
    // A segment shorter than its own length field means the file is malformed; stop rather than loop.
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

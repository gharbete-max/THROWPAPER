import { rotatePixels } from './deskew.js';
import { applyFilter, type FilterId, type Pixels } from './image-filters.js';
import { encodeBilevelPng } from './png1.js';

/** The longest side of a made page: A4 at 300 dpi, as `scan-photo.ts` sends. */
export const FULL_SIDE = 3508;

export interface Settings {
  filter: FilterId;
  strength: number;
  /** Degrees clockwise to turn the page by first; 0 leaves it. */
  straighten: number;
}

/** The photograph as the browser draws it (turned the way its file says), on paper-white. */
export function openBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

export function pixelsOf(bitmap: ImageBitmap, longSide: number): Pixels {
  const k = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k));
  const height = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no canvas');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** `base` straightened, then filtered. */
export function process(base: Pixels, settings: Settings): Pixels {
  const level = settings.straighten === 0 ? base : rotatePixels(base, settings.straighten);
  return applyFilter(level, settings.filter, settings.strength);
}

export function paint(pixels: Pixels, canvas: HTMLCanvasElement): void {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas
    .getContext('2d')
    ?.putImageData(
      new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
      0,
      0,
    );
}

/**
 * The page at full size, made once: black and white as a 1-bit PNG (a text page is a few tens of
 * kilobytes), everything else as a JPEG the server embeds untouched.
 */
export async function make(bitmap: ImageBitmap, settings: Settings, name: string): Promise<File> {
  const pixels = process(pixelsOf(bitmap, FULL_SIDE), settings);
  const base = name.replace(/\.[^.]*$/, '');
  if (settings.filter === 'bw') {
    const png = await encodeBilevelPng(pixels.data, pixels.width, pixels.height);
    return new File([png as BlobPart], `${base}.png`, { type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  paint(pixels, canvas);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.88));
  if (!blob) throw new Error('not encoded');
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

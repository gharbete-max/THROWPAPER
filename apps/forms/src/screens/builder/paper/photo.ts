import { sha256 } from './extract.js';
import type { PageDrawer } from './extract.js';

/** The image types the review screen reads as a photograph (S14). */
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const isPhoto = (file: File) => (PHOTO_TYPES as readonly string[]).includes(file.type);

/** A photograph opened for the review screen: drawn in the source pane, and read by OCR. */
export interface Photo extends PageDrawer {
  sha256: string;
  /** The photograph as a picture to read: its longer side at most `longSide` pixels. */
  picture(longSide: number): HTMLCanvasElement;
}

/**
 * Opens a photograph, turned the way its file says (`imageOrientation: 'from-image'`): a phone's
 * picture of a page held upright is read upright. It is never straightened or cropped here
 * (`docs/plan/SCANS.md`, "Not in S14"), and never made larger than it is.
 */
export async function openPhoto(file: Blob): Promise<Photo> {
  const bytes = await file.arrayBuffer();
  const digest = await sha256(bytes);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const draw = (canvas: HTMLCanvasElement, width: number) => {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round((width * bitmap.height) / bitmap.width));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  return {
    sha256: digest,
    picture(longSide) {
      const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      draw(canvas, bitmap.width * scale);
      return canvas;
    },
    render(_index, width, canvas, signal) {
      if (!signal?.aborted) draw(canvas, width * (window.devicePixelRatio || 1));
      return Promise.resolve();
    },
    close() {
      bitmap.close();
      return Promise.resolve();
    },
  };
}

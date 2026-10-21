/**
 * Photographs on the Scan screen: what the browser does before one is sent as a page.
 *
 * A JPEG or PNG of a sensible size goes as it is, so the server can embed the JPEG without
 * re-encoding it and turn it upright from its EXIF orientation (`api-forms/src/pdf/arrange.ts`).
 * Anything else the server cannot embed (WebP) or should not receive (more than 16 megapixels, or
 * over the file limit) is drawn to a canvas, which also applies the orientation, and sent as a
 * JPEG no longer than 3508 px — A4 at 300 dpi. A format this browser cannot decode (HEIC in most)
 * throws, and the screen says so rather than sending something unreadable. Nothing leaves the
 * device here.
 */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const AS_IS_PIXELS = 16_000_000;
const LONG_SIDE = 3508;

export function isPhoto(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const plain = file.type === 'image/jpeg' || file.type === 'image/png';
    if (plain && width * height <= AS_IS_PIXELS && file.size <= MAX_PHOTO_BYTES) return file;

    const k = Math.min(1, LONG_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * k));
    canvas.height = Math.max(1, Math.round(height * k));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    // A JPEG has no transparency: paper-white underneath, as a scan would be.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.9));
    if (!blob) throw new Error('not encoded');
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

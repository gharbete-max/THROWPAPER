/**
 * The size choice when keeping a PDF made from photographs. Done in this browser, before the files
 * go to be arranged: each photograph is drawn smaller on a canvas and written again as a JPEG.
 * Pages that came from a PDF are copied as they are, so they are the same in every choice.
 */
export type KeepSize = 'small' | 'medium' | 'original';
export const KEEP_SIZES: readonly KeepSize[] = ['small', 'medium', 'original'];

/** Longest side in pixels (A4 at 150 dpi, and at about 100 dpi) and JPEG quality. `null` = as it is. */
export const SIZE_SETTINGS: Record<KeepSize, { longSide: number; quality: number } | null> = {
  small: { longSide: 1240, quality: 0.5 },
  medium: { longSide: 1754, quality: 0.75 },
  original: null,
};

/** A file size in the reader's own units and separators. */
export function sizeText(bytes: number, locale: string): string {
  const mb = bytes >= 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: mb ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: mb ? 1 : 0,
  }).format(mb ? bytes / 1_000_000 : Math.max(1, bytes / 1000));
}

/** One photograph written again for a size. Never larger than what it started as. */
export async function recompressPhoto(file: File, size: KeepSize): Promise<File> {
  const settings = SIZE_SETTINGS[size];
  if (!settings) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const k = Math.min(1, settings.longSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, 'image/jpeg', settings.quality),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/**
 * The files for a size, in the same order, plus what the PDF will weigh, roughly: the arranged PDF
 * is its pages' images and pages side by side, so the sum of the files is close to it.
 */
export async function filesForSize(
  files: readonly File[],
  isPhoto: (file: File) => boolean,
  size: KeepSize,
): Promise<{ files: File[]; bytes: number }> {
  const made = await Promise.all(
    files.map((file) => (isPhoto(file) ? recompressPhoto(file, size) : file)),
  );
  return { files: made, bytes: made.reduce((sum, file) => sum + file.size, 0) };
}

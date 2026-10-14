/**
 * The photograph a filtered page came from, so "Original" can put it back. Keyed by the filtered
 * file itself: when the page or the file goes, so does the entry.
 */
const sources = new WeakMap<File, File>();

export const originalOf = (file: File): File => sources.get(file) ?? file;
export const remember = (filtered: File, original: File) => void sources.set(filtered, original);

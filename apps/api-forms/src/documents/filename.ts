/**
 * Filenames for documents people download, and the header that carries them.
 *
 * A form is titled by a person, in their language — "Vårmötet 2026", "Заявка", "申込書" — and the
 * file somebody saves should be called what the form is called. Two things stand in the way:
 *
 * - **The header.** `Content-Disposition: attachment; filename="…"` is Latin-1 by definition, and
 *   a quote or a newline in a title would end the value or the header. RFC 6266 answers with a
 *   second parameter, `filename*=UTF-8''…`, percent-encoded, which every current browser prefers;
 *   the plain `filename` stays as an ASCII fallback for anything that does not.
 * - **The filesystem.** Windows refuses `\ / : * ? " < > |` and names that end in a dot or a
 *   space; every system refuses control characters. A title is free text, so it is cleaned rather
 *   than trusted, and it can never contribute a path separator.
 */

/** Characters no mainstream filesystem accepts in a name, plus the ASCII control range. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/** Long enough for a real title, short enough that a reference after it is never cut off. */
const MAX_STEM = 80;

/**
 * A title made safe to be the start of a filename. Letters in any script survive; separators,
 * reserved characters and runs of whitespace become single hyphens. Empty when nothing survives.
 */
export function filenameStem(title: string): string {
  const cleaned = title
    .normalize('NFC')
    .replace(UNSAFE, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return [...cleaned]
    .slice(0, MAX_STEM)
    .join('')
    .replace(/[-.]+$/, '');
}

/** `<title>-<reference>.pdf`, or `<reference>.pdf` when the title leaves nothing usable. */
export function documentFilename(title: string, reference: string, suffix = ''): string {
  const stem = filenameStem(title);
  const ref = filenameStem(reference) || 'document';
  return `${stem ? `${stem}-` : ''}${ref}${suffix}.pdf`;
}

/**
 * The ASCII fallback: accents folded (å → a), anything else outside printable ASCII dropped.
 * A title entirely in another script falls back to the reference alone, which still names the file.
 */
export function asciiFilename(filename: string): string {
  const folded = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/^-+/, '');
  return folded.replace(/^\.pdf$/, 'document.pdf') || 'document.pdf';
}

/** `attachment; filename="…"; filename*=UTF-8''…` — both forms, so every client gets a name. */
export function contentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  // encodeURIComponent leaves ' ( ) * ! unescaped; RFC 5987 does not allow the first four.
  const encoded = encodeURIComponent(filename).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encoded}`;
}

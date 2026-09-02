import { MAX_UPLOAD_BYTES, type FileAccept, type UploadExtension } from '@tp/shared/forms';

/**
 * What a respondent may attach, decided by looking at the bytes.
 *
 * The same reasoning as `image.ts`, which this deliberately does not extend: the declared content
 * type and the filename are both written by whoever is uploading, so neither is evidence. A file
 * called `cv.pdf`, announced as `application/pdf`, containing HTML, is a stored cross-site
 * scripting attack the moment it is served back from the app's own origin.
 *
 * Images and PDFs only. **SVG is refused** for the reason `image.ts` gives — it is a document that
 * can carry script — and so is everything else, including archives and Office files, because
 * accepting a format means being able to serve it safely and that is a decision per format rather
 * than a default.
 */
const CONTENT_TYPES: Record<UploadExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

export type AttachmentRejection =
  | { ok: false; code: 'empty' }
  | { ok: false; code: 'too-large' }
  | { ok: false; code: 'svg-not-supported' }
  | { ok: false; code: 'unsupported-format' }
  | { ok: false; code: 'not-accepted-here' };

export type AttachmentCheck =
  { ok: true; extension: UploadExtension; contentType: string } | AttachmentRejection;

export function checkAttachment(
  bytes: Buffer,
  accept: FileAccept,
  maxBytes = MAX_UPLOAD_BYTES,
): AttachmentCheck {
  if (bytes.byteLength === 0) return { ok: false, code: 'empty' };
  if (bytes.byteLength > maxBytes) return { ok: false, code: 'too-large' };

  const extension = sniff(bytes);
  if (!extension) {
    return looksLikeSvg(bytes)
      ? { ok: false, code: 'svg-not-supported' }
      : { ok: false, code: 'unsupported-format' };
  }

  // Recognised, but not what this particular question asked for.
  const allowed =
    accept === 'pdf' ? extension === 'pdf' : accept === 'image' ? extension !== 'pdf' : true;
  if (!allowed) return { ok: false, code: 'not-accepted-here' };

  return { ok: true, extension, contentType: CONTENT_TYPES[extension] };
}

export function contentTypeFor(extension: UploadExtension): string {
  return CONTENT_TYPES[extension];
}

/** Magic bytes. Deliberately narrow: an unrecognised file is refused, never guessed at. */
function sniff(bytes: Buffer): UploadExtension | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'pdf';

  return null;
}

/** Named separately so the refusal can say why, rather than reading as a broken upload. */
function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 256)).trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

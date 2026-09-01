/**
 * What may be uploaded, decided by looking at the bytes.
 *
 * The declared content type and the filename are both written by whoever is uploading, so neither
 * is evidence of anything. A file called `logo.png`, announced as `image/png`, containing HTML, is
 * a stored cross-site scripting attack the moment it is served back from the same origin as the
 * app. So the format is read out of the first few bytes, and the type the file is *served* with
 * comes from that reading rather than from anything the uploader said.
 */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

const CONTENT_TYPES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const EXTENSIONS: Record<ImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
};

export function contentTypeOf(format: ImageFormat): string {
  return CONTENT_TYPES[format];
}

export function extensionOf(format: ImageFormat): string {
  return EXTENSIONS[format];
}

export type ImageRejection =
  | { ok: false; code: 'empty'; message: string }
  | { ok: false; code: 'too-large'; message: string }
  | { ok: false; code: 'svg-not-supported'; message: string }
  | { ok: false; code: 'unsupported-format'; message: string };

export type ImageCheck = { ok: true; format: ImageFormat } | ImageRejection;

/**
 * Identify an uploaded image, or say why it is refused.
 *
 * **SVG is refused deliberately, and separately**, so the message can say why rather than leaving
 * somebody to conclude the upload is broken. An SVG is a document: it can carry `<script>`, event
 * handlers and external references, and serving one from this origin hands the uploader script
 * execution against every visitor. Sanitising SVG properly is a project in itself. A logo can be a
 * PNG.
 */
export function checkImage(bytes: Buffer): ImageCheck {
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'empty', message: 'The file is empty' };
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `Images must be ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`,
    };
  }

  const format = sniff(bytes);
  if (format) return { ok: true, format };

  if (looksLikeSvg(bytes)) {
    return {
      ok: false,
      code: 'svg-not-supported',
      message: 'SVG is not supported. Upload a PNG, JPEG, WebP or GIF instead.',
    };
  }

  return {
    ok: false,
    code: 'unsupported-format',
    message: 'That is not a PNG, JPEG, WebP or GIF',
  };
}

/** Magic numbers, from the file format specifications. */
function sniff(bytes: Buffer): ImageFormat | null {
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';

  // Every JPEG variant starts SOI + the first marker.
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // RIFF container with a WEBP fourcc at offset 8.
  if (
    bytes.byteLength >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  if (bytes.byteLength >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  }

  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** U+FEFF, written as an escape: an editor shows the literal character as nothing at all. */
const BYTE_ORDER_MARK = /^\uFEFF/;

/**
 * Recognised only to give a better message, never to accept it.
 *
 * SVG has no magic number — it is XML — so this looks for the shape rather than a signature, and
 * skips a byte-order mark and leading whitespace because a real file from a design tool has both.
 */
function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes
    .subarray(0, 1024)
    .toString('utf8')
    .replace(BYTE_ORDER_MARK, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doctype svg');
}

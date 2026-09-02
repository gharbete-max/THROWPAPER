import { z } from 'zod';

/**
 * Files attached by the person filling in a form.
 *
 * ## Why these are not the same as an author's uploads
 *
 * `packages/shared/src/assets.ts` describes images an *author* uploads — logos, pictures on a
 * question. Those are painted onto a public page, so they are served publicly and cached forever,
 * and that is right.
 *
 * A respondent's attachment is the opposite. A CV, a photograph of a damaged parcel, a scanned
 * receipt: personal data belonging to whoever sent it. It is stored privately and read back only
 * by somebody signed in to the organisation that asked for it — never from a public URL, however
 * unguessable. `apps/api-forms/src/documents/store.ts` already states the principle for bulk
 * exports: "an unguessable URL is not access control on its own."
 *
 * The key is still the SHA-256 of the content plus an extension, for the same reason the public
 * store uses one: a key in that shape cannot encode a path, a host, or anything else the uploader
 * chose, so no filename ever reaches a filesystem.
 */

/** What a respondent may attach. Everything else is refused by looking at the bytes. */
export const UPLOAD_EXTENSIONS = ['png', 'jpg', 'webp', 'gif', 'pdf'] as const;
export type UploadExtension = (typeof UPLOAD_EXTENSIONS)[number];

export const UploadKey = z
  .string()
  .regex(
    new RegExp(`^[0-9a-f]{64}\\.(${UPLOAD_EXTENSIONS.join('|')})$`),
    'Not an upload this form produced',
  );
export type UploadKey = z.infer<typeof UploadKey>;

export function isUploadKey(value: unknown): value is string {
  return typeof value === 'string' && UploadKey.safeParse(value).success;
}

/**
 * What a `file` field will take.
 *
 * Named groups rather than a free list of MIME types: a form author knows whether they are asking
 * for a photograph or a document, and does not know that a `.jpeg` from an iPhone announces itself
 * as `image/jpeg` while the same photo from a scanner might not. The bytes decide either way.
 */
export const FILE_ACCEPTS = ['image', 'pdf', 'both'] as const;
export const FileAccept = z.enum(FILE_ACCEPTS);
export type FileAccept = z.infer<typeof FileAccept>;

/** Ten megabytes. Large enough for a scanned document, small enough to refuse a video. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The extensions a given `accept` allows, for the browser's file picker and for the check. */
export function extensionsFor(accept: FileAccept): UploadExtension[] {
  if (accept === 'pdf') return ['pdf'];
  const images: UploadExtension[] = ['png', 'jpg', 'webp', 'gif'];
  return accept === 'image' ? images : [...images, 'pdf'];
}

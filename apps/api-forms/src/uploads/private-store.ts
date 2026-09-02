import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { isUploadKey, type UploadExtension } from '@tp/shared/forms';

/**
 * Files a respondent attached — private, and a different store from the public one on purpose.
 *
 * `uploads/store.ts` holds an author's images: logos and pictures painted onto a public form, so
 * they are served to anybody, cached forever, and that is correct for what they are.
 *
 * This holds a CV, a photograph of a damaged parcel, a scanned receipt. Personal data belonging to
 * whoever sent it. Nothing here is ever served from a public route — reading a file goes through
 * an authenticated endpoint that checks the organisation owns the submission it belongs to. Not a
 * signed URL: a signed URL is a bearer token in a link, and a link gets forwarded.
 *
 * The key is still `<sha256>.<ext>`, for the reason the public store gives: a key in that shape
 * cannot encode a path, a host or anything else the uploader chose, so an attacker-supplied
 * filename can never reach the filesystem. `isUploadKey` is checked before any path is built.
 */
export interface StoredUpload {
  key: string;
  bytes: number;
  /** True when these exact bytes were already here — two people attaching the same PDF. */
  deduplicated: boolean;
}

export interface PrivateUploadStore {
  put(content: Buffer, extension: UploadExtension): Promise<StoredUpload>;
  get(key: string): Promise<Buffer | null>;
}

export function createLocalUploadStore(directory: string): PrivateUploadStore {
  const root = resolve(directory);

  return {
    async put(content, extension) {
      const key = `${createHash('sha256').update(content).digest('hex')}.${extension}`;
      const target = join(root, key);
      await mkdir(dirname(target), { recursive: true });

      // Content-addressed, so writing the same bytes again is writing the same bytes again.
      let deduplicated = true;
      try {
        await readFile(target);
      } catch {
        deduplicated = false;
        await writeFile(target, content);
      }

      return { key, bytes: content.byteLength, deduplicated };
    },

    async get(key) {
      // The shape check is the guarantee; the path check below is belt and braces.
      if (!isUploadKey(key)) return null;
      const target = resolve(join(root, key));
      if (target !== root && !target.startsWith(root + sep)) return null;
      try {
        return await readFile(target);
      } catch {
        return null;
      }
    },
  };
}

/** Used by the tests, and by demo mode, where nothing should touch a disk. */
export function createMemoryUploadStore(): PrivateUploadStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(content, extension) {
      const key = `${createHash('sha256').update(content).digest('hex')}.${extension}`;
      const deduplicated = files.has(key);
      if (!deduplicated) files.set(key, content);
      return { key, bytes: content.byteLength, deduplicated };
    },
    async get(key) {
      if (!isUploadKey(key)) return null;
      return files.get(key) ?? null;
    },
  };
}

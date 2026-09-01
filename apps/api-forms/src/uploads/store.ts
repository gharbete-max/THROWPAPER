import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { contentTypeOf, extensionOf, type ImageFormat } from './image.js';

/**
 * Uploaded images: logos, and later the illustrations a form author puts on a question.
 *
 * Deliberately **not** the same store as generated documents. A bulk export of 200 registrations
 * is personal data and gets a signed URL that expires; a logo is painted on a public form that
 * anybody can open, so an expiring URL would be wrong in every way — it would break the page for
 * visitors and would not be protecting anything.
 *
 * So these are content-addressed: the key is the SHA-256 of the bytes. That buys three things at
 * once. The URL never changes, so it can be cached forever. Uploading the same logo twice costs
 * one copy. And the key cannot encode anything the uploader chose, so a filename can never reach
 * a path.
 */
export interface StoredAsset {
  /** `<sha256>.<ext>` — the whole key, safe to put in a URL as-is. */
  key: string;
  contentType: string;
  bytes: number;
  /** True when these exact bytes were already stored. */
  deduplicated: boolean;
}

export interface AssetStore {
  put(content: Buffer, format: ImageFormat): Promise<StoredAsset>;
  get(key: string): Promise<{ content: Buffer; contentType: string } | null>;
}

/**
 * A key this store could have produced.
 *
 * Checked before the key ever reaches the filesystem: `key` arrives from a URL, and the only
 * shape that is ever valid is 64 hex characters and a known extension. Nothing else is looked up,
 * which is a stronger guarantee than resolving a path and hoping it stayed inside the root.
 */
const KEY_PATTERN = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function isAssetKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function createLocalAssetStore(options: { directory: string }): AssetStore {
  const root = resolve(options.directory);

  return {
    async put(content, format) {
      const digest = createHash('sha256').update(content).digest('hex');
      const key = `${digest}.${extensionOf(format)}`;
      const target = join(root, key);

      let deduplicated = true;
      try {
        await readFile(target);
      } catch {
        deduplicated = false;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }

      return {
        key,
        contentType: contentTypeOf(format),
        bytes: content.byteLength,
        deduplicated,
      };
    },

    async get(key) {
      if (!isAssetKey(key)) return null;

      const extension = key.slice(key.lastIndexOf('.') + 1);
      const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
      if (!contentType) return null;

      try {
        return { content: await readFile(join(root, key)), contentType };
      } catch {
        return null;
      }
    },
  };
}

/** The in-memory equivalent, for tests and for demo mode. */
export function createMemoryAssetStore(): AssetStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();

  return {
    files,

    async put(content, format) {
      const digest = createHash('sha256').update(content).digest('hex');
      const key = `${digest}.${extensionOf(format)}`;
      const deduplicated = files.has(key);
      if (!deduplicated) files.set(key, Buffer.from(content));

      return { key, contentType: contentTypeOf(format), bytes: content.byteLength, deduplicated };
    },

    async get(key) {
      if (!isAssetKey(key)) return null;
      const content = files.get(key);
      if (!content) return null;

      const extension = key.slice(key.lastIndexOf('.') + 1);
      const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
      return contentType ? { content, contentType } : null;
    },
  };
}

/** The public path an asset is served from. Referenced from brand kits and form definitions. */
export function assetPath(key: string): string {
  return `/public/assets/${key}`;
}

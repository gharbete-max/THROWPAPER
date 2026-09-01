import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Where generated documents live.
 *
 * `SPEC-forms.md` §7 wants S3-compatible storage with signed URLs and virus scanning. No object
 * store has been chosen yet, so v0.1 writes to a local directory behind this interface — the S3
 * implementation is the obvious next one and nothing above this line has to change for it.
 *
 * The signature on a download is not decoration: a bulk export of 200 registrations is personal
 * data, and an unguessable-but-permanent URL is not access control.
 */
export interface StoredDocument {
  key: string;
  bytes: number;
}

export interface DocumentStore {
  put(name: string, content: Buffer): Promise<StoredDocument>;
  get(key: string): Promise<Buffer | null>;
  /** A URL path with an expiry and a signature over both. */
  signedPath(key: string, expiresInSeconds?: number): string;
  verifySignedPath(key: string, expires: string, signature: string): boolean;
}

const DEFAULT_TTL_SECONDS = 60 * 60;

export function createLocalDocumentStore(options: {
  directory: string;
  signingSecret: string;
}): DocumentStore {
  const root = resolve(options.directory);

  function sign(key: string, expires: string): string {
    return createHmac('sha256', options.signingSecret).update(`${key}:${expires}`).digest('hex');
  }

  return {
    async put(name, content) {
      // A generated id in the path, so one export cannot be reached by guessing another's name.
      const key = `${randomUUID()}/${name}`;
      const target = join(root, key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      return { key, bytes: content.byteLength };
    },

    async get(key) {
      const target = resolve(join(root, key));
      // Refuse anything that escapes the root: `key` reaches here from a URL.
      if (!target.startsWith(root)) return null;
      try {
        return await readFile(target);
      } catch {
        return null;
      }
    },

    signedPath(key, expiresInSeconds = DEFAULT_TTL_SECONDS) {
      const expires = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
      const search = new URLSearchParams({ key, expires, signature: sign(key, expires) });
      return `/v1/documents/download?${search.toString()}`;
    },

    verifySignedPath(key, expires, signature) {
      if (!/^\d+$/.test(expires) || Number(expires) * 1000 < Date.now()) return false;
      const expected = Buffer.from(sign(key, expires));
      const provided = Buffer.from(signature);
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    },
  };
}

/** Used by the tests: same contract, nothing touches a disk. */
export function createMemoryDocumentStore(signingSecret = 'test-document-secret'): DocumentStore & {
  files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();
  const store = createLocalDocumentStore({ directory: '.', signingSecret });

  return {
    files,
    async put(name, content) {
      const key = `${randomUUID()}/${name}`;
      files.set(key, content);
      return { key, bytes: content.byteLength };
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    signedPath: store.signedPath,
    verifySignedPath: store.verifySignedPath,
  };
}

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalUploadStore } from './private-store.js';
import { createLocalAssetStore } from './store.js';

/**
 * The stores are content-addressed: the file's name is the hash of its bytes, and "already
 * there" means "already right". That only holds if a file under a name is never half a file.
 */
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loppa-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const content = Buffer.from('%PDF-1.4 '.repeat(5000));
const keyOf = (extension: string) =>
  `${createHash('sha256').update(content).digest('hex')}.${extension}`;

describe('the private upload store', () => {
  it('writes over a file a crash left half written, instead of trusting its name', async () => {
    const store = createLocalUploadStore(directory);
    await writeFile(join(directory, keyOf('pdf')), content.subarray(0, 100));

    const stored = await store.put(content, 'pdf');

    expect(stored.deduplicated).toBe(false);
    expect((await store.get(stored.key))?.equals(content)).toBe(true);
  });

  it('keeps one intact file when the same bytes arrive together, and leaves nothing else', async () => {
    const store = createLocalUploadStore(directory);

    const results = await Promise.all(Array.from({ length: 12 }, () => store.put(content, 'pdf')));

    expect(new Set(results.map((r) => r.key)).size).toBe(1);
    expect(await readdir(directory)).toEqual([keyOf('pdf')]);
    expect((await readFile(join(directory, keyOf('pdf')))).equals(content)).toBe(true);
  });

  it('still says "deduplicated" for bytes that really are there', async () => {
    const store = createLocalUploadStore(directory);
    await store.put(content, 'pdf');
    expect((await store.put(content, 'pdf')).deduplicated).toBe(true);
  });
});

describe('the public asset store', () => {
  it('heals a truncated file and writes atomically', async () => {
    const store = createLocalAssetStore({ directory });
    await writeFile(join(directory, keyOf('png')), content.subarray(0, 10));

    const stored = await store.put(content, 'png');

    expect(stored.deduplicated).toBe(false);
    expect((await store.get(stored.key))?.content.equals(content)).toBe(true);

    await Promise.all(Array.from({ length: 12 }, () => store.put(content, 'png')));
    expect(await readdir(directory)).toEqual([keyOf('png')]);
  });
});

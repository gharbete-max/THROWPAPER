import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultCache } from './cache.js';

let dir = '';
let file = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-cache-'));
  file = join(dir, 'ai-cache', 'index.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A value whose cost in the cache is about `n` bytes. */
const sized = (n: number) => 'x'.repeat(n);

describe('the result cache', () => {
  it('returns what was stored, under the key from cacheKey(), and survives a restart', async () => {
    const key = cacheKey({
      fileSha256: 'a'.repeat(64),
      page: 1,
      pipelineVersion: 1,
      modelId: 'm',
      settings: {},
    });
    const cache = new ResultCache(file);
    expect(await cache.get(key)).toBeUndefined();
    await cache.set(key, { blocks: ['a'] });
    expect(await cache.get(key)).toEqual({ blocks: ['a'] });
    expect(await new ResultCache(file).get(key)).toEqual({ blocks: ['a'] });
  });

  it('drops the least recently used entry first when over its size', async () => {
    const cache = new ResultCache(file, 350);
    await cache.set('a', sized(100));
    await cache.set('b', sized(100));
    await cache.set('c', sized(100));
    // Reading `a` makes `b` the oldest.
    await cache.get('a');
    await cache.set('d', sized(100));
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBeDefined();
    expect(await cache.get('c')).toBeDefined();
    expect(await cache.get('d')).toBeDefined();
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(350);
  });

  it('keeps the order of use across a restart', async () => {
    const first = new ResultCache(file, 350);
    await first.set('a', sized(100));
    await first.set('b', sized(100));
    await first.set('c', sized(100));
    await first.get('a');
    await first.set('a', sized(100)); // saves the new order
    const second = new ResultCache(file, 350);
    await second.set('d', sized(100));
    expect(await second.get('b')).toBeUndefined();
    expect(await second.get('a')).toBeDefined();
  });

  it('replacing a key counts its size once', async () => {
    const cache = new ResultCache(file, 1000);
    await cache.set('a', sized(300));
    await cache.set('a', sized(300));
    expect((await cache.stats()).entries).toBe(1);
    expect((await cache.stats()).bytes).toBeLessThan(400);
  });

  it('does not keep a value larger than the whole cache, and does not evict others for it', async () => {
    const cache = new ResultCache(file, 200);
    await cache.set('small', sized(50));
    await cache.set('huge', sized(500));
    expect(await cache.get('huge')).toBeUndefined();
    expect(await cache.get('small')).toBeDefined();
  });

  it('is cleared on request, and the file goes', async () => {
    const cache = new ResultCache(file);
    await cache.set('a', 1);
    await cache.clear();
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(await readdir(join(dir, 'ai-cache'))).toEqual([]);
  });

  it('treats a file that is not its own as empty, rather than failing', async () => {
    await writeFile(join(dir, 'x.json'), 'not json');
    const cache = new ResultCache(join(dir, 'x.json'));
    expect(await cache.get('a')).toBeUndefined();
    await cache.set('a', 1);
    expect(JSON.parse(await readFile(join(dir, 'x.json'), 'utf8')).version).toBe(1);
  });
});

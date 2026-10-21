import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultCache } from './cache.js';
import { renameRetry } from './download.js';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-robust-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const busy = (code: string) => Object.assign(new Error(code), { code });

describe('renaming a finished download', () => {
  it('tries again while a scanner holds the file, then succeeds', async () => {
    let calls = 0;
    await renameRetry('a', 'b', {
      delayMs: 1,
      rename: () => {
        calls += 1;
        return calls < 4 ? Promise.reject(busy('EPERM')) : Promise.resolve();
      },
    });
    expect(calls).toBe(4);
  });

  it('gives the real error after the last try, and never retries an error that is not a lock', async () => {
    let calls = 0;
    await expect(
      renameRetry('a', 'b', {
        attempts: 3,
        delayMs: 1,
        rename: () => {
          calls += 1;
          return Promise.reject(busy('EBUSY'));
        },
      }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      renameRetry('a', 'b', {
        delayMs: 1,
        rename: () => {
          calls += 1;
          return Promise.reject(busy('ENOENT'));
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls).toBe(1);
  });

  it('moves a real file', async () => {
    await writeFile(join(dir, 'x.partial'), 'bytes');
    await renameRetry(join(dir, 'x.partial'), join(dir, 'x'));
    expect(await readFile(join(dir, 'x'), 'utf8')).toBe('bytes');
  });
});

describe('the result cache under load', () => {
  it('keeps every entry when several are written at once, and survives a restart', async () => {
    const file = join(dir, 'cache', 'index.json');
    const cache = new ResultCache(file);
    await Promise.all(Array.from({ length: 25 }, (_, i) => cache.set(`k${i}`, { page: i })));
    expect((await cache.stats()).entries).toBe(25);
    const reopened = new ResultCache(file);
    expect(await reopened.get('k24')).toEqual({ page: 24 });
    expect((await reopened.stats()).entries).toBe(25);
  });

  it('a cache that cannot be written is still a working cache, and never fails the task that fed it', async () => {
    // The cache's folder is a file: every write fails, as a locked file does.
    await writeFile(join(dir, 'blocked'), 'x');
    const cache = new ResultCache(join(dir, 'blocked', 'index.json'));
    await expect(cache.set('k', { a: 1 })).resolves.toBeUndefined();
    expect(await cache.get('k')).toEqual({ a: 1 });
  });

  it('clearing is not undone by a write that was waiting', async () => {
    const file = join(dir, 'index.json');
    const cache = new ResultCache(file);
    const pending = cache.set('k', { a: 1 });
    await cache.clear();
    await pending;
    expect(await new ResultCache(file).get('k')).toBeUndefined();
  });
});

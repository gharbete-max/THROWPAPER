import { describe, expect, it } from 'vitest';
import { closeAll, createLock } from './lifecycle.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('the life-cycle lock', () => {
  it('runs operations one at a time, in the order they were asked', async () => {
    const exclusive = createLock();
    const log: string[] = [];
    const op = (name: string, ms: number) =>
      exclusive(async () => {
        log.push(`${name} start`);
        await sleep(ms);
        log.push(`${name} end`);
        return name;
      });
    const results = await Promise.all([op('backup', 60), op('restart', 5), op('settings', 5)]);
    expect(results).toEqual(['backup', 'restart', 'settings']);
    expect(log).toEqual([
      'backup start',
      'backup end',
      'restart start',
      'restart end',
      'settings start',
      'settings end',
    ]);
  });

  it('goes on after an operation fails, and hands the failure to its own caller only', async () => {
    const exclusive = createLock();
    const failing = exclusive(() => Promise.reject(new Error('disk full')));
    const next = exclusive(() => Promise.resolve('fine'));
    await expect(failing).rejects.toThrow('disk full');
    await expect(next).resolves.toBe('fine');
  });
});

describe('closing on quit', () => {
  it('waits for every close, and one that fails does not stop the others', async () => {
    const closed: string[] = [];
    const result = await closeAll(
      [
        async () => {
          await sleep(20);
          closed.push('forms');
        },
        () => Promise.reject(new Error('sign refused')),
        () => undefined,
        () => {
          throw new Error('sync');
        },
        async () => void closed.push('model'),
      ],
      1000,
    );
    expect(result).toBe('closed');
    expect(closed.sort()).toEqual(['forms', 'model']);
  });

  it('gives up on a close that never ends, so the process can leave', async () => {
    const started = Date.now();
    const result = await closeAll([() => new Promise(() => undefined)], 80);
    expect(result).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

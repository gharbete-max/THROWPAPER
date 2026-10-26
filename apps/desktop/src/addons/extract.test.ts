import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  ExtractError,
  extractArchive,
  extractTarGz,
  extractZip,
  safeEntryName,
  type ExtractFailure,
} from './extract.js';
import { makeTarGz, makeZip, type TarEntry, type ZipEntry } from './test-support/archives.js';

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'loppa-extract-'));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function names(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await names(path, base)));
    else
      out.push(
        path
          .slice(base.length + 1)
          .split('\\')
          .join('/'),
      );
  }
  return out.sort();
}

async function failure(run: Promise<unknown>): Promise<ExtractFailure | 'other'> {
  try {
    await run;
  } catch (error) {
    return error instanceof ExtractError ? error.failure : 'other';
  }
  return 'other';
}

async function tarOf(entries: TarEntry[], limits = DEFAULT_LIMITS) {
  const archive = join(work, 'a.tar.gz');
  await writeFile(archive, makeTarGz(entries));
  const out = join(work, 'out');
  return { run: () => extractTarGz(archive, out, limits), out, archive };
}

async function zipOf(entries: ZipEntry[], limits = DEFAULT_LIMITS) {
  const archive = join(work, 'a.zip');
  await writeFile(archive, makeZip(entries));
  const out = join(work, 'out');
  return { run: () => extractZip(archive, out, limits), out, archive };
}

describe('safeEntryName', () => {
  it('accepts plain relative names and drops a leading ./ and a trailing /', () => {
    expect(safeEntryName('llama-b1/llama-server')).toEqual(['llama-b1', 'llama-server']);
    expect(safeEntryName('./a/b.dll')).toEqual(['a', 'b.dll']);
    expect(safeEntryName('dir/')).toEqual(['dir']);
  });

  it.each([
    '../evil',
    'a/../../evil',
    'a/..',
    '/etc/passwd',
    'C:/Windows/evil.dll',
    'c:evil',
    'a\\..\\evil',
    '..\\evil',
    'a//b',
    'file.txt:stream',
    'NUL',
    'com1.txt',
    'trailing.',
    'a/./b',
    'x\0y',
    '',
    '.',
    'bad|name',
  ])('refuses %j', (name) => {
    expect(() => safeEntryName(name)).toThrow(ExtractError);
  });
});

describe('a tar.gz', () => {
  it('unpacks files, folders and the executable bit', async () => {
    const { run, out } = await tarOf([
      { name: 'llama-b1/', type: '5', mode: 0o755 },
      { name: 'llama-b1/llama-server', data: 'program', mode: 0o755 },
      { name: 'llama-b1/LICENSE', data: 'mit' },
    ]);
    await run();
    expect(await names(out)).toEqual(['llama-b1/LICENSE', 'llama-b1/llama-server']);
    expect(await readFile(join(out, 'llama-b1/llama-server'), 'utf8')).toBe('program');
    if (process.platform !== 'win32') {
      expect((await stat(join(out, 'llama-b1/llama-server'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(out, 'llama-b1/LICENSE'))).mode & 0o111).toBe(0);
    }
  });

  it('writes a link to a file beside it as a copy, so no link exists on disk', async () => {
    const { run, out } = await tarOf([
      { name: 'd/libggml.0.27.0.dylib', data: 'the library' },
      { name: 'd/libggml.0.dylib', type: '2', link: 'libggml.0.27.0.dylib' },
      { name: 'd/libggml.dylib', type: '2', link: 'libggml.0.dylib' },
    ]);
    await run();
    expect(await readFile(join(out, 'd/libggml.dylib'), 'utf8')).toBe('the library');
    expect(await readFile(join(out, 'd/libggml.0.dylib'), 'utf8')).toBe('the library');
  });

  it.each<[string, TarEntry[], ExtractFailure]>([
    ['a name with ..', [{ name: '../evil', data: 'x' }], 'path'],
    ['a name that climbs out later', [{ name: 'a/../../evil', data: 'x' }], 'path'],
    ['an absolute name', [{ name: '/tmp/evil', data: 'x' }], 'path'],
    ['a drive letter', [{ name: 'C:/evil.dll', data: 'x' }], 'path'],
    ['a backslash', [{ name: 'a\\..\\evil', data: 'x' }], 'path'],
    [
      'a hard link',
      [
        { name: 'a', data: 'x' },
        { name: 'b', type: '1', link: 'a' },
      ],
      'link',
    ],
    ['a link out of the folder', [{ name: 'l', type: '2', link: '../../etc/passwd' }], 'link'],
    ['an absolute link', [{ name: 'l', type: '2', link: '/etc/passwd' }], 'link'],
    [
      'a link into another folder',
      [
        { name: 'a/b', data: 'x' },
        { name: 'l', type: '2', link: 'a/b' },
      ],
      'link',
    ],
    ['a link to nothing', [{ name: 'l', type: '2', link: 'missing' }], 'link'],
    [
      'a link in a circle',
      [
        { name: 'a', type: '2', link: 'b' },
        { name: 'b', type: '2', link: 'a' },
      ],
      'link',
    ],
    ['a device', [{ name: 'dev', type: '3' }], 'type'],
    [
      'two names that differ in case',
      [
        { name: 'a', data: 'x' },
        { name: 'A', data: 'y' },
      ],
      'duplicate',
    ],
    [
      'a file and a folder of one name',
      [
        { name: 'a', data: 'x' },
        { name: 'a/', type: '5' },
      ],
      'duplicate',
    ],
  ])('refuses %s', async (_label, entries, expected) => {
    const { run } = await tarOf(entries);
    expect(await failure(run())).toBe(expected);
  });

  it('refuses a file over the per-file cap and a total over the total cap', async () => {
    const big = await tarOf([{ name: 'a', data: Buffer.alloc(2000) }], {
      ...DEFAULT_LIMITS,
      maxFileBytes: 1000,
    });
    expect(await failure(big.run())).toBe('size');
    const many = await tarOf(
      [
        { name: 'a', data: Buffer.alloc(800) },
        { name: 'b', data: Buffer.alloc(800) },
      ],
      { ...DEFAULT_LIMITS, maxTotalBytes: 1000 },
    );
    expect(await failure(many.run())).toBe('size');
  });

  it('refuses too many files', async () => {
    const { run } = await tarOf(
      [
        { name: 'a', data: 'x' },
        { name: 'b', data: 'x' },
        { name: 'c', data: 'x' },
      ],
      { ...DEFAULT_LIMITS, maxFiles: 2 },
    );
    expect(await failure(run())).toBe('count');
  });

  it('refuses a bomb: zeros that unpack to far more than the archive weighs', async () => {
    const { run } = await tarOf([{ name: 'zeros', data: Buffer.alloc(8 * 1024 * 1024) }]);
    expect(await failure(run())).toBe('ratio');
  });

  it('refuses an archive that stops in the middle of a file, and a damaged header', async () => {
    const whole = makeTarGz([{ name: 'a', data: Buffer.alloc(4000, 1) }]);
    const cut = join(work, 'cut.tar.gz');
    await writeFile(cut, whole.subarray(0, 40));
    expect(await failure(extractTarGz(cut, join(work, 'o1')))).toBe('other');
    const header = Buffer.from(makeTarGz([{ name: 'a', data: 'x' }]));
    header[header.length - 6]! ^= 0xff; // damage in the compressed bytes
    const bad = join(work, 'bad.tar.gz');
    await writeFile(bad, header);
    expect(await failure(extractTarGz(bad, join(work, 'o2')))).toBe('other');
  });

  it('never writes outside the folder, whatever the names', async () => {
    const { run, out } = await tarOf([
      { name: 'fine', data: 'x' },
      { name: '../escaped.txt', data: 'x' },
    ]);
    await failure(run());
    expect(await readdir(work)).not.toContain('escaped.txt');
    expect(await names(out).catch(() => [])).not.toContain('../escaped.txt');
  });
});

describe('a zip', () => {
  it('unpacks deflated and stored files, empty files and folders', async () => {
    const { run, out } = await zipOf([
      { name: 'bin/' },
      { name: 'bin/llama-server.exe', data: 'program '.repeat(100) },
      { name: 'LICENSE', data: 'mit', stored: true },
      { name: 'empty.txt' },
    ]);
    await run();
    expect(await names(out)).toEqual(['LICENSE', 'bin/llama-server.exe', 'empty.txt']);
    expect(await readFile(join(out, 'bin/llama-server.exe'), 'utf8')).toBe('program '.repeat(100));
    expect(await readFile(join(out, 'empty.txt'), 'utf8')).toBe('');
  });

  it.each<[string, ZipEntry[], ExtractFailure]>([
    ['a name with ..', [{ name: '../evil.dll', data: 'x' }], 'path'],
    ['an absolute name', [{ name: '/evil.dll', data: 'x' }], 'path'],
    ['a drive letter', [{ name: 'C:\\evil.dll', data: 'x' }], 'path'],
    ['a backslash path', [{ name: '..\\evil.dll', data: 'x' }], 'path'],
    ['a symbolic link', [{ name: 'l', data: 'target', mode: 0o120777 }], 'link'],
    ['a device', [{ name: 'dev', mode: 0o060000 }], 'link'],
    [
      'two names that differ in case',
      [
        { name: 'a', data: 'x' },
        { name: 'A', data: 'y' },
      ],
      'duplicate',
    ],
    ['an encrypted entry', [{ name: 'a', data: 'x', flags: 0x801 }], 'format'],
    ['a wrong checksum', [{ name: 'a', data: 'hello', crc: 1 }], 'format'],
  ])('refuses %s', async (_label, entries, expected) => {
    const { run, out } = await zipOf(entries);
    expect(await failure(run())).toBe(expected);
    // Nothing was written before the directory was checked, for the failures found in it.
    if (expected !== 'format') expect(await names(out).catch(() => [])).toEqual([]);
  });

  it('refuses an entry that unpacks to more than its header says (a lying size)', async () => {
    const { run } = await zipOf([{ name: 'a', data: 'x'.repeat(5000), declaredSize: 10 }]);
    expect(await failure(run())).toBe('size');
  });

  it('refuses a bomb by the ratio of the sizes the directory lists', async () => {
    const { run } = await zipOf([{ name: 'zeros', data: Buffer.alloc(8 * 1024 * 1024) }]);
    expect(await failure(run())).toBe('ratio');
  });

  it('refuses a file over the cap, too many files and something that is not a zip', async () => {
    const big = await zipOf([{ name: 'a', data: Buffer.alloc(2000, 7) }], {
      ...DEFAULT_LIMITS,
      maxFileBytes: 1000,
    });
    expect(await failure(big.run())).toBe('size');
    const many = await zipOf(
      [
        { name: 'a', data: 'x' },
        { name: 'b', data: 'y' },
        { name: 'c', data: 'z' },
      ],
      { ...DEFAULT_LIMITS, maxFiles: 2 },
    );
    expect(await failure(many.run())).toBe('count');
    const junk = join(work, 'junk.zip');
    await writeFile(junk, 'not a zip at all');
    expect(await failure(extractZip(junk, join(work, 'o')))).toBe('format');
  });
});

describe('extractArchive', () => {
  it('picks the reader by name and refuses other kinds', async () => {
    const z = await zipOf([{ name: 'a.txt', data: 'zip' }]);
    await extractArchive(z.archive, z.out);
    expect(await readFile(join(z.out, 'a.txt'), 'utf8')).toBe('zip');
    const t = join(work, 'x.tgz');
    await writeFile(t, makeTarGz([{ name: 'b.txt', data: 'tar' }]));
    await extractArchive(t, join(work, 'o2'));
    expect(await readFile(join(work, 'o2', 'b.txt'), 'utf8')).toBe('tar');
    expect(await failure(extractArchive(join(work, 'x.rar'), join(work, 'o3')))).toBe('format');
  });
});

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PACK_FILE,
  PackError,
  installFromFolder,
  joinFile,
  isPlainFileName,
  makePack,
  readPackManifest,
  splitFile,
} from './pack.js';
import { sha256File } from './download.js';

const ls = (dir: string) => readdir(dir).catch(() => [] as string[]);
let root = '';
let pack = '';
let dest = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'loppa-pack-'));
  pack = join(root, 'pack');
  dest = join(root, 'user-data', 'models');
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Two small "model" files; the first is cut in three at 40,000 bytes. */
async function fakeModel() {
  const weights = randomBytes(100_000);
  const projector = randomBytes(30_000);
  await mkdir(join(root, 'src'), { recursive: true });
  const sources = [join(root, 'src', 'fake-weights.gguf'), join(root, 'src', 'fake-mmproj.gguf')];
  await writeFile(sources[0]!, weights);
  await writeFile(sources[1]!, projector);
  const manifest = await makePack('fake', sources, pack, 40_000);
  return { weights, projector, manifest };
}

describe('splitting a pack', () => {
  it('cuts under the limit, hashes parts and whole, and writes PACK.json', async () => {
    const { manifest, weights } = await fakeModel();
    const [w, p] = manifest.files;
    expect(w!.parts.map((x) => x.bytes)).toEqual([40_000, 40_000, 20_000]);
    expect(w!.parts.map((x) => x.name)).toEqual([
      'fake-weights.gguf.part1',
      'fake-weights.gguf.part2',
      'fake-weights.gguf.part3',
    ]);
    expect(w!.sha256).toBe(await sha256File(join(root, 'src', 'fake-weights.gguf')));
    expect(w!.bytes).toBe(weights.length);
    // The small file is one piece under its own name.
    expect(p!.parts).toEqual([{ bytes: 30_000, name: 'fake-mmproj.gguf', sha256: p!.sha256 }]);
    expect(await readPackManifest(pack)).toEqual(manifest);
    expect((await readdir(pack)).sort()).toContain(PACK_FILE);
  });

  it('splitFile alone matches the manifest the pack records', async () => {
    const { manifest } = await fakeModel();
    const again = await splitFile(join(root, 'src', 'fake-weights.gguf'), pack, 40_000);
    expect(again).toEqual(manifest.files[0]);
  });

  it('refuses a PACK.json that is not one', async () => {
    await mkdir(pack, { recursive: true });
    await writeFile(join(pack, PACK_FILE), JSON.stringify({ format: 2 }));
    await expect(readPackManifest(pack)).rejects.toMatchObject({ failure: 'io' });
  });
});

describe('names in a PACK.json', () => {
  it('accepts file names and refuses anything that could leave the folder or name a device', () => {
    for (const ok of ['model.gguf', 'model.gguf.part1', 'mmproj-F16.gguf', 'a_b-c.1']) {
      expect(isPlainFileName(ok), ok).toBe(true);
    }
    for (const bad of [
      '..',
      '.',
      '.hidden',
      'a/b',
      'a\\b',
      '..\\x',
      'C:x',
      'x:stream',
      'model.',
      'NUL',
      'nul.gguf',
      'CON',
      'com1.part1',
      'LPT9',
      '',
      'x'.repeat(201),
      7,
    ]) {
      expect(isPlainFileName(bad), String(bad)).toBe(false);
    }
  });

  it('refuses a PACK.json whose part is named like a device', async () => {
    await mkdir(pack, { recursive: true });
    const h = 'a'.repeat(64);
    await writeFile(
      join(pack, PACK_FILE),
      JSON.stringify({
        format: 1,
        id: 'x',
        files: [
          { name: 'm.gguf', bytes: 1, sha256: h, parts: [{ name: 'NUL', bytes: 1, sha256: h }] },
        ],
      }),
    );
    await expect(readPackManifest(pack)).rejects.toMatchObject({ failure: 'io' });
  });
});

describe('installing from a folder', () => {
  it('joins the parts into the exact original, byte for byte, and leaves the parts alone', async () => {
    const { manifest, weights, projector } = await fakeModel();
    const progress: number[] = [];
    const paths = await installFromFolder(manifest.files, pack, dest, {
      onProgress: (_file, _of, p) => progress.push(p.done),
    });
    expect(paths).toEqual([join(dest, 'fake-weights.gguf'), join(dest, 'fake-mmproj.gguf')]);
    expect(Buffer.compare(await readFile(paths[0]!), weights)).toBe(0);
    expect(Buffer.compare(await readFile(paths[1]!), projector)).toBe(0);
    expect(Math.max(...progress)).toBe(100_000);
    // No temp file stays, and the pack folder is as it was.
    expect((await readdir(dest)).sort()).toEqual(['fake-mmproj.gguf', 'fake-weights.gguf']);
    expect(await readdir(pack)).toHaveLength(5);
  });

  it('refuses a part with a flipped byte, names it, and leaves no file that looks like a model', async () => {
    const { manifest } = await fakeModel();
    const part = join(pack, 'fake-weights.gguf.part2');
    const bytes = await readFile(part);
    bytes[10] = bytes[10]! ^ 0xff;
    await writeFile(part, bytes);
    const failure = await installFromFolder(manifest.files, pack, dest).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PackError);
    expect(failure).toMatchObject({ failure: 'hash' });
    expect((failure as Error).message).toContain('fake-weights.gguf.part2');
    expect(await ls(dest)).toEqual([]);
  });

  it('refuses a part of the wrong size', async () => {
    const { manifest } = await fakeModel();
    await writeFile(join(pack, 'fake-weights.gguf.part3'), randomBytes(5));
    await expect(installFromFolder(manifest.files, pack, dest)).rejects.toMatchObject({
      failure: 'size',
    });
    expect(await ls(dest)).toEqual([]);
  });

  it('a hash in the manifest that the parts do not give is refused even if each part is whole', async () => {
    const { manifest } = await fakeModel();
    const wrong = { ...manifest.files[0]!, sha256: 'f'.repeat(64) };
    await expect(joinFile(wrong, pack, dest)).rejects.toMatchObject({ failure: 'hash' });
    expect(await ls(dest)).toEqual([]);
  });

  it('names a missing part, and installs nothing of that file', async () => {
    const { manifest } = await fakeModel();
    await rm(join(pack, 'fake-weights.gguf.part3'));
    await expect(installFromFolder(manifest.files, pack, dest)).rejects.toMatchObject({
      failure: 'missing',
      message: expect.stringContaining('part3'),
    });
    expect(await ls(dest)).toEqual([]);
  });

  it('skips an optional file that is not in the pack', async () => {
    const { manifest } = await fakeModel();
    await rm(join(pack, 'fake-mmproj.gguf'));
    const files = [manifest.files[0]!, { ...manifest.files[1]!, optional: true }];
    expect(await installFromFolder(files, pack, dest)).toEqual([join(dest, 'fake-weights.gguf')]);
  });

  it('resumes: finished files are kept, the one that stopped is redone, a stale .joining is replaced', async () => {
    const { manifest } = await fakeModel();
    // First attempt: the projector joined, then the weights failed on a missing part.
    await rm(join(pack, 'fake-weights.gguf.part3'));
    await installFromFolder([manifest.files[1]!], pack, dest);
    const before = (await stat(join(dest, 'fake-mmproj.gguf'))).mtimeMs;
    await writeFile(join(dest, 'fake-weights.gguf.joining'), 'left by a crash');
    await expect(installFromFolder(manifest.files, pack, dest)).rejects.toMatchObject({
      failure: 'missing',
    });
    // The part is brought back (the stick was plugged in again); the second attempt finishes.
    await writeFile(
      join(pack, 'fake-weights.gguf.part3'),
      (await readFile(join(root, 'src', 'fake-weights.gguf'))).subarray(80_000),
    );
    const paths = await installFromFolder(manifest.files, pack, dest);
    expect(paths).toHaveLength(2);
    expect((await stat(join(dest, 'fake-mmproj.gguf'))).mtimeMs).toBe(before);
    expect(await sha256File(paths[0]!)).toBe(manifest.files[0]!.sha256);
    expect((await readdir(dest)).sort()).toEqual(['fake-mmproj.gguf', 'fake-weights.gguf']);
  });

  it('an aborted join leaves nothing behind', async () => {
    const { manifest } = await fakeModel();
    const abort = new AbortController();
    const promise = installFromFolder(manifest.files, pack, dest, {
      signal: abort.signal,
      onProgress: () => abort.abort(),
    });
    await expect(promise).rejects.toBeDefined();
    expect(await ls(dest)).toEqual([]);
  });

  it('takes a whole file under its own name when the parts are not there', async () => {
    const { manifest, weights } = await fakeModel();
    await rm(join(pack, 'fake-weights.gguf.part1'));
    await writeFile(join(pack, 'fake-weights.gguf'), weights);
    const paths = await installFromFolder([manifest.files[0]!], pack, dest);
    expect(await sha256File(paths[0]!)).toBe(manifest.files[0]!.sha256);
  });
});

describe("a pack cut in pieces, against the app's own manifest, which lists each file whole", () => {
  /** What the app holds since the model is fetched from Hugging Face: one part, named like the file. */
  const wholeLayout = (manifest: Awaited<ReturnType<typeof fakeModel>>['manifest']) =>
    manifest.files.map((f) => ({
      ...f,
      parts: [{ bytes: f.bytes, name: f.name, sha256: f.sha256 }],
    }));

  it('finds the numbered pieces by their names, joins them, and checks the whole file', async () => {
    const { manifest, weights } = await fakeModel();
    const paths = await installFromFolder(wholeLayout(manifest), pack, dest);
    expect(Buffer.compare(await readFile(paths[0]!), weights)).toBe(0);
    expect((await readdir(dest)).sort()).toEqual(['fake-mmproj.gguf', 'fake-weights.gguf']);
  });

  it.each(['part3', 'part2', 'part1'])(
    'a piece never copied (%s) is a missing piece, not a model',
    async (gone) => {
      const { manifest } = await fakeModel();
      await rm(join(pack, `fake-weights.gguf.${gone}`));
      await expect(installFromFolder(wholeLayout(manifest), pack, dest)).rejects.toMatchObject({
        failure: 'missing',
      });
      expect(await ls(dest)).not.toContain('fake-weights.gguf');
    },
  );

  it('a piece with a flipped byte fails the whole-file hash and leaves nothing', async () => {
    const { manifest } = await fakeModel();
    const part = join(pack, 'fake-weights.gguf.part2');
    const bytes = await readFile(part);
    bytes[7] = bytes[7]! ^ 0xff;
    await writeFile(part, bytes);
    await expect(installFromFolder(wholeLayout(manifest), pack, dest)).rejects.toMatchObject({
      failure: 'hash',
    });
    expect(await ls(dest)).toEqual([]);
  });

  it('a stale extra piece from another cut fails the same way', async () => {
    const { manifest } = await fakeModel();
    await writeFile(join(pack, 'fake-weights.gguf.part4'), 'a leftover from another cut');
    await expect(installFromFolder(wholeLayout(manifest), pack, dest)).rejects.toMatchObject({
      failure: 'hash',
    });
    expect(await ls(dest)).toEqual([]);
  });
});

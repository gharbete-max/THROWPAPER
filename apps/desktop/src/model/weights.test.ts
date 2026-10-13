import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_MANIFEST, WeightsManifest } from '@tp/shared/summary';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadModel, sha256File, verifyFile, type Progress } from './weights.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A model of 2 x 40 KB, with a manifest in the shape of the real one. */
function smallModel() {
  const a = randomBytes(40_000);
  const b = randomBytes(40_000);
  const whole = Buffer.concat([a, b]);
  const manifest = WeightsManifest.parse({
    ...MODEL_MANIFEST,
    bytes: whole.length,
    sha256: sha(whole),
    parts: [
      {
        bytes: a.length,
        name: 'm.gguf.part1',
        sha256: sha(a),
        url: 'https://example.test/m.part1',
      },
      {
        bytes: b.length,
        name: 'm.gguf.part2',
        sha256: sha(b),
        url: 'https://example.test/m.part2',
      },
    ],
  });
  return { manifest, a, b, whole };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-weights-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const serve = (files: Record<string, Uint8Array | number>, asked: string[] = []): typeof fetch =>
  (async (url: string | URL | Request) => {
    const key = String(url);
    asked.push(key);
    const file = files[key];
    if (typeof file === 'number') return new Response('no', { status: file });
    if (!file) return new Response('missing', { status: 404 });
    return new Response(new Blob([file as BlobPart]));
  }) as typeof fetch;

describe('verifying a file against the manifest', () => {
  it('hashes as a stream and says what is wrong', async () => {
    const { whole, manifest } = smallModel();
    const path = join(dir, 'x.gguf');
    await writeFile(path, whole);
    expect(await sha256File(path)).toBe(manifest.sha256);
    expect(await verifyFile(path, manifest)).toBe('ok');
    expect(await verifyFile(join(dir, 'nope'), manifest)).toBe('missing');

    await writeFile(path, whole.subarray(1));
    expect(await verifyFile(path, manifest)).toBe('wrong-size');

    const tampered = Buffer.from(whole);
    tampered[100] = tampered[100]! ^ 1;
    await writeFile(path, tampered);
    expect(await verifyFile(path, manifest)).toBe('wrong-hash');
    // Nothing was deleted by looking.
    expect((await readFile(path)).length).toBe(whole.length);
  });

  it('reports progress while it reads', async () => {
    const { whole, manifest } = smallModel();
    const path = join(dir, 'x.gguf');
    await writeFile(path, whole);
    let last = 0;
    await verifyFile(path, manifest, { onBytes: (n) => (last = n) });
    expect(last).toBe(whole.length);
  });
});

describe('downloading the two parts', () => {
  it('fetches, verifies each part, joins, verifies the whole, and leaves one file', async () => {
    const { manifest, a, b, whole } = smallModel();
    const progress: Progress[] = [];
    const path = await downloadModel({
      manifest,
      dir,
      fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': b }),
      onProgress: (p) => progress.push(p),
    });
    expect(await sha256File(path)).toBe(sha(whole));
    expect(await readdir(dir)).toEqual([`${manifest.id}.gguf`]);
    expect(progress.some((p) => p.phase === 'download' && p.part === 2)).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      phase: 'join',
      done: whole.length,
      total: whole.length,
    });
  });

  it('does not fetch a part it already has, so a failed attempt resumes', async () => {
    const { manifest, a, b } = smallModel();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    const asked: string[] = [];
    await downloadModel({
      manifest,
      dir,
      fetch: serve({ 'https://example.test/m.part2': b }, asked),
    });
    expect(asked).toEqual(['https://example.test/m.part2']);
  });

  it('refuses a part that is not the one in the manifest, and keeps nothing of it', async () => {
    const { manifest, a, b } = smallModel();
    const wrong = Buffer.from(b);
    wrong[5] = wrong[5]! ^ 1;
    await expect(
      downloadModel({
        manifest,
        dir,
        fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': wrong }),
      }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect(await readdir(dir)).toEqual(['m.gguf.part1']);
  });

  it('refuses a part of the wrong size', async () => {
    const { manifest, a, b } = smallModel();
    await expect(
      downloadModel({
        manifest,
        dir,
        fetch: serve({
          'https://example.test/m.part1': a,
          'https://example.test/m.part2': b.subarray(1),
        }),
      }),
    ).rejects.toMatchObject({ failure: 'size' });
  });

  it('refuses a joined file that is not the manifest file, and keeps no joined file', async () => {
    const { manifest, a, b } = smallModel();
    const lying = WeightsManifest.parse({ ...manifest, sha256: '0'.repeat(64) });
    await expect(
      downloadModel({
        manifest: lying,
        dir,
        fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': b }),
      }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect((await readdir(dir)).filter((n) => n.endsWith('.gguf'))).toEqual([]);
  });

  it('reports a server error', async () => {
    const { manifest } = smallModel();
    await expect(
      downloadModel({ manifest, dir, fetch: serve({ 'https://example.test/m.part1': 503 }) }),
    ).rejects.toMatchObject({ failure: 'http' });
  });

  it('is off, with the reason, while the release has no address', async () => {
    const asked: string[] = [];
    await expect(
      downloadModel({ manifest: MODEL_MANIFEST, dir, fetch: serve({}, asked) }),
    ).rejects.toMatchObject({
      failure: 'unpublished',
      message: 'the release has not been cut yet',
    });
    expect(asked).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('stops when cancelled, without a final file', async () => {
    const { manifest, a } = smallModel();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadModel({
        manifest,
        dir,
        signal: controller.signal,
        fetch: ((_url: string, init?: RequestInit) =>
          init?.signal?.aborted
            ? Promise.reject(new DOMException('aborted', 'AbortError'))
            : Promise.resolve(new Response(new Blob([a as BlobPart])))) as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
    expect((await readdir(dir)).filter((n) => n.endsWith('.gguf'))).toEqual([]);
  });
});

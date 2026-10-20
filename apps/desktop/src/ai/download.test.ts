import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelFile, UNPUBLISHED } from '@tp/shared/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile, sha256File, verifyFile, type Progress } from './download.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A file of 2 x 40 KB, in the shape of the real one. */
function smallModel(unpublished = false) {
  const a = randomBytes(40_000);
  const b = randomBytes(40_000);
  const whole = Buffer.concat([a, b]);
  const url = (n: number) =>
    unpublished
      ? `${UNPUBLISHED}the release has not been cut yet`
      : `https://example.test/m.part${n}`;
  const file = ModelFile.parse({
    bytes: whole.length,
    name: 'm.gguf',
    parts: [
      { bytes: a.length, name: 'm.gguf.part1', sha256: sha(a), url: url(1) },
      { bytes: b.length, name: 'm.gguf.part2', sha256: sha(b), url: url(2) },
    ],
    role: 'weights',
    sha256: sha(whole),
  });
  return { file, a, b, whole };
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loppa-download-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A server with `Range` support: 206 with the rest when asked for it. */
const serve = (
  files: Record<string, Uint8Array | number>,
  asked: Array<{ url: string; range: string | null }> = [],
  options: { ignoreRange?: boolean } = {},
): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const key = String(url);
    const range = new Headers(init?.headers).get('Range');
    asked.push({ url: key, range });
    const file = files[key];
    if (typeof file === 'number') return new Response('no', { status: file });
    if (!file) return new Response('missing', { status: 404 });
    const from = range && !options.ignoreRange ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    if (from >= file.length) return new Response('', { status: 416 });
    return new Response(new Blob([file.subarray(from) as BlobPart]), {
      status: from > 0 ? 206 : 200,
    });
  }) as typeof fetch;

describe('verifying a file against the manifest', () => {
  it('hashes as a stream and says what is wrong', async () => {
    const { whole, file } = smallModel();
    const path = join(dir, 'x.gguf');
    await writeFile(path, whole);
    expect(await sha256File(path)).toBe(file.sha256);
    expect(await verifyFile(path, file)).toBe('ok');
    expect(await verifyFile(join(dir, 'nope'), file)).toBe('missing');

    await writeFile(path, whole.subarray(1));
    expect(await verifyFile(path, file)).toBe('wrong-size');

    const tampered = Buffer.from(whole);
    tampered[100] = tampered[100]! ^ 1;
    await writeFile(path, tampered);
    expect(await verifyFile(path, file)).toBe('wrong-hash');
    // Nothing was deleted by looking.
    expect((await readFile(path)).length).toBe(whole.length);
  });

  it('checks only the size where no hash is pinned (an evaluation-only file)', async () => {
    const { whole } = smallModel();
    const path = join(dir, 'x.gguf');
    await writeFile(path, whole);
    expect(await verifyFile(path, { bytes: whole.length })).toBe('ok');
    expect(await verifyFile(path, { bytes: whole.length + 1 })).toBe('wrong-size');
  });

  it('reports progress while it reads', async () => {
    const { whole, file } = smallModel();
    const path = join(dir, 'x.gguf');
    await writeFile(path, whole);
    let last = 0;
    await verifyFile(path, file, { onBytes: (n) => (last = n) });
    expect(last).toBe(whole.length);
  });
});

describe('downloading the parts of a file', () => {
  it('fetches, verifies each part, joins, verifies the whole, and leaves one file', async () => {
    const { file, a, b, whole } = smallModel();
    const progress: Progress[] = [];
    const path = await downloadFile({
      file,
      dir,
      fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': b }),
      onProgress: (p) => progress.push(p),
    });
    expect(path).toBe(join(dir, 'm.gguf'));
    expect(await sha256File(path)).toBe(sha(whole));
    expect(await readdir(dir)).toEqual(['m.gguf']);
    expect(progress.some((p) => p.phase === 'download' && p.part === 2)).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      phase: 'join',
      done: whole.length,
      total: whole.length,
    });
  });

  it('does nothing when the finished file is already there', async () => {
    const { file, whole } = smallModel();
    await writeFile(join(dir, 'm.gguf'), whole);
    const asked: Array<{ url: string; range: string | null }> = [];
    await downloadFile({ file, dir, fetch: serve({}, asked) });
    expect(asked).toEqual([]);
  });

  it('does not fetch a part it already has, so a failed attempt resumes', async () => {
    const { file, a, b } = smallModel();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    const asked: Array<{ url: string; range: string | null }> = [];
    await downloadFile({ file, dir, fetch: serve({ 'https://example.test/m.part2': b }, asked) });
    expect(asked.map((r) => r.url)).toEqual(['https://example.test/m.part2']);
  });

  it('asks for the rest of a part that was cut off, and the result is still the right file', async () => {
    const { file, a, b, whole } = smallModel();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    await writeFile(join(dir, 'm.gguf.part2.partial'), b.subarray(0, 12_345));
    const asked: Array<{ url: string; range: string | null }> = [];
    const path = await downloadFile({
      file,
      dir,
      fetch: serve({ 'https://example.test/m.part2': b }, asked),
    });
    expect(asked).toEqual([{ url: 'https://example.test/m.part2', range: 'bytes=12345-' }]);
    expect(await sha256File(path)).toBe(sha(whole));
    expect(await readdir(dir)).toEqual(['m.gguf']);
  });

  it('starts that part over when the server ignores the range', async () => {
    const { file, a, b, whole } = smallModel();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    await writeFile(join(dir, 'm.gguf.part2.partial'), b.subarray(0, 100));
    const path = await downloadFile({
      file,
      dir,
      fetch: serve({ 'https://example.test/m.part2': b }, [], { ignoreRange: true }),
    });
    expect(await sha256File(path)).toBe(sha(whole));
  });

  it('discards a cut-off part that was wrong to begin with, and says so', async () => {
    const { file, a, b } = smallModel();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    await writeFile(join(dir, 'm.gguf.part2.partial'), randomBytes(500));
    await expect(
      downloadFile({ file, dir, fetch: serve({ 'https://example.test/m.part2': b }) }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect(await readdir(dir)).toEqual(['m.gguf.part1']);
  });

  it('keeps the cut-off part when cancelled, so the next attempt can resume it', async () => {
    const { file, a, b } = smallModel();
    const controller = new AbortController();
    await writeFile(join(dir, 'm.gguf.part1'), a);
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(b.subarray(0, 9_000));
        // Never finishes: the person cancels.
      },
    });
    await expect(
      downloadFile({
        file,
        dir,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'download' && p.part === 2 && p.done > 40_000) controller.abort();
        },
        fetch: (async () => new Response(body)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
    await expect(stat(join(dir, 'm.gguf.part2.partial'))).resolves.toBeDefined();
  });

  it('takes a single part named like the file as the whole file, with nothing to join', async () => {
    const whole = randomBytes(5_000);
    const file = ModelFile.parse({
      bytes: whole.length,
      name: 'one.gguf',
      parts: [
        {
          bytes: whole.length,
          name: 'one.gguf',
          sha256: sha(whole),
          url: 'https://example.test/one',
        },
      ],
      role: 'projector',
      sha256: sha(whole),
    });
    const path = await downloadFile({
      file,
      dir,
      fetch: serve({ 'https://example.test/one': whole }),
    });
    expect(await sha256File(path)).toBe(sha(whole));
    expect(await readdir(dir)).toEqual(['one.gguf']);
  });

  it('refuses a part that is not the one in the manifest, and keeps nothing of it', async () => {
    const { file, a, b } = smallModel();
    const wrong = Buffer.from(b);
    wrong[5] = wrong[5]! ^ 1;
    await expect(
      downloadFile({
        file,
        dir,
        fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': wrong }),
      }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect(await readdir(dir)).toEqual(['m.gguf.part1']);
  });

  it('refuses a part of the wrong size', async () => {
    const { file, a, b } = smallModel();
    await expect(
      downloadFile({
        file,
        dir,
        fetch: serve({
          'https://example.test/m.part1': a,
          'https://example.test/m.part2': b.subarray(1),
        }),
      }),
    ).rejects.toMatchObject({ failure: 'size' });
  });

  it('stops a server that sends more than the manifest lists, and keeps none of it', async () => {
    const { file, a, b } = smallModel();
    const endless = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      }),
    );
    await expect(
      downloadFile({
        file,
        dir,
        fetch: (async (url: string | URL | Request) =>
          String(url).endsWith('part1')
            ? new Response(new Blob([a as BlobPart]))
            : endless) as typeof fetch,
      }),
    ).rejects.toMatchObject({ failure: 'size' });
    expect(await readdir(dir)).toEqual(['m.gguf.part1']);
    void b;
  });

  it('refuses a joined file that is not the manifest file, and keeps no joined file', async () => {
    const { file, a, b } = smallModel();
    const lying = ModelFile.parse({ ...file, sha256: '0'.repeat(64) });
    await expect(
      downloadFile({
        file: lying,
        dir,
        fetch: serve({ 'https://example.test/m.part1': a, 'https://example.test/m.part2': b }),
      }),
    ).rejects.toMatchObject({ failure: 'hash' });
    expect((await readdir(dir)).filter((n) => n.endsWith('.gguf'))).toEqual([]);
  });

  it('reports a server error', async () => {
    const { file } = smallModel();
    await expect(
      downloadFile({ file, dir, fetch: serve({ 'https://example.test/m.part1': 503 }) }),
    ).rejects.toMatchObject({ failure: 'http' });
  });

  it('is off, with the reason, while the release has no address', async () => {
    const asked: Array<{ url: string; range: string | null }> = [];
    await expect(
      downloadFile({ file: smallModel(true).file, dir, fetch: serve({}, asked) }),
    ).rejects.toMatchObject({
      failure: 'unpublished',
      message: 'the release has not been cut yet',
    });
    expect(asked).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('is off for a file Loppa does not publish', async () => {
    const { file } = smallModel();
    await expect(
      downloadFile({ file: { ...file, parts: [] }, dir, fetch: serve({}) }),
    ).rejects.toMatchObject({ failure: 'unpublished' });
  });

  it('stops when cancelled, without a final file', async () => {
    const { file, a } = smallModel();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadFile({
        file,
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

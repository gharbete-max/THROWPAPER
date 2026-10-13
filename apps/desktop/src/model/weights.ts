import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { modelFileName, unpublishedReason, type WeightsManifest } from '@tp/shared/summary';

/**
 * Getting the model file, and knowing it is the right one (ADR 0023 section 3).
 *
 * The file is data with a manifest: its size and SHA-256, and those of the two parts it is
 * published in (a GitHub release asset may not exceed 2 GiB; the model is 2.33). Everything here
 * streams: a 2.5 GB file is never in memory, and a hash is computed as the bytes pass.
 *
 * Nothing here decides *when*. Downloading is the person's request and nothing else starts it;
 * verification is before the first use in a session. A mismatch deletes nothing, and the caller
 * refuses to load the file with the reason.
 */
export type WeightsFailure = 'unpublished' | 'http' | 'size' | 'hash' | 'io';

export class WeightsError extends Error {
  constructor(
    readonly failure: WeightsFailure,
    message: string,
  ) {
    super(message);
    this.name = 'WeightsError';
  }
}

export interface Progress {
  phase: 'download' | 'join' | 'verify';
  /** Bytes of the whole file done in this phase. */
  done: number;
  total: number;
  part?: number;
  parts?: number;
}

export type OnProgress = (progress: Progress) => void;

/** Counts bytes and hashes them as they pass, and reports. */
function measure(hash: ReturnType<typeof createHash>, report: (bytes: number) => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      seen += chunk.length;
      report(seen);
      done(null, chunk);
    },
  });
}

/** The SHA-256 of a file, read as a stream. */
export async function sha256File(
  path: string,
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 }),
    measure(hash, (bytes) => options.onBytes?.(bytes)),
    // A sink that wants everything and keeps nothing.
    new Transform({ transform: (_chunk, _encoding, done) => done() }),
    ...(options.signal ? [{ signal: options.signal }] : []),
  );
  return hash.digest('hex');
}

export type Verdict = 'ok' | 'missing' | 'wrong-size' | 'wrong-hash';

/** Does the file at `path` have exactly this size and hash? */
export async function verifyFile(
  path: string,
  expected: { bytes: number; sha256: string },
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<Verdict> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return 'missing';
  if (info.size !== expected.bytes) return 'wrong-size';
  return (await sha256File(path, options)) === expected.sha256 ? 'ok' : 'wrong-hash';
}

export interface DownloadOptions {
  manifest: WeightsManifest;
  /** The folder the model lives in. */
  dir: string;
  /** Injected so a test needs no network; the app passes the global one. */
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: OnProgress;
}

/**
 * Downloads each part, verifies it, joins them into one file, verifies that against the manifest,
 * and only then puts it under its final name and removes the parts. A part already on disk and
 * correct is not fetched again, so a failed attempt resumes at the part it stopped in.
 * Returns the path of the joined file.
 */
export async function downloadModel(options: DownloadOptions): Promise<string> {
  const { manifest, dir, signal, onProgress } = options;
  const blocked = unpublishedReason(manifest);
  if (blocked !== null) throw new WeightsError('unpublished', blocked);
  for (const part of manifest.parts) {
    if (!part.url.startsWith('https://')) {
      throw new WeightsError('http', `${part.name} is not at an https address`);
    }
  }
  await mkdir(dir, { recursive: true });

  const parts = manifest.parts.length;
  let before = 0;
  for (const [index, part] of manifest.parts.entries()) {
    const target = join(dir, part.name);
    const report = (bytes: number) =>
      onProgress?.({
        phase: 'download',
        done: before + bytes,
        total: manifest.bytes,
        part: index + 1,
        parts,
      });

    if ((await verifyFile(target, part)) !== 'ok') {
      const partial = `${target}.partial`;
      const response = await options.fetch(part.url, {
        redirect: 'follow',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok || !response.body) {
        throw new WeightsError('http', `${part.name}: the server answered ${response.status}`);
      }
      const hash = createHash('sha256');
      let received = 0;
      try {
        await pipeline(
          Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
          measure(hash, (bytes) => {
            received = bytes;
            report(bytes);
          }),
          createWriteStream(partial),
          ...(signal ? [{ signal }] : []),
        );
      } catch (error) {
        // Kept if it was a cancel, so the next attempt could use it; a wrong one is replaced.
        if (signal?.aborted) throw error;
        await rm(partial, { force: true });
        throw new WeightsError('io', error instanceof Error ? error.message : String(error));
      }
      if (received !== part.bytes) {
        await rm(partial, { force: true });
        throw new WeightsError('size', `${part.name} is ${received} bytes, not ${part.bytes}`);
      }
      if (hash.digest('hex') !== part.sha256) {
        await rm(partial, { force: true });
        throw new WeightsError('hash', `${part.name} is not the file in the manifest`);
      }
      await rename(partial, target);
    }
    before += part.bytes;
    report(0);
  }

  return join(dir, await joinParts(manifest, dir, options));
}

/** Concatenates the parts into the model file, hashing as it writes. Returns the file's name. */
async function joinParts(
  manifest: WeightsManifest,
  dir: string,
  options: Pick<DownloadOptions, 'signal' | 'onProgress'>,
): Promise<string> {
  const name = modelFileName(manifest);
  const joining = join(dir, `${name}.joining`);
  const hash = createHash('sha256');
  const output = createWriteStream(joining);
  let before = 0;
  try {
    for (const [index, part] of manifest.parts.entries()) {
      await new Promise<void>((resolve, reject) => {
        const input = createReadStream(join(dir, part.name), { highWaterMark: 4 * 1024 * 1024 });
        const counter = measure(hash, (bytes) =>
          options.onProgress?.({
            phase: 'join',
            done: before + bytes,
            total: manifest.bytes,
            part: index + 1,
            parts: manifest.parts.length,
          }),
        );
        input.on('error', reject);
        counter.on('error', reject);
        counter.on('end', resolve);
        input.pipe(counter).pipe(output, { end: false });
      });
      before += part.bytes;
    }
    await new Promise<void>((resolve, reject) => {
      output.on('error', reject);
      output.end(resolve);
    });
  } catch (error) {
    output.destroy();
    await rm(joining, { force: true });
    throw new WeightsError('io', error instanceof Error ? error.message : String(error));
  }
  if (hash.digest('hex') !== manifest.sha256) {
    await rm(joining, { force: true });
    throw new WeightsError('hash', 'the joined file is not the file in the manifest');
  }
  await rename(joining, join(dir, name));
  for (const part of manifest.parts) await rm(join(dir, part.name), { force: true });
  return name;
}

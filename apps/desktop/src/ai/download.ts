import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { UNPUBLISHED, type ModelFile } from '@tp/shared/ai';

/**
 * Getting a model's files, and knowing they are the right ones (ADR 0023 section 3, generalised
 * by ADR 0024 to any number of files).
 *
 * A file is data with a manifest: its size and SHA-256, and those of the parts it is published in
 * (a GitHub release asset may not exceed 2 GiB; the text model is 2.33). Everything here streams: a
 * 2.5 GB file is never in memory, and a hash is computed as the bytes pass.
 *
 * Nothing here decides *when*. Downloading is the person's request, made with an explicit consent
 * the coordinator checks; verification is before the first use in a session. A mismatch deletes
 * nothing that is not ours, and the caller refuses to load the file with the reason.
 *
 * A part that was cut off (a dropped connection, a cancel) is kept as `<name>.partial` and the next
 * attempt asks the server for the rest with a `Range` header, hashing what is already there first.
 * A server that answers 200 instead of 206 is taken to have started over, and so do we.
 */
export type DownloadFailure = 'unpublished' | 'http' | 'size' | 'hash' | 'io' | 'host' | 'disk';

export class WeightsError extends Error {
  constructor(
    readonly failure: DownloadFailure,
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

/**
 * Counts bytes and hashes them as they pass, and reports. `from` is how many were already counted.
 * With `limit`, more bytes than that is an error at once: a server may not fill the disk with a
 * file that was published at a known size.
 */
export function measure(
  hash: ReturnType<typeof createHash>,
  report: (bytes: number) => void,
  from = 0,
  limit = Infinity,
): Transform {
  let seen = from;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) {
        done(new WeightsError('size', `more than the ${limit} bytes the manifest lists`));
        return;
      }
      hash.update(chunk);
      report(seen);
      done(null, chunk);
    },
  });
}

/** A sink that wants everything and keeps nothing. */
const drain = () => new Transform({ transform: (_chunk, _encoding, done) => done() });

/** The SHA-256 of a file, read as a stream. */
export async function sha256File(
  path: string,
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 }),
    measure(hash, (bytes) => options.onBytes?.(bytes)),
    drain(),
    ...(options.signal ? [{ signal: options.signal }] : []),
  );
  return hash.digest('hex');
}

export type Verdict = 'ok' | 'missing' | 'wrong-size' | 'wrong-hash';

/**
 * Does the file at `path` have exactly this size and hash? With no hash pinned (an evaluation-only
 * model) the size is all there is to check, and a matching size is `ok`.
 */
export async function verifyFile(
  path: string,
  expected: { bytes: number; sha256?: string | undefined },
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<Verdict> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return 'missing';
  if (info.size !== expected.bytes) return 'wrong-size';
  if (expected.sha256 === undefined) return 'ok';
  return (await sha256File(path, options)) === expected.sha256 ? 'ok' : 'wrong-hash';
}

export interface DownloadOptions {
  file: ModelFile;
  /** The folder the file lives in. */
  dir: string;
  /** Injected so a test needs no network; the app passes the global one. */
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: OnProgress;
  /**
   * When given, every address fetched, the first and each redirect's, must be https on a host this
   * accepts, or the download stops with `host`. Redirects are followed here, by hand, for that.
   */
  allowHost?: (host: string) => boolean;
}

const MAX_REDIRECTS = 5;

/** `fetch` that follows redirects itself so that no hop can leave the allowed hosts. */
async function fetchChecked(
  url: string,
  init: RequestInit,
  options: Pick<DownloadOptions, 'fetch' | 'allowHost'>,
): Promise<Response> {
  if (!options.allowHost) return options.fetch(url, { ...init, redirect: 'follow' });
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(at);
    if (target.protocol !== 'https:' || !options.allowHost(target.hostname)) {
      throw new WeightsError('host', `${target.hostname} is not a host Loppa downloads from`);
    }
    const response = await options.fetch(at, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      at = new URL(location, at).href;
      continue;
    }
    return response;
  }
  throw new WeightsError('http', 'too many redirects');
}

/**
 * Downloads each part of one file, verifies it, joins them, verifies that against the manifest,
 * and only then puts it under its final name and removes the parts. A part already on disk and
 * correct is not fetched again, so a failed attempt resumes at the part it stopped in, and a
 * part that was cut off resumes inside it. A file with a single part named like the file needs no
 * joining. Returns the path of the finished file.
 */
export async function downloadFile(options: DownloadOptions): Promise<string> {
  const { file, dir, onProgress } = options;
  const target = join(dir, file.name);
  if (file.parts.length === 0) {
    throw new WeightsError('unpublished', `${file.name} is not published by Loppa`);
  }
  const blocked = file.parts.find((part) => part.url.startsWith(UNPUBLISHED));
  if (blocked) {
    throw new WeightsError('unpublished', blocked.url.slice(UNPUBLISHED.length).trim());
  }
  for (const part of file.parts) {
    if (!part.url.startsWith('https://')) {
      throw new WeightsError('http', `${part.name} is not at an https address`);
    }
  }
  await mkdir(dir, { recursive: true });
  if ((await verifyFile(target, file)) === 'ok') return target;

  const parts = file.parts.length;
  const single = parts === 1 && file.parts[0]!.name === file.name;
  let before = 0;
  for (const [index, part] of file.parts.entries()) {
    const partTarget = join(dir, part.name);
    const report = (bytes: number) =>
      onProgress?.({
        phase: 'download',
        done: before + bytes,
        total: file.bytes,
        part: index + 1,
        parts,
      });

    if ((await verifyFile(partTarget, part)) !== 'ok') {
      await fetchPart(part, partTarget, options, report);
    }
    before += part.bytes;
    report(0);
  }
  if (single) return target;
  await joinParts(file, dir, options);
  return target;
}

async function fetchPart(
  part: ModelFile['parts'][number],
  target: string,
  options: DownloadOptions,
  report: (bytes: number) => void,
): Promise<void> {
  const { signal } = options;
  const partial = `${target}.partial`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let have = (await stat(partial).catch(() => null))?.size ?? 0;
    if (have >= part.bytes) {
      await rm(partial, { force: true });
      have = 0;
    }
    const hash = createHash('sha256');
    if (have > 0) {
      // What is already on disk goes through the hash first.
      await pipeline(
        createReadStream(partial),
        measure(hash, () => undefined),
        drain(),
      );
    }

    const response = await fetchChecked(
      part.url,
      {
        ...(have > 0 ? { headers: { Range: `bytes=${have}-` } } : {}),
        ...(signal ? { signal } : {}),
      },
      options,
    );
    if (response.status === 416 && attempt === 0) {
      await rm(partial, { force: true });
      continue;
    }
    if (!response.ok || !response.body) {
      throw new WeightsError('http', `${part.name}: the server answered ${response.status}`);
    }

    // 206: the rest of the file. 200: the whole file again, whatever we asked for.
    const resumed = have > 0 && response.status === 206;
    if (have > 0 && !resumed) await rm(partial, { force: true });
    const digest = resumed ? hash : createHash('sha256');
    const start = resumed ? have : 0;
    let received = start;
    try {
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        measure(
          digest,
          (bytes) => {
            received = bytes;
            report(bytes);
          },
          start,
          part.bytes,
        ),
        createWriteStream(partial, { flags: resumed ? 'a' : 'w' }),
        ...(signal ? [{ signal }] : []),
      );
    } catch (error) {
      if (error instanceof WeightsError) {
        // Longer than published: not a cut-off to resume, a wrong file to throw away.
        await rm(partial, { force: true });
        throw error;
      }
      // Kept either way, so the next attempt can ask for the rest.
      if (signal?.aborted) throw error;
      throw new WeightsError('io', error instanceof Error ? error.message : String(error));
    }
    if (received !== part.bytes) {
      await rm(partial, { force: true });
      throw new WeightsError('size', `${part.name} is ${received} bytes, not ${part.bytes}`);
    }
    if (digest.digest('hex') !== part.sha256) {
      await rm(partial, { force: true });
      throw new WeightsError('hash', `${part.name} is not the file in the manifest`);
    }
    await rename(partial, target);
    return;
  }
}

/** Concatenates the parts into the file, hashing as it writes. */
async function joinParts(
  file: ModelFile,
  dir: string,
  options: Pick<DownloadOptions, 'signal' | 'onProgress'>,
): Promise<void> {
  const joining = join(dir, `${file.name}.joining`);
  const hash = createHash('sha256');
  const output = createWriteStream(joining);
  let before = 0;
  try {
    for (const [index, part] of file.parts.entries()) {
      await new Promise<void>((resolve, reject) => {
        const input = createReadStream(join(dir, part.name), { highWaterMark: 4 * 1024 * 1024 });
        const counter = measure(hash, (bytes) =>
          options.onProgress?.({
            phase: 'join',
            done: before + bytes,
            total: file.bytes,
            part: index + 1,
            parts: file.parts.length,
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
  if (hash.digest('hex') !== file.sha256) {
    await rm(joining, { force: true });
    throw new WeightsError('hash', 'the joined file is not the file in the manifest');
  }
  await rename(joining, join(dir, file.name));
  for (const part of file.parts) await rm(join(dir, part.name), { force: true });
}

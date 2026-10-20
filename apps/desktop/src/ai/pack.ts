import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyFile, type OnProgress } from './download.js';

/**
 * The AI pack on disk (ADR 0025 section 4, ADR 0026 decision 8): the model's files cut into parts
 * under 2 GiB (a GitHub release file may not be larger), each with its SHA-256, and `PACK.json`
 * listing them. A pack is a plain folder: it travels on a USB stick, and installing from it needs no
 * network at all.
 *
 * Installing is a streamed join into `<name>.joining` in Loppa's own folder: every part is checked
 * (size, then hash as it passes) and so is the whole; only a file that matches is renamed to its
 * name, so a cut-off or wrong join never looks like a model. The parts in the pack folder are never
 * changed or deleted (it may be read-only). A file already installed and correct is skipped, which
 * is how an interrupted install resumes at the file it stopped in.
 *
 * The same shape is the app's model manifest (`ModelFile`), so the app checks a pack against the
 * hashes in its own code, and `PACK.json` is only a convenience for the scripts and for people.
 */
export const PACK_FILE = 'PACK.json';
/** What the published manifest uses (1.5 GiB): every part is below GitHub's 2 GiB limit. */
export const DEFAULT_PART_BYTES = 1_610_612_736;

export interface PackPart {
  bytes: number;
  name: string;
  sha256: string;
}
export interface PackFile {
  bytes: number;
  name: string;
  sha256: string;
  parts: PackPart[];
}
export interface PackManifest {
  format: 1;
  id: string;
  files: PackFile[];
}

export type PackFailure = 'missing' | 'size' | 'hash' | 'io';
export class PackError extends Error {
  constructor(
    readonly failure: PackFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PackError';
  }
}

const sha256Hex = (hash: ReturnType<typeof createHash>) => hash.digest('hex');

/** Cuts `source` into `<name>.partN` files of at most `partBytes` in `outDir`, hashing as it goes. */
export async function splitFile(
  source: string,
  outDir: string,
  partBytes = DEFAULT_PART_BYTES,
): Promise<PackFile> {
  const name = basename(source);
  const size = (await stat(source)).size;
  const whole = createHash('sha256');
  const parts: PackPart[] = [];
  // A file that fits is one piece, copied under its own name.
  const single = size <= partBytes;
  for (let index = 0, start = 0; start < size; index += 1, start += partBytes) {
    const end = Math.min(start + partBytes, size) - 1;
    const partName = single ? name : `${name}.part${index + 1}`;
    const hash = createHash('sha256');
    await pipeline(
      createReadStream(source, { start, end, highWaterMark: 4 * 1024 * 1024 }),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          whole.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(join(outDir, partName)),
    );
    parts.push({ bytes: end - start + 1, name: partName, sha256: sha256Hex(hash) });
  }
  return { bytes: size, name, sha256: sha256Hex(whole), parts };
}

/** Splits each source into `outDir` and writes `PACK.json` beside the parts. */
export async function makePack(
  id: string,
  sources: string[],
  outDir: string,
  partBytes = DEFAULT_PART_BYTES,
): Promise<PackManifest> {
  await mkdir(outDir, { recursive: true });
  const files: PackFile[] = [];
  for (const source of sources) files.push(await splitFile(source, outDir, partBytes));
  const manifest: PackManifest = { format: 1, id, files };
  await writeFile(join(outDir, PACK_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * A name from a `PACK.json` that is safe to join onto a folder on any system: letters, digits,
 * dot, underscore, hyphen; not `.` or `..`; no trailing dot (Windows drops it, so two names become
 * one); not a Windows device name (`CON`, `NUL`, `COM1`, also with an extension), which would write
 * to the device instead of a file.
 */
export function isPlainFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 200 &&
    /^[A-Za-z0-9._-]+$/.test(value) &&
    !value.startsWith('.') &&
    !value.endsWith('.') &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(value)
  );
}

export async function readPackManifest(folder: string): Promise<PackManifest> {
  const raw: unknown = JSON.parse(await readFile(join(folder, PACK_FILE), 'utf8'));
  const m = raw as Partial<PackManifest> | null;
  const isHash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const isName = isPlainFileName;
  const isSize = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  const ok =
    m?.format === 1 &&
    typeof m.id === 'string' &&
    Array.isArray(m.files) &&
    m.files.every(
      (f) =>
        isName(f.name) &&
        isSize(f.bytes) &&
        isHash(f.sha256) &&
        Array.isArray(f.parts) &&
        f.parts.length > 0 &&
        f.parts.every((p) => isName(p.name) && isSize(p.bytes) && isHash(p.sha256)),
    );
  if (!ok) throw new PackError('io', `${PACK_FILE} is not a Loppa AI pack manifest`);
  return m as PackManifest;
}

const exists = (path: string) =>
  stat(path).then(
    (info) => info.isFile(),
    () => false,
  );

/**
 * Joins one file from the parts found in `folder` into `destDir/<name>`. The pieces are the file's
 * parts, or, when they are not there, the whole file under its own name. Returns the path.
 */
export async function joinFile(
  file: PackFile,
  folder: string,
  destDir: string,
  options: { signal?: AbortSignal; onProgress?: OnProgress } = {},
): Promise<string> {
  const target = join(destDir, file.name);
  const pieces = (await Promise.all(file.parts.map((p) => exists(join(folder, p.name))))).every(
    Boolean,
  )
    ? file.parts
    : (await exists(join(folder, file.name)))
      ? [{ bytes: file.bytes, name: file.name, sha256: file.sha256 }]
      : null;
  if (!pieces) {
    const missing = file.parts.find((p) => !existsSync(join(folder, p.name)));
    throw new PackError('missing', `${missing?.name ?? file.name} is not in the folder`);
  }
  await mkdir(destDir, { recursive: true });
  const joining = `${target}.joining`;
  const whole = createHash('sha256');
  let done = 0;

  async function* chunks(): AsyncGenerator<Buffer> {
    for (const [index, piece] of pieces!.entries()) {
      const path = join(folder, piece.name);
      if ((await stat(path)).size !== piece.bytes) {
        throw new PackError('size', `${piece.name} is not ${piece.bytes} bytes`);
      }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
        hash.update(chunk as Buffer);
        whole.update(chunk as Buffer);
        done += (chunk as Buffer).length;
        options.onProgress?.({
          phase: 'join',
          done,
          total: file.bytes,
          part: index + 1,
          parts: pieces!.length,
        });
        yield chunk as Buffer;
      }
      if (sha256Hex(hash) !== piece.sha256) {
        throw new PackError('hash', `${piece.name} is not the file in the manifest`);
      }
    }
  }

  try {
    await pipeline(
      Readable.from(chunks()),
      createWriteStream(joining),
      ...(options.signal ? [{ signal: options.signal }] : []),
    );
    if (sha256Hex(whole) !== file.sha256) {
      throw new PackError('hash', `${file.name} joined is not the file in the manifest`);
    }
    await rename(joining, target);
  } catch (error) {
    await rm(joining, { force: true });
    if (error instanceof PackError || options.signal?.aborted) throw error;
    throw new PackError('io', error instanceof Error ? error.message : String(error));
  }
  return target;
}

/**
 * Installs every file of `files` it can from a pack folder into `destDir`. A file already there
 * and right is left alone; one that is `optional` and absent from the folder is skipped; anything
 * else missing stops with {@link PackError}. Returns the paths now in place.
 */
export async function installFromFolder(
  files: ReadonlyArray<PackFile & { optional?: boolean | undefined }>,
  folder: string,
  destDir: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (file: number, of: number, p: Parameters<OnProgress>[0]) => void;
  } = {},
): Promise<string[]> {
  const out: string[] = [];
  for (const [index, file] of files.entries()) {
    const target = join(destDir, file.name);
    if ((await verifyFile(target, file)) === 'ok') {
      out.push(target);
      continue;
    }
    try {
      out.push(
        await joinFile(file, folder, destDir, {
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (p) => options.onProgress?.(index + 1, files.length, p),
        }),
      );
    } catch (error) {
      if (file.optional && error instanceof PackError && error.failure === 'missing') continue;
      throw error;
    }
  }
  return out;
}

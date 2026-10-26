import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflateRaw } from 'node:zlib';

/**
 * Unpacking an archive that came from the network, safely (ADR 0026): a `.zip` or a `.tar.gz`,
 * read by this file and by nothing else, so that what the person's disk receives is decided here.
 *
 * - **Names.** Every entry name is checked before it is used: no `..`, no absolute path, no drive
 *   letter or `:` (alternate data streams), no backslash, no device names, no control characters,
 *   no two names that differ only in case. A name that fails stops the whole unpacking.
 * - **No links, ever.** A hard link, a device or a link in a zip is refused. A symbolic link in a
 *   tar is allowed only when it names another file of the same folder in the same archive (the
 *   `libllama.dylib -> libllama.0.dylib` of the macOS build); it is written as a **copy** of that
 *   file, so no link exists on the disk to be followed later.
 * - **Size.** Entry count, one file, the total, and the ratio of unpacked to packed bytes are
 *   capped, counted as the bytes pass (a header that lies cannot make the disk fill).
 * - **Modes.** Only "executable or not" is taken from the archive (0o755 / 0o644).
 *
 * The folder given must be a new, empty one; the caller removes it on failure.
 */
export type ExtractFailure =
  'path' | 'link' | 'type' | 'size' | 'ratio' | 'count' | 'format' | 'duplicate';

export class ExtractError extends Error {
  constructor(
    readonly failure: ExtractFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractError';
  }
}

export interface ExtractLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Unpacked bytes per packed byte. */
  maxRatio: number;
}

/** Generous for llama.cpp's builds (about 150 MB unpacked from 20 to 30 MB); far below a bomb. */
export const DEFAULT_LIMITS: ExtractLimits = {
  maxFiles: 500,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxRatio: 100,
};

const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
// Control characters are exactly what this refuses.
// eslint-disable-next-line no-control-regex
const SEGMENT = /^[^\x00-\x1f<>:"|?*\\/]+$/;

/**
 * An entry name as its path segments, or an {@link ExtractError}. A trailing `/` (a folder) is
 * dropped; a leading `./` is dropped; nothing else is forgiven.
 */
export function safeEntryName(raw: string): string[] {
  let name = raw;
  while (name.startsWith('./')) name = name.slice(2);
  if (name.endsWith('/')) name = name.slice(0, -1);
  if (name === '' || name === '.') throw new ExtractError('path', 'an entry has no name');
  if (name.includes('\0') || name.includes('\\')) {
    throw new ExtractError('path', 'an entry name has a backslash or a NUL');
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new ExtractError('path', 'an entry name is an absolute path');
  }
  const segments = name.split('/');
  if (segments.length > 16) throw new ExtractError('path', 'an entry name is nested too deep');
  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.length > 200 ||
      !SEGMENT.test(segment) ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      DEVICE.test(segment)
    ) {
      throw new ExtractError('path', 'an entry name is not a plain relative path');
    }
  }
  return segments;
}

/** Where an entry goes, inside `root` for certain. */
function placeInside(root: string, segments: string[]): string {
  const path = resolve(root, ...segments);
  if (!path.startsWith(resolve(root) + sep)) {
    throw new ExtractError('path', 'an entry would be written outside the folder');
  }
  return path;
}

/** Counts what has been planned, against the limits. */
class Budget {
  files = 0;
  total = 0;
  private readonly names = new Set<string>();
  constructor(
    private readonly limits: ExtractLimits,
    private readonly packedBytes: number,
  ) {}

  /** A new name (file, folder or link), once, ignoring case. */
  claim(segments: string[]): void {
    const key = segments.join('/').toLowerCase();
    if (this.names.has(key)) throw new ExtractError('duplicate', 'two entries have one name');
    this.names.add(key);
  }

  file(bytes: number): void {
    this.files += 1;
    if (this.files > this.limits.maxFiles) throw new ExtractError('count', 'too many files');
    if (bytes > this.limits.maxFileBytes) throw new ExtractError('size', 'a file is too large');
    this.total += bytes;
    if (this.total > this.limits.maxTotalBytes) throw new ExtractError('size', 'too large');
    if (this.total > Math.max(this.packedBytes, 1) * this.limits.maxRatio) {
      throw new ExtractError('ratio', 'the archive unpacks to far more than it weighs');
    }
  }
}

// --- tar.gz ---------------------------------------------------------------------------------

/** Pulls exact byte counts from a stream of chunks. */
class Puller {
  private buf: Buffer = Buffer.alloc(0);
  private readonly it: AsyncIterator<Buffer>;
  consumed = 0;
  constructor(source: AsyncIterable<Buffer>) {
    this.it = source[Symbol.asyncIterator]();
  }
  private async fill(n: number): Promise<void> {
    while (this.buf.length < n) {
      const next = await this.it.next();
      if (next.done) return;
      this.buf = this.buf.length === 0 ? next.value : Buffer.concat([this.buf, next.value]);
    }
  }
  /** Exactly `n` bytes, or null at a clean end of the stream. */
  async take(n: number): Promise<Buffer | null> {
    await this.fill(n);
    if (this.buf.length === 0) return null;
    if (this.buf.length < n)
      throw new ExtractError('format', 'the archive ends in the middle of an entry');
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    this.consumed += n;
    return out;
  }
  /** Up to `n` bytes in pieces, for a file's content. */
  async *pieces(n: number): AsyncGenerator<Buffer> {
    let left = n;
    while (left > 0) {
      await this.fill(1);
      if (this.buf.length === 0)
        throw new ExtractError('format', 'the archive ends in the middle of a file');
      const part = this.buf.subarray(0, Math.min(left, this.buf.length));
      this.buf = this.buf.subarray(part.length);
      this.consumed += part.length;
      left -= part.length;
      yield part;
    }
  }
  async skip(n: number): Promise<void> {
    for await (const _ of this.pieces(n)) void _;
  }
}

const text = (b: Buffer, from: number, length: number) => {
  const slice = b.subarray(from, from + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString('utf8');
};

function octal(b: Buffer, from: number, length: number): number {
  if ((b[from] ?? 0) & 0x80) throw new ExtractError('size', 'a size is out of range');
  const value = text(b, from, length).trim();
  if (value === '') return 0;
  if (!/^[0-7]+$/.test(value)) throw new ExtractError('format', 'a tar header is damaged');
  return parseInt(value, 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0);
  return sum === octal(header, 148, 8);
}

/** The `key=value` records of a pax header. */
function paxRecords(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const length = Number(data.subarray(at, space).toString('latin1'));
    if (space < 0 || !Number.isInteger(length) || length < 4 || at + length > data.length) {
      throw new ExtractError('format', 'a pax header is damaged');
    }
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return out;
}

export async function extractTarGz(
  archive: string,
  out: string,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Promise<void> {
  const packed = (await stat(archive)).size;
  const budget = new Budget(limits, packed);
  const gunzip = createGunzip();
  createReadStream(archive)
    .on('error', (e) => gunzip.destroy(e))
    .pipe(gunzip);
  const puller = new Puller(gunzip);
  // What may be read at most: the declared content plus headers and padding.
  const readCap = limits.maxTotalBytes + limits.maxFiles * 2048 + 4 * 1024 * 1024;
  const links: Array<{ segments: string[]; target: string }> = [];
  const files = new Map<string, string>(); // lower-case path -> path written
  let longName: string | undefined;
  let longLink: string | undefined;
  let pax = new Map<string, string>();

  await mkdir(out, { recursive: true });
  try {
    for (;;) {
      if (puller.consumed > readCap)
        throw new ExtractError('size', 'the archive unpacks to too much');
      const header = await puller.take(512);
      if (!header || header.every((byte) => byte === 0)) break;
      if (!checksumOk(header)) throw new ExtractError('format', 'a tar header is damaged');
      const type = String.fromCharCode(header[156] || 0x30);
      let size = octal(header, 124, 12);
      const mode = octal(header, 100, 8);
      const padded = Math.ceil(size / 512) * 512;

      if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
        if (size > 1024 * 1024) throw new ExtractError('size', 'a header block is too large');
        const data = (await puller.take(padded))!;
        const content = data.subarray(0, size);
        if (type === 'x') pax = paxRecords(content);
        else if (type === 'L') longName = text(content, 0, content.length);
        else if (type === 'K') longLink = text(content, 0, content.length);
        continue;
      }

      const ustar = text(header, 257, 5) === 'ustar';
      const prefix = ustar ? text(header, 345, 155) : '';
      const base = text(header, 0, 100);
      const rawName = pax.get('path') ?? longName ?? (prefix ? `${prefix}/${base}` : base);
      const rawLink = pax.get('linkpath') ?? longLink ?? text(header, 157, 100);
      if (pax.has('size')) size = Number(pax.get('size'));
      pax = new Map();
      longName = undefined;
      longLink = undefined;
      if (!Number.isSafeInteger(size) || size < 0)
        throw new ExtractError('size', 'a size is out of range');
      const dataBytes = Math.ceil(size / 512) * 512;

      const segments = safeEntryName(rawName);
      budget.claim(segments);
      const destination = placeInside(out, segments);

      if (type === '5') {
        await mkdir(destination, { recursive: true });
        continue;
      }
      if (type === '2') {
        // Only a plain name in the same folder: no path, no `..`.
        if (!/^[^/\\:]+$/.test(rawLink) || rawLink === '.' || rawLink === '..') {
          throw new ExtractError('link', 'a link points somewhere other than a file beside it');
        }
        safeEntryName(rawLink);
        links.push({ segments, target: rawLink });
        if (dataBytes > 0) await puller.skip(dataBytes);
        continue;
      }
      if (type === '1') throw new ExtractError('link', 'the archive has a hard link');
      if (type !== '0' && type !== '7')
        throw new ExtractError('type', 'the archive has an entry that is not a file');

      budget.file(size);
      await mkdir(dirname(destination), { recursive: true });
      const sink = createWriteStream(destination, {
        flags: 'wx',
        mode: mode & 0o111 ? 0o755 : 0o644,
      });
      await pipeline(puller.pieces(size), sink);
      const pad = dataBytes - size;
      if (pad > 0) await puller.skip(pad);
      files.set(segments.join('/').toLowerCase(), destination);
    }
  } finally {
    gunzip.destroy();
  }

  // Links last, as copies of the files they name (a chain of links is followed, a few steps).
  const byName = new Map(links.map((l) => [l.segments.join('/').toLowerCase(), l]));
  for (const link of links) {
    let at = link;
    for (let hop = 0; ; hop += 1) {
      if (hop > 8) throw new ExtractError('link', 'a link leads in a circle');
      const folder = at.segments.slice(0, -1);
      const targetKey = [...folder, at.target].join('/').toLowerCase();
      const real = files.get(targetKey);
      if (real) {
        const info = await stat(real);
        budget.file(info.size);
        await mkdir(dirname(placeInside(out, link.segments)), { recursive: true });
        await copyFile(real, placeInside(out, link.segments));
        break;
      }
      const next = byName.get(targetKey);
      if (!next) throw new ExtractError('link', 'a link points at nothing in the archive');
      at = next;
    }
  }
}

// --- zip ------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, chunk: Buffer): number {
  let c = crc;
  for (const byte of chunk) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c;
}

interface ZipEntry {
  segments: string[];
  directory: boolean;
  method: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
  executable: boolean;
}

export async function extractZip(
  archive: string,
  out: string,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Promise<void> {
  const total = (await stat(archive)).size;
  const handle = await open(archive, 'r');
  let entries: ZipEntry[];
  try {
    const tailLength = Math.min(total, 22 + 65535);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, total - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ExtractError('format', 'not a zip file');
    const disk = tail.readUInt16LE(eocd + 4);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0 || tail.readUInt16LE(eocd + 8) !== count) {
      throw new ExtractError('format', 'a split zip is not supported');
    }
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ExtractError('format', 'a zip64 archive is not supported');
    }
    if (count > limits.maxFiles * 2 || cdOffset + cdSize > total) {
      throw new ExtractError('count', 'the zip lists too many entries');
    }
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    const budget = new Budget(limits, total);
    entries = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) {
        throw new ExtractError('format', 'the zip directory is damaged');
      }
      const made = cd.readUInt16LE(at + 4);
      const flags = cd.readUInt16LE(at + 8);
      const method = cd.readUInt16LE(at + 10);
      const crc = cd.readUInt32LE(at + 16);
      const packed = cd.readUInt32LE(at + 20);
      const size = cd.readUInt32LE(at + 24);
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      const external = cd.readUInt32LE(at + 38);
      const offset = cd.readUInt32LE(at + 42);
      if (at + 46 + nameLength + extraLength + commentLength > cd.length) {
        throw new ExtractError('format', 'the zip directory is damaged');
      }
      const rawName = cd
        .subarray(at + 46, at + 46 + nameLength)
        .toString(flags & 0x800 ? 'utf8' : 'latin1');
      at += 46 + nameLength + extraLength + commentLength;

      if (flags & 1) throw new ExtractError('format', 'an encrypted zip is not supported');
      if (packed === 0xffffffff || size === 0xffffffff) {
        throw new ExtractError('format', 'a zip64 entry is not supported');
      }
      // Unix attributes live in the high half when the zip was made on Unix (host 3).
      const unix = made >> 8 === 3 ? external >>> 16 : 0;
      const kind = unix & 0o170000;
      if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) {
        throw new ExtractError('link', 'the zip has a link or a special file');
      }
      const directory = rawName.endsWith('/') || kind === 0o040000;
      const segments = safeEntryName(rawName);
      budget.claim(segments);
      if (!directory) {
        if (method !== 0 && method !== 8)
          throw new ExtractError('format', 'an unsupported compression');
        if (method === 0 && packed !== size)
          throw new ExtractError('format', 'a stored entry has two sizes');
        budget.file(size);
      }
      entries.push({
        segments,
        directory,
        method,
        crc,
        packed,
        size,
        offset,
        executable: (unix & 0o111) !== 0,
      });
    }

    await mkdir(out, { recursive: true });
    for (const entry of entries) {
      const destination = placeInside(out, entry.segments);
      if (entry.directory) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, entry.offset);
      if (local.readUInt32LE(0) !== 0x04034b50)
        throw new ExtractError('format', 'a zip entry is damaged');
      const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + entry.packed > cdOffset)
        throw new ExtractError('format', 'a zip entry is damaged');
      await mkdir(dirname(destination), { recursive: true });

      let seen = 0;
      let crc = 0xffffffff;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          seen += chunk.length;
          // Never more than the directory said, whatever the compressed stream turns into.
          if (seen > entry.size) {
            done(new ExtractError('size', 'an entry unpacks to more than it says'));
            return;
          }
          crc = crc32Update(crc, chunk);
          done(null, chunk);
        },
      });
      const sink = createWriteStream(destination, {
        flags: 'wx',
        mode: entry.executable ? 0o755 : 0o644,
      });
      if (entry.packed === 0) {
        await pipeline(Readable.from([]), count, sink);
      } else {
        const raw = createReadStream(archive, { start, end: start + entry.packed - 1 });
        await pipeline(raw, ...(entry.method === 8 ? [createInflateRaw()] : []), count, sink);
      }
      if (seen !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        throw new ExtractError('format', 'an entry does not match its checksum');
      }
    }
  } finally {
    await handle.close();
  }
}

/** Unpacks by the archive's name: `.zip`, `.tar.gz` or `.tgz`. */
export async function extractArchive(
  archive: string,
  out: string,
  limits: ExtractLimits = DEFAULT_LIMITS,
): Promise<void> {
  const name = archive.toLowerCase();
  if (name.endsWith('.zip')) return extractZip(archive, out, limits);
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return extractTarGz(archive, out, limits);
  throw new ExtractError('format', 'only .zip and .tar.gz archives are unpacked');
}

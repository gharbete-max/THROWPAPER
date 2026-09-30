import { DocxRefused } from './refusal.js';

/**
 * The zip reader a Word document needs, and no more — ADR 0018: no dependency, and the caps in
 * `IMPORT-PIPELINE.md` counted while reading rather than trusted from the file.
 *
 * It reads the central directory (at the end of the file), then inflates only the entries it is
 * asked for, with the platform's own `DecompressionStream('deflate-raw')` — present in every
 * browser the product supports, in Electron and in Node. Stored and deflated entries only; a zip64
 * archive, a split archive, an encrypted entry or another compression method is refused. Sizes
 * the file declares are never believed: the inflated bytes are counted as they arrive, against
 * one budget for the whole document, and inflating stops the moment it is spent — so a zip bomb
 * costs at most the budget.
 */

/** `IMPORT-PIPELINE.md`, "Caps". */
export const ZIP_CAPS = {
  /** Entries in the central directory. */
  entries: 200,
  /** Inflated bytes, summed over every entry read. */
  inflated: 20 * 1024 * 1024,
} as const;

interface Entry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly compressed: number;
  readonly localOffset: number;
}

export interface Zip {
  /** Every entry's name, in directory order. */
  readonly names: readonly string[];
  /** An entry's bytes, inflated against the shared budget; null when there is no such entry. */
  read(name: string): Promise<Uint8Array | null>;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function unreadable(detail: string): never {
  throw new DocxRefused('unreadable', detail);
}

/** Opens an archive. Throws `DocxRefused` for anything it will not read. */
export function openZip(bytes: Uint8Array, caps: typeof ZIP_CAPS = ZIP_CAPS): Zip {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) =>
    at + 2 <= bytes.length ? view.getUint16(at, true) : unreadable('truncated');
  const u32 = (at: number) =>
    at + 4 <= bytes.length ? view.getUint32(at, true) : unreadable('truncated');

  // The end-of-central-directory record: 22 bytes, then a comment of up to 65 535.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) unreadable('not a zip archive');
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0) unreadable('a split archive');
  const declared = u16(end + 10);
  const size = u32(end + 12);
  const offset = u32(end + 16);
  if (declared === 0xffff || size === 0xffffffff || offset === 0xffffffff) unreadable('zip64');
  if (declared > caps.entries) throw new DocxRefused('too-complex', 'entries');
  if (offset + size > end) unreadable('central directory out of bounds');

  const entries = new Map<string, Entry>();
  const names: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let at = offset;
  while (at < offset + size) {
    if (names.length >= caps.entries) throw new DocxRefused('too-complex', 'entries');
    if (u32(at) !== CENTRAL) unreadable('central directory entry');
    const nameLength = u16(at + 28);
    const next = at + 46 + nameLength + u16(at + 30) + u16(at + 32);
    if (next > offset + size) unreadable('central directory entry out of bounds');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const entry: Entry = {
      name,
      flags: u16(at + 8),
      method: u16(at + 10),
      compressed: u32(at + 20),
      localOffset: u32(at + 42),
    };
    names.push(name);
    if (!entries.has(name)) entries.set(name, entry);
    at = next;
  }

  let budget: number = caps.inflated;
  return {
    names,
    async read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.flags & 1) throw new DocxRefused('protected', 'an encrypted entry');
      const local = entry.localOffset;
      if (u32(local) !== LOCAL) unreadable('local header');
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      if (start + entry.compressed > bytes.length) unreadable('entry out of bounds');
      const data = bytes.subarray(start, start + entry.compressed);
      if (entry.method === 0) {
        if (data.length > budget) throw new DocxRefused('too-complex', 'inflated size');
        budget -= data.length;
        return data;
      }
      if (entry.method !== 8) unreadable(`compression method ${entry.method}`);
      const inflated = await inflate(data, budget);
      budget -= inflated.length;
      return inflated;
    },
  };
}

/** Inflates raw deflate data, stopping as soon as more than `limit` bytes have come out. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new DocxRefused('too-complex', 'inflated size');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DocxRefused) throw error;
    unreadable('corrupt deflate data');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

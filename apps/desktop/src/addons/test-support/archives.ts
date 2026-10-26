import { deflateRawSync, gzipSync } from 'node:zlib';

/**
 * Archives built byte by byte for tests: a tar.gz and a zip whose entries may be as hostile as the
 * test needs (a `..` name, a link, a lying size), which no archiving program would write.
 */
export interface TarEntry {
  name: string;
  /** '0' file, '5' folder, '2' symbolic link, '1' hard link, '3' device. */
  type?: string;
  data?: Buffer | string;
  link?: string;
  mode?: number;
  /** Written in the header instead of the real size. */
  declaredSize?: number;
}

function tarHeader(entry: TarEntry, data: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(entry.name.slice(0, 100), 0, 'utf8');
  header.write((entry.mode ?? 0o644).toString(8).padStart(7, '0'), 100, 'ascii');
  header.write('0000000', 108, 'ascii');
  header.write('0000000', 116, 'ascii');
  header.write((entry.declaredSize ?? data.length).toString(8).padStart(11, '0'), 124, 'ascii');
  header.write('00000000000', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header.write(entry.type ?? '0', 156, 'ascii');
  header.write(entry.link ?? '', 157, 'utf8');
  header.write('ustar', 257, 'ascii');
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return header;
}

export function makeTarGz(entries: TarEntry[], options: { pad?: number } = {}): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    blocks.push(tarHeader(entry, data));
    if (data.length > 0) {
      blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  if (options.pad) blocks.push(Buffer.alloc(options.pad));
  return gzipSync(Buffer.concat(blocks));
}

export interface ZipEntry {
  name: string;
  data?: Buffer | string;
  stored?: boolean;
  /** Unix mode in the high half of the external attributes (0o120777 is a symbolic link). */
  mode?: number;
  /** Written in the central directory instead of the real size. */
  declaredSize?: number;
  /** Written instead of the real checksum. */
  crc?: number;
  /** General-purpose flags (bit 0 is "encrypted"). */
  flags?: number;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '');
    const plain = entry.stored || data.length === 0;
    const packed = plain ? data : deflateRawSync(data);
    const crc = entry.crc ?? crc32(data);
    const flags = entry.flags ?? 0x800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(plain ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(entry.mode === undefined ? 20 : (3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(plain ? 0 : 8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(entry.declaredSize ?? data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(((entry.mode ?? 0) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

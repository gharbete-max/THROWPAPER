/**
 * What a file is, from its bytes and never its name: a dropped file called `scan.pdf` that is a
 * photograph is a photograph, and a Word file with no extension is still Word.
 */
export type Sniffed = 'pdf' | 'word' | 'photo' | 'other';

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** `head` is the file's first bytes and `tail` its last (a zip lists its parts at the end). */
export function sniffBytes(head: Uint8Array, tail: Uint8Array = head): Sniffed {
  // A PDF may be preceded by a little junk; the standard allows the marker in the first 1024 bytes.
  if (ascii(head, 0, 1024).includes('%PDF-')) return 'pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'photo';
  if (ascii(head, 0, 8) === '\x89PNG\r\n\x1a\n') return 'photo';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'photo';
  if (
    ascii(head, 4, 8) === 'ftyp' &&
    /^(heic|heix|hevc|heim|heis|mif1|msf1)/.test(ascii(head, 8, 12))
  ) {
    return 'photo';
  }
  if (
    ascii(head, 0, 4) === 'PK\x03\x04' &&
    ascii(tail, 0, tail.length).includes('word/document.xml')
  ) {
    return 'word';
  }
  return 'other';
}

export async function sniffFile(file: Blob): Promise<Sniffed> {
  const [head, tail] = await Promise.all([
    file.slice(0, 2048).arrayBuffer(),
    file.slice(Math.max(0, file.size - 262_144)).arrayBuffer(),
  ]);
  return sniffBytes(new Uint8Array(head), new Uint8Array(tail));
}

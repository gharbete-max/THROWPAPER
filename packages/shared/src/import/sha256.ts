/**
 * SHA-256 (FIPS 180-4) of a string's UTF-8 bytes, as 64 lower-case hex digits.
 *
 * Written out because the import core may not import `node:crypto` and `crypto.subtle` is
 * asynchronous, while every stage is a synchronous pure function (`IMPORT-PIPELINE.md`). It hashes
 * a stage's canonical input for the debug artifact, so a snapshot names exactly what it came from.
 * Integer and bitwise operations only; checked against the NIST vectors and `node:crypto`.
 *
 * Typed arrays, not an array of numbers pushed one byte at a time: a twenty-page layout document is
 * megabytes of canonical JSON, and hashing it was the slowest thing the import did (S9).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** The code point at `i` (a pair of surrogates is one), and how many UTF-16 units it took. */
function codePointAt(text: string, i: number): [number, number] {
  const unit = text.charCodeAt(i);
  if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return [0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00), 2];
    }
  }
  // A lone surrogate becomes U+FFFD, as `TextEncoder` would make it.
  return [unit >= 0xd800 && unit <= 0xdfff ? 0xfffd : unit, 1];
}

/**
 * The UTF-8 bytes of a string, with `extra` zero bytes of room after them; the second value is
 * how many of the bytes are the string's.
 */
function encode(text: string, extra = 0): [Uint8Array, number] {
  let length = 0;
  for (let i = 0; i < text.length;) {
    const [code, units] = codePointAt(text, i);
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    i += units;
  }
  const bytes = new Uint8Array(length + extra);
  let at = 0;
  for (let i = 0; i < text.length;) {
    const [code, units] = codePointAt(text, i);
    i += units;
    if (code < 0x80) {
      bytes[at++] = code;
    } else if (code < 0x800) {
      bytes[at++] = 0xc0 | (code >> 6);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      bytes[at++] = 0xe0 | (code >> 12);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    } else {
      bytes[at++] = 0xf0 | (code >> 18);
      bytes[at++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[at++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at++] = 0x80 | (code & 0x3f);
    }
  }
  return [bytes, length];
}

/**
 * UTF-8 bytes of a string; a lone surrogate becomes U+FFFD, as `TextEncoder` would make it.
 * Shared with the builder's id fingerprints (`builder/ids.ts`), which hash the same way.
 */
export function utf8Bytes(text: string): number[] {
  return Array.from(encode(text)[0]);
}

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(text: string): string {
  // The message, then 0x80, zeros, and its length in bits as a 64-bit big-endian integer, to a
  // whole number of 64-byte blocks. Room for all of it is made once.
  const [probe, length] = encode(text, 0);
  const total = Math.ceil((length + 9) / 64) * 64;
  const bytes = new Uint8Array(total);
  bytes.set(probe);
  bytes[length] = 0x80;
  const bitLength = length * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes[total - 8] = (high >>> 24) & 0xff;
  bytes[total - 7] = (high >>> 16) & 0xff;
  bytes[total - 6] = (high >>> 8) & 0xff;
  bytes[total - 5] = high & 0xff;
  bytes[total - 4] = (low >>> 24) & 0xff;
  bytes[total - 3] = (low >>> 16) & 0xff;
  bytes[total - 2] = (low >>> 8) & 0xff;
  bytes[total - 1] = low & 0xff;

  const hash = new Uint32Array(INITIAL);
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < total; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = chunk + i * 4;
      w[i] = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + S1 + choose + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = hash[0]! + a;
    hash[1] = hash[1]! + b;
    hash[2] = hash[2]! + c;
    hash[3] = hash[3]! + d;
    hash[4] = hash[4]! + e;
    hash[5] = hash[5]! + f;
    hash[6] = hash[6]! + g;
    hash[7] = hash[7]! + h;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

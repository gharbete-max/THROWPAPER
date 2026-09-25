import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, inputSha256 } from './debug.js';
import { sha256Hex } from './sha256.js';

const node = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('gives the FIPS 180-4 example digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto across the padding boundaries and in every UTF-8 width', () => {
    const texts = [
      ...[55, 56, 57, 63, 64, 65, 119, 120, 128, 1000].map((n) => 'a'.repeat(n)),
      'Ålö', // two-byte
      '続く — 3）', // three-byte
      '𝒜 😀 𠀀', // four-byte
      'x'.repeat(54) + 'é', // a multi-byte character across the 55/56 boundary
    ];
    for (const text of texts) expect(sha256Hex(text), text).toBe(node(text));
  });

  it('hashes a lone surrogate as U+FFFD, as TextEncoder would encode it', () => {
    expect(sha256Hex('a\uD800b')).toBe(sha256Hex('a\uFFFDb'));
  });
});

describe('canonicalJson', () => {
  it('sorts keys by code point at every depth, with no whitespace', () => {
    expect(
      canonicalJson({ b: 1, a: [{ z: null, y: true }], '\u{1F600}': 'x', '\uFFFF': 'y' }),
    ).toBe('{"a":[{"y":true,"z":null}],"b":1,"\uFFFF":"y","\u{1F600}":"x"}');
  });

  it('gives the same bytes whatever order the keys were written in', () => {
    const forward = { pageNo: 1, box: { x0: 1, y0: 2, x1: 3, y1: 4 } };
    const backward = { box: { y1: 4, x1: 3, y0: 2, x0: 1 }, pageNo: 1 };
    expect(canonicalJson(backward)).toBe(canonicalJson(forward));
    expect(inputSha256(backward)).toBe(inputSha256(forward));
  });

  it('refuses what is not plain integer JSON, rather than serialising something that looks equal', () => {
    for (const value of [0.5, Number.NaN, Infinity, undefined, () => 1, new Map(), { a: 0.1 }]) {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    }
  });
});

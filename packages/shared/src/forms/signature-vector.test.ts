import { describe, expect, it } from 'vitest';
import {
  SignatureVector,
  crc32,
  embedSignatureVector,
  readSignatureVector,
  signatureVectorSvg,
  type SignatureVector as Vector,
} from './signature-vector.js';

/** A real 1×1 PNG, as any encoder writes it. */
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);

const drawn: Vector = {
  v: 1,
  kind: 'drawn',
  width: 600,
  height: 200,
  paths: ['M 10 20 Q 11.5 22 13 24 L 30 40', 'M 50 50 l 0.01 0'],
};

const chunkTypes = (bytes: Uint8Array) => {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const length = view.getUint32(offset);
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
};

describe('crc32', () => {
  it('matches the value every PNG ends with', () => {
    // The CRC of the bytes "IEND" is fixed by the specification and printed in every PNG.
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

describe('the strokes inside a signature PNG', () => {
  it('round-trips, and leaves the picture a valid PNG ending in IEND', () => {
    const signed = embedSignatureVector(png, drawn);
    expect(chunkTypes(signed)).toEqual(['IHDR', 'IDAT', 'iTXt', 'IEND']);
    expect(readSignatureVector(signed)).toEqual({ ok: true, vector: drawn });
  });

  it('carries a typed name in any script', () => {
    const typed: Vector = { v: 1, kind: 'typed', width: 600, height: 200, text: 'Анна Öberg 李' };
    expect(readSignatureVector(embedSignatureVector(png, typed))).toEqual({
      ok: true,
      vector: typed,
    });
  });

  it('is null for a PNG that has none — every signature made before this existed', () => {
    expect(readSignatureVector(png)).toEqual({ ok: true, vector: null });
  });

  it('refuses something that is not a PNG', () => {
    expect(readSignatureVector(new TextEncoder().encode('%PDF-1.7'))).toEqual({
      ok: false,
      reason: 'not-png',
    });
  });

  it('notices a changed byte in the strokes', () => {
    const signed = embedSignatureVector(png, drawn);
    const at = new TextDecoder('latin1').decode(signed).indexOf('M 10 20');
    const tampered = signed.slice();
    tampered[at + 2] = '9'.charCodeAt(0);
    expect(readSignatureVector(tampered)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a second set of strokes rather than choosing one', () => {
    const signed = embedSignatureVector(png, drawn);
    expect(() => embedSignatureVector(signed, drawn)).toThrow(/already/);
  });

  it('refuses a chunk whose length runs past the end of the file', () => {
    const truncated = embedSignatureVector(png, drawn).slice(0, -20);
    expect(readSignatureVector(truncated).ok).toBe(false);
  });
});

describe('what a signature vector may contain', () => {
  it('has no room for timing, pressure or anything else biometric', () => {
    for (const extra of [{ t: [0, 16, 33] }, { pressure: [0.4] }, { pointerType: 'pen' }]) {
      expect(SignatureVector.safeParse({ ...drawn, ...extra }).success).toBe(false);
    }
  });

  it('accepts only the path grammar the pad writes', () => {
    const withPath = (d: string) => SignatureVector.safeParse({ ...drawn, paths: [d] }).success;
    expect(withPath('M 1 2 Q 3 4 5 6 L 7 8')).toBe(true);
    expect(withPath('M -1.25 2 l 0.01 0')).toBe(true);
    // Anything that could escape an attribute, or an arc/close the pad never writes.
    expect(withPath('M 1 2" onload="x')).toBe(false);
    expect(withPath('M 1 2 A 3 3 0 0 1 4 4')).toBe(false);
    expect(withPath('M 1 2 Z')).toBe(false);
    expect(withPath('')).toBe(false);
  });

  it('refuses a typed signature that is only whitespace', () => {
    expect(
      SignatureVector.safeParse({ v: 1, kind: 'typed', width: 1, height: 1, text: '   ' }).success,
    ).toBe(false);
  });
});

describe('signatureVectorSvg', () => {
  it('draws the strokes as paths on the canvas the pad used', () => {
    const svg = signatureVectorSvg(drawn)!;
    expect(svg).toContain('viewBox="0 0 600 200"');
    expect(svg).toContain('<path d="M 10 20 Q 11.5 22 13 24 L 30 40"/>');
    expect(svg.match(/<path /g)).toHaveLength(2);
  });

  it('is null for a typed signature, whose picture is the artefact', () => {
    expect(
      signatureVectorSvg({ v: 1, kind: 'typed', width: 600, height: 200, text: 'Anna' }),
    ).toBeNull();
  });
});

import { z } from 'zod';

/**
 * A signature's strokes, carried inside the signature's own PNG.
 *
 * ## Why inside the PNG
 *
 * A signature answer is a storage key, and the bytes behind it are a PNG in the private store —
 * `definition.ts` explains why, and none of it changes. What `docs/adr/0009-where-signing-lives.md`
 * adds is that the mark should also exist as **vector**, so a sealed PDF can draw it crisply at any
 * size rather than scaling a 600×200 bitmap.
 *
 * Putting the strokes in a PNG text chunk (`iTXt`, the UTF-8 one) gets that without touching
 * anything else: the answer is still one key, the export is still one filename, access control
 * and retention are still the upload's, and — the part that matters for signing — **the content
 * hash that already names the file covers the strokes too.** A separate strokes record would be a
 * second thing to keep in step with the first, and a place for the two to disagree.
 *
 * Every PNG reader ignores a text chunk it does not know, so the image is unchanged for everybody
 * who only wants the picture.
 *
 * ## What is recorded, and what deliberately is not
 *
 * Geometry only: the path outlines, rounded to hundredths of a canvas pixel. **No timing, no
 * velocity, no pressure, no pointer type.** Those are what turn a handwritten signature into
 * biometric data under GDPR Art. 4(14) and Art. 9, and this product should not start collecting a
 * special category as a side effect of a nicer pen. The schema is `strict`, so a field like `t` or
 * `pressure` is a parse failure rather than something that quietly rides along.
 *
 * A typed signature records the text, which is already legible in the picture. It carries no
 * paths: its vector form is the name.
 */

/** The iTXt keyword. Namespaced so it cannot be mistaken for one a camera or editor writes. */
export const SIGNATURE_VECTOR_KEYWORD = 'loppa:signature';

/** Well above any signature somebody draws, well below anything worth hiding in one. */
export const SIGNATURE_VECTOR_MAX_BYTES = 128 * 1024;

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;

/**
 * The only path shape the pad produces (`pathFrom`, below): a move, then quadratic
 * curves and line segments, or the tiny relative line that makes a tap into a dot.
 *
 * Deliberately narrow. This string ends up inside an SVG in a PDF, so anything outside the grammar
 * the pad writes is refused rather than escaped. Each repetition starts with a separator the
 * previous one cannot consume, so the expression is linear in the input.
 */
const PATH_DATA = new RegExp(String.raw`^M ${NUMBER} ${NUMBER}(?: [QLl](?: ${NUMBER})+)*$`);

const PathData = z.string().min(1).max(20_000).regex(PATH_DATA);

const Canvas = {
  v: z.literal(1),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
};

export const SignatureVector = z.discriminatedUnion('kind', [
  z
    .object({ ...Canvas, kind: z.literal('drawn'), paths: z.array(PathData).min(1).max(500) })
    .strict(),
  z
    .object({ ...Canvas, kind: z.literal('typed'), text: z.string().trim().min(1).max(200) })
    .strict(),
]);
export type SignatureVector = z.infer<typeof SignatureVector>;

export type SignatureVectorRead =
  | { ok: true; vector: SignatureVector | null }
  | { ok: false; reason: 'not-png' | 'malformed' | 'duplicate' | 'too-large' | 'invalid' };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Returns a copy of `png` with the strokes in an `iTXt` chunk just before `IEND`.
 *
 * Refuses a PNG that already carries one, rather than choosing which to keep: two sets of strokes
 * in one signature is a question, not something to resolve silently.
 */
export function embedSignatureVector(
  png: Uint8Array,
  vector: SignatureVector,
): Uint8Array<ArrayBuffer> {
  const parsed = SignatureVector.parse(vector);
  const existing = readSignatureVector(png);
  if (!existing.ok) throw new Error(`Not a PNG this can extend: ${existing.reason}`);
  if (existing.vector) throw new Error('This PNG already carries a signature vector');

  const data = concat([
    latin1(SIGNATURE_VECTOR_KEYWORD),
    // Null separator, compression flag 0, compression method 0, empty language tag and
    // translated keyword, each null-terminated.
    new Uint8Array([0, 0, 0, 0, 0]),
    new TextEncoder().encode(JSON.stringify(parsed)),
  ]);
  if (data.byteLength > SIGNATURE_VECTOR_MAX_BYTES) {
    throw new Error('The signature vector is larger than a signature can be');
  }

  const chunk = makeChunk('iTXt', data);
  const iend = findChunk(png, 'IEND');
  if (iend === null) throw new Error('Not a PNG this can extend: malformed');
  return concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

/**
 * The strokes in `png`, `null` if it carries none, or why it cannot be trusted.
 *
 * Walks the chunk list with every length checked against the buffer, verifies the CRC of the
 * chunk it reads, and parses the JSON through the strict schema. A PNG with no vector is fine —
 * every signature made before this existed is one.
 */
export function readSignatureVector(png: Uint8Array): SignatureVectorRead {
  if (png.byteLength < 8 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) {
    return { ok: false, reason: 'not-png' };
  }

  let found: Uint8Array | null = null;
  let offset = 8;
  while (offset < png.byteLength) {
    if (offset + 12 > png.byteLength) return { ok: false, reason: 'malformed' };
    const length = readUint32(png, offset);
    const end = offset + 12 + length;
    if (end > png.byteLength) return { ok: false, reason: 'malformed' };

    const type = latin1Decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);

    if (type === 'iTXt' && startsWithKeyword(data)) {
      if (found) return { ok: false, reason: 'duplicate' };
      if (length > SIGNATURE_VECTOR_MAX_BYTES) return { ok: false, reason: 'too-large' };
      const crc = readUint32(png, offset + 8 + length);
      if (crc32(png.subarray(offset + 4, offset + 8 + length)) !== crc) {
        return { ok: false, reason: 'malformed' };
      }
      found = data;
    }

    if (type === 'IEND') break;
    offset = end;
  }

  if (!found) return { ok: true, vector: null };

  const header = SIGNATURE_VECTOR_KEYWORD.length + 5;
  // Compression flag must be 0: a compressed chunk here is not one the pad wrote.
  if (found[SIGNATURE_VECTOR_KEYWORD.length + 1] !== 0) return { ok: false, reason: 'invalid' };
  if (found[header - 3] !== 0 || found[header - 2] !== 0 || found[header - 1] !== 0) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(found.subarray(header)),
    );
    const parsed = SignatureVector.safeParse(json);
    return parsed.success ? { ok: true, vector: parsed.data } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * A drawn signature as standalone SVG, for a document renderer. `null` for a typed one, whose
 * picture is already the right artefact.
 *
 * Safe to inline because every path has passed {@link PATH_DATA}: digits, spaces, `M`, `Q`, `L`
 * and `l`, nothing else. The ink is near-black for the reason `SignaturePad.tsx` gives — a
 * signature is a mark on a document, not decoration, and never takes the brand colour.
 */
export function signatureVectorSvg(vector: SignatureVector): string | null {
  if (vector.kind !== 'drawn') return null;
  const paths = vector.paths
    .filter((d) => PATH_DATA.test(d))
    .map((d) => `<path d="${d}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vector.width} ${vector.height}" ` +
    `preserveAspectRatio="xMidYMid meet" fill="none" stroke="#111111" stroke-width="3" ` +
    `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  );
}

function startsWithKeyword(data: Uint8Array): boolean {
  const keyword = latin1(SIGNATURE_VECTOR_KEYWORD);
  if (data.byteLength <= keyword.byteLength || data[keyword.byteLength] !== 0) return false;
  return keyword.every((byte, index) => data[index] === byte);
}

function findChunk(png: Uint8Array, wanted: string): number | null {
  let offset = 8;
  while (offset + 12 <= png.byteLength) {
    const length = readUint32(png, offset);
    if (latin1Decode(png.subarray(offset + 4, offset + 8)) === wanted) return offset;
    offset += 12 + length;
  }
  return null;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = latin1(type);
  const out = new Uint8Array(12 + data.byteLength);
  writeUint32(out, 0, data.byteLength);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeUint32(out, 8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as the PNG specification defines it (ISO 3309 / ITU-T V.42). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

function latin1Decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** A point on the pad, in viewBox units. */
export interface PadPoint {
  x: number;
  y: number;
}

/**
 * Points to a path, smoothed through the midpoints.
 *
 * Joining raw samples with `L` gives visible corners wherever the pointer reported a position,
 * which on a slow device is every few millimetres — handwriting comes out looking like a
 * seismograph. Curving through the midpoint of each pair is the standard fix: it costs one
 * quadratic per sample and the result reads as a hand.
 */
export function pathFrom(points: readonly PadPoint[]): string {
  const first = points[0];
  if (!first) return '';
  // A tap is a dot. Without this it would be an empty path and the mark would simply not appear.
  if (points.length === 1) return `M ${round(first.x)} ${round(first.y)} l 0.01 0`;

  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    d += ` Q ${round(point.x)} ${round(point.y)} ${round(midX)} ${round(midY)}`;
  }
  const last = points[points.length - 1];
  if (last) d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

/** Two decimals is finer than any screen resolves, and keeps a long drawing out of the megabytes. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

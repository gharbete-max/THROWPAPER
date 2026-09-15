import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_THRESHOLD,
  compressPayload,
  negotiateEncoding,
  worthCompressing,
} from './fallback-compression.js';

/**
 * The negotiation behind the responses `@fastify/compress` cannot reach — see the module for why
 * there is a second path at all. Tested here rather than only through the server because the
 * decisions are small, total, and much cheaper to pin down one at a time than through `inject`.
 */
describe('choosing an encoding', () => {
  it('prefers brotli when the client takes both', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('br');
  });

  it('falls back to gzip when brotli is not offered', () => {
    expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
  });

  it('reads a header with quality weights on it', () => {
    expect(negotiateEncoding('br;q=1.0, gzip;q=0.8')).toBe('br');
  });

  /**
   * Anything unrecognised is sent uncompressed, which is always correct rather than merely
   * acceptable. `identity` is the header a client sends to say exactly that.
   */
  it.each([
    ['nothing at all', undefined],
    ['identity', 'identity'],
    ['an encoding this does not speak', 'zstd'],
    ['an empty header', ''],
  ])('sends %s uncompressed', (_name, header) => {
    expect(negotiateEncoding(header)).toBeNull();
  });
});

describe('deciding whether it is worth it', () => {
  const big = COMPRESSION_THRESHOLD + 1;

  it('compresses a rendered page', () => {
    expect(worthCompressing('text/html; charset=utf-8', big)).toBe(true);
  });

  it('compresses an API response', () => {
    expect(worthCompressing('application/json; charset=utf-8', big)).toBe(true);
  });

  /**
   * The mark's WebP loops, the PNG icons, the woff2 subsets and a rendered PDF are already
   * compressed. Deflating them again spends CPU to produce slightly *more* bytes.
   */
  it.each(['image/webp', 'image/png', 'font/woff2', 'application/pdf'])(
    'leaves %s alone',
    (type) => {
      expect(worthCompressing(type, big)).toBe(false);
    },
  );

  it('leaves a payload under the threshold alone', () => {
    expect(worthCompressing('text/html', COMPRESSION_THRESHOLD - 1)).toBe(false);
  });

  it('leaves a response with no content type alone', () => {
    expect(worthCompressing(undefined, big)).toBe(false);
  });
});

describe('compressing', () => {
  /** A page's worth of prose, so the output is smaller than the input rather than larger. */
  const page = Buffer.from(`<p>${'the door is a mode '.repeat(200)}</p>`, 'utf8');

  it('round-trips through brotli', () => {
    const compressed = compressPayload(page, 'br');
    expect(compressed.length).toBeLessThan(page.length);
    expect(brotliDecompressSync(compressed).toString('utf8')).toBe(page.toString('utf8'));
  });

  it('round-trips through gzip', () => {
    const compressed = compressPayload(page, 'gzip');
    expect(compressed.length).toBeLessThan(page.length);
    expect(gunzipSync(compressed).toString('utf8')).toBe(page.toString('utf8'));
  });

  /**
   * Multi-byte characters are the reason the caller hands this a `Buffer` rather than a string:
   * every page the site serves in Swedish, German or Japanese is one, and a length taken in
   * characters rather than bytes is a truncated page.
   */
  it('round-trips text that is not ASCII', () => {
    const swedish = Buffer.from(`<p>${'Anmälan till Vårmötet — kör på. '.repeat(80)}</p>`, 'utf8');
    expect(brotliDecompressSync(compressPayload(swedish, 'br')).toString('utf8')).toBe(
      swedish.toString('utf8'),
    );
  });
});

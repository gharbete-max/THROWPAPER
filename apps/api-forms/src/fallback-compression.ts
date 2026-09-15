import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Compression for the responses `@fastify/compress` cannot reach.
 *
 * The plugin attaches its work **per route**, through an `onRoute` hook: every registered route
 * gets a compressing `onSend` of its own, and anything that is not a route gets nothing. The
 * not-found handler is not a route — `@fastify/static` already owns `/*`, which is the whole
 * reason the fallback lives in `setNotFoundHandler` rather than in a wildcard of its own — so the
 * plugin never sees it.
 *
 * That is not a corner. Everything this product server-renders goes down that path: the public
 * site, a form's link preview, an invoice, the white-labelled shell. Registering the plugin and
 * stopping there compresses the API and the static bundles and silently leaves the 20 KB landing
 * page — the one page a search engine reads — uncompressed, which is the half that was measured
 * and the half that motivated the work.
 *
 * So this is deliberately narrow: it is the negotiation and nothing else, for payloads that are
 * already strings or buffers in memory. Streams are left to the plugin, which does them properly.
 */

/**
 * The `Content-Type` values worth spending CPU on.
 *
 * Checked as a prefix so `text/html; charset=utf-8` matches. Everything absent from this list is
 * left alone, which is the right default: the mark's WebP loops, the PNG icons, the woff2 subsets
 * and a rendered PDF are all already compressed, and deflating them again spends time to produce
 * slightly more bytes than it started with.
 */
const COMPRESSIBLE = [
  'text/html',
  'text/css',
  'text/plain',
  'text/xml',
  'application/json',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
];

/**
 * Below this, compression costs more than it saves.
 *
 * 1024 bytes, which is `@fastify/compress`'s own default — the two paths should not disagree
 * about what is worth compressing just because one of them is ours.
 */
export const COMPRESSION_THRESHOLD = 1024;

export type Encoding = 'br' | 'gzip';

/**
 * What the client will accept, preferring brotli, or `null` for "send it as it is".
 *
 * Deliberately does not parse `q` weights. The header this has to read in practice is a browser's,
 * and every browser in use sends `gzip, deflate, br` or a permutation without weights; a client
 * that sends `br;q=0` is asking for something this function would get wrong, so it is matched on
 * the explicit token only and anything unrecognised falls through to `null` — uncompressed, which
 * is always correct, never merely acceptable.
 */
export function negotiateEncoding(header: string | undefined): Encoding | null {
  if (!header) return null;
  const offered = header.split(',').map((part) => part.trim().split(';')[0]?.toLowerCase());
  if (offered.includes('br')) return 'br';
  if (offered.includes('gzip')) return 'gzip';
  return null;
}

/** Whether a payload of this type and size is worth compressing at all. */
export function worthCompressing(contentType: string | undefined, size: number): boolean {
  if (size < COMPRESSION_THRESHOLD) return false;
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return COMPRESSIBLE.some((candidate) => type.startsWith(candidate));
}

/**
 * Brotli at quality 5, not zlib's default of 11.
 *
 * These pages are built per request, so quality is a latency decision as much as a size one.
 * Measured on the real 20,085-byte landing page:
 *
 * ```
 * gzip level 6   4,799 bytes
 * brotli q4      4,813 bytes    0.99 ms
 * brotli q5      4,456 bytes    1.49 ms
 * brotli q7      4,399 bytes    4.66 ms
 * brotli q11     3,773 bytes   25.50 ms
 * ```
 *
 * q4 — which is `@fastify/compress`'s default — is the one setting that would have been actively
 * wrong here: it produces *more* bytes than gzip, and brotli is what every modern browser gets
 * offered first, so the preferred encoding would have been the worse one. q5 beats gzip by 7% for
 * half a millisecond. q11 buys another 15% for twenty-four, which is the wrong trade for a page
 * somebody is waiting on; it would be the right one for an asset compressed once at build time.
 *
 * Exported so `server.ts` can hand the same number to `@fastify/compress`. The two paths cover
 * different halves of the same site, and a visitor should not get a different page depending on
 * which one served it.
 */
export const BROTLI_QUALITY = 5;
export function compressPayload(payload: Buffer, encoding: Encoding): Buffer {
  return encoding === 'br'
    ? brotliCompressSync(payload, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: payload.length,
        },
      })
    : gzipSync(payload, { level: 6 });
}

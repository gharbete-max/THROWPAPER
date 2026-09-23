/** Large enough for a scanned contract, small enough that one request cannot fill the disk. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type FetchRefusal = 'origin-not-allowed' | 'fetch-failed' | 'too-large' | 'not-a-pdf';

/**
 * Fetches the caller's document, once (CONTRACT §5.1).
 *
 * Sign makes this request on the caller's say-so, which is the shape of a server-side request
 * forgery: point it at `http://169.254.169.254/` or an admin port and Sign fetches it. So the URL's
 * origin must be one this caller's service token lists, redirects are refused (an allowed origin
 * must not be a doorway to another), and the body is capped and must be a PDF.
 */
export async function fetchDocument(
  url: string,
  allowedOrigins: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: FetchRefusal }> {
  if (!originAllowed(url, allowedOrigins)) return { ok: false, reason: 'origin-not-allowed' };

  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, reason: 'fetch-failed' };
  }
  if (!response.ok) return { ok: false, reason: 'fetch-failed' };
  if (Number(response.headers.get('content-length') ?? 0) > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  // ponytail: buffers the whole body before the cap; stream with a running count if an allowed
  // origin ever needs to be treated as hostile rather than merely mistaken.
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'too-large' };
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    return { ok: false, reason: 'not-a-pdf' };
  }
  return { ok: true, bytes };
}

/** http(s) only, and the exact origin listed — no suffix matching, no wildcard. */
export function originAllowed(url: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  return allowedOrigins.includes(parsed.origin);
}

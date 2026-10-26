import { WeightsError, fetchChecked } from '../ai/download.js';

/**
 * A small answer from the network, as text: the releases list, a SHA256SUMS file, `PACK.json`.
 *
 * Goes through the same checked fetch as the downloads (https only, the first address and every
 * redirect on the given list, five redirects at most, none followed blindly), sends nothing but
 * the request (no cookies, no credentials, no body, no referrer) and refuses an answer longer
 * than `cap` bytes, counted as it arrives.
 */
export async function fetchText(
  url: string,
  options: {
    fetch: typeof fetch;
    allowHost: (host: string) => boolean;
    cap: number;
    signal?: AbortSignal;
    accept?: string;
  },
): Promise<string> {
  const response = await fetchChecked(
    url,
    {
      headers: { Accept: options.accept ?? 'text/plain', 'User-Agent': 'Loppa' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      ...(options.signal ? { signal: options.signal } : {}),
    },
    { fetch: options.fetch, allowHost: options.allowHost },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.length;
    if (seen > options.cap) {
      await reader.cancel().catch(() => undefined);
      throw new WeightsError('size', `the answer is longer than ${options.cap} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The server answered, with a status that is not success. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`the server answered ${status}`);
    this.name = 'HttpError';
  }
}

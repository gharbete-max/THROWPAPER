import { describe, expect, it } from 'vitest';
import { fetchDocument, MAX_DOCUMENT_BYTES } from './fetch-document.js';

const ORIGIN = 'https://forms.example.test';

/** A body of `megabytes` one-megabyte chunks, no Content-Length, counting how many were pulled. */
function endless(megabytes: number) {
  const state = { pulled: 0 };
  const chunk = new Uint8Array(1024 * 1024).fill(0x20);
  chunk.set(new TextEncoder().encode('%PDF-'));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      if (state.pulled > megabytes) controller.close();
      else controller.enqueue(chunk);
    },
  });
  return { state, fetch: (async () => new Response(body)) as unknown as typeof fetch };
}

describe('fetching the caller’s document', () => {
  it('stops reading at the cap instead of buffering what an allowed origin keeps sending', async () => {
    const { state, fetch } = endless(500);
    const result = await fetchDocument(`${ORIGIN}/a.pdf`, [ORIGIN], fetch);
    expect(result).toEqual({ ok: false, reason: 'too-large' });
    // The cap is 25 MB: a few chunks of read-ahead are fine, hundreds are the bug.
    expect(state.pulled).toBeLessThan(MAX_DOCUMENT_BYTES / (1024 * 1024) + 8);
  });

  it('reads a document under the cap whole', async () => {
    const { fetch } = endless(2);
    const result = await fetchDocument(`${ORIGIN}/a.pdf`, [ORIGIN], fetch);
    expect(result.ok && result.bytes.length).toBe(2 * 1024 * 1024);
  });
});

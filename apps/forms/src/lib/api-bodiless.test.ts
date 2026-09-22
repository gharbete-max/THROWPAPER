import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from './api.js';

/**
 * A request with no body must not claim to have a JSON one.
 *
 * `request()` set `content-type: application/json` on everything that was not multipart, including
 * a DELETE or POST with no body at all. Fastify takes that header at its word and answers
 * `400 FST_ERR_CTP_EMPTY_JSON_BODY` — so undo at the door, archive event, trash, restore and
 * delete form, and the brand-kit reset all failed from a browser while every API test passed,
 * because the tests injected without the header. Found by the app-shell critique's undo press
 * that changed nothing, and reproduced with the header through `app.inject`.
 */
function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('a request without a body', () => {
  it('sends no content-type on a bodiless DELETE', async () => {
    const calls = capture();
    await client.undoCheckIn('event-1', 'submission-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBeNull();
  });

  it('sends no content-type on a bodiless POST', async () => {
    const calls = capture();
    await client.archiveEvent('event-1');
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBeNull();
  });

  it('still declares JSON when there is a JSON body', async () => {
    const calls = capture();
    await client.checkIn('event-1', 'ABCD-EFGH');
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json');
  });
});

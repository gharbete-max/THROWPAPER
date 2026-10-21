import { describe, expect, it } from 'vitest';
import { IP_FLOOD_MAX, ipFlood, rateLimitKey } from './rate-limit.js';

const request = (url: string, authorization?: string, ip = '10.0.0.1') => ({
  url,
  ip,
  headers: authorization ? { authorization } : {},
});

describe('who a request is, for rate limiting', () => {
  it('is the signing link, whatever address it comes from', () => {
    const a = rateLimitKey(request('/v1/sign/abc.def/decline', undefined, '1.1.1.1'));
    const b = rateLimitKey(request('/v1/sign/abc.def', undefined, '2.2.2.2'));
    expect(a).toBe(b);
    expect(a.startsWith('sign:')).toBe(true);
    expect(rateLimitKey(request('/api/v1/sign/abc.def'))).toBe(a);
  });

  it('tells two links, and two callers, apart', () => {
    expect(rateLimitKey(request('/v1/sign/one'))).not.toBe(rateLimitKey(request('/v1/sign/two')));
    expect(rateLimitKey(request('/v1/envelopes', 'Bearer a'))).not.toBe(
      rateLimitKey(request('/v1/envelopes', 'Bearer b')),
    );
    expect(rateLimitKey(request('/v1/sealed/tok'))).toMatch(/^sealed:/);
  });

  it('never holds a credential as itself', () => {
    const key = rateLimitKey(request('/v1/envelopes', 'Bearer svc_secret_value'));
    expect(key).not.toContain('svc_secret_value');
    expect(rateLimitKey(request('/v1/sign/secretlink'))).not.toContain('secretlink');
  });

  it('falls back to the address when there is no credential', () => {
    expect(rateLimitKey(request('/s/whatever', undefined, '9.9.9.9'))).toBe('ip:9.9.9.9');
  });
});

describe('the address limiter in front of the link check', () => {
  const run = (hook: ReturnType<typeof ipFlood>, url: string, ip: string, at = 0) => {
    let status = 0;
    let body: unknown;
    const reply = {
      header: () => reply,
      code: (code: number) => {
        status = code;
        return reply;
      },
      send: (payload: unknown) => {
        body = payload;
        return reply;
      },
    };
    const refused = hook({ url, ip }, reply as never, at);
    return { refused, status, body };
  };

  it('refuses an address that floods links, early, and leaves other addresses alone', () => {
    const hook = ipFlood();
    for (let i = 0; i < IP_FLOOD_MAX; i += 1) {
      expect(run(hook, `/v1/sign/forged-${i}`, '203.0.113.9').refused).toBe(false);
    }
    const flood = run(hook, '/v1/sign/forged-next', '203.0.113.9');
    expect(flood.refused).toBe(true);
    expect(flood.status).toBe(429);
    expect(flood.body).toMatchObject({ error: { code: 'rate-limited' } });
    expect(run(hook, '/v1/sign/forged-next', '203.0.113.10').refused).toBe(false);
    // Per route: the same address is still served on the sealed route, and everything else.
    expect(run(hook, '/v1/sealed/x', '203.0.113.9').refused).toBe(false);
    expect(run(hook, '/v1/envelopes', '203.0.113.9').refused).toBe(false);
    // A minute later the window is new.
    expect(run(hook, '/v1/sign/x', '203.0.113.9', 61_000).refused).toBe(false);
  });

  it('never limits the computer itself (the desktop edition)', () => {
    const hook = ipFlood();
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      for (let i = 0; i < IP_FLOOD_MAX + 5; i += 1) {
        expect(run(hook, '/api/v1/sign/x', ip).refused).toBe(false);
      }
    }
  });
});

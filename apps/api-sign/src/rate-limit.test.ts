import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './rate-limit.js';

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

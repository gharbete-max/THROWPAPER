import { describe, expect, it } from 'vitest';
import { redactSecretsInUrl } from './log-redaction.js';

/**
 * Several of this app's URLs are the credential, and the URL is logged on every request.
 *
 * Fastify's default serializer emits `{method, url, …}`. Bodies and headers never reach the log,
 * so the bearer token was always safe — but the tokens that travel in a *path* were being written
 * in cleartext on every hit and kept for as long as the log is kept. These tests pin both halves:
 * secrets go, and the ordinary URLs that make a log useful stay readable.
 */
describe('what reaches the log', () => {
  it.each([
    ['an invoice token', '/i/de120100000000000000000000000000'],
    ['an invoice PDF token', '/i/de120100000000000000000000000000/pdf'],
    ['a resume token', '/public/forms/varmotet/resume/a1b2c3d4e5f60718293a4b5c6d7e8f90'],
    ['a signed download', '/v1/documents/download?signature=9f8e7d6c5b4a39281706'],
    ['a token query parameter', '/v1/auth/callback?token=short-but-secret'],
  ])('redacts %s', (_case, url) => {
    const redacted = redactSecretsInUrl(url);

    expect(redacted).toContain('[redacted]');
    // The secret itself must not survive in any form long enough to replay.
    expect(redacted).not.toContain('de120100000000000000000000000000');
    expect(redacted).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(redacted).not.toContain('9f8e7d6c5b4a39281706');
    expect(redacted).not.toContain('short-but-secret');
  });

  /**
   * A log nobody can read is not a safer log, it is an unused one. These are the URLs an operator
   * actually greps for during an incident, and none of them is a secret.
   */
  it.each([
    '/v1/forms',
    '/public/forms/varmotet',
    '/public/forms/varmotet-2026',
    '/v1/events/11111111-1111-4111-8111-111111111111',
    '/v1/forms?scope=mine',
    '/healthz',
  ])('leaves %s alone', (url) => {
    expect(redactSecretsInUrl(url)).toBe(url);
  });

  /** Enough of the head survives to tie two lines about one request together. */
  it('keeps a correlatable prefix', () => {
    const redacted = redactSecretsInUrl('/i/de120100000000000000000000000000');
    expect(redacted).toBe('/i/de12[redacted]');
  });

  /** A UUID is an identifier, not a credential — its longest run is 12 characters. */
  it('does not mistake a UUID for a secret', () => {
    const url = '/v1/submissions/22222222-2222-4222-8222-222222222222';
    expect(redactSecretsInUrl(url)).toBe(url);
  });
});

describe('base64url tokens, whole', () => {
  it('redacts a resume token however its dashes fall', async () => {
    const { randomBytes } = await import('node:crypto');
    let leaked = 0;
    for (let i = 0; i < 5000; i += 1) {
      const secret = randomBytes(32).toString('base64url');
      const logged = redactSecretsInUrl(`/public/forms/medlem/resume/${secret}`);
      if (logged.includes(secret.slice(4))) leaked += 1;
    }
    expect(leaked).toBe(0);
  });

  it('catches the audit’s own example, a dash two-thirds of the way in', () => {
    const secret = 'k3JdT9qLmZx2Rw8VbN4pYs1-Hc6GfE0aUo7iKtMnWqX';
    expect(redactSecretsInUrl(`/v1/phone-scan/${secret}`)).toBe('/v1/phone-scan/k3Jd[redacted]');
    expect(redactSecretsInUrl(`/f/medlem?resume=${secret}`)).toBe('/f/medlem?resume=[redacted]');
  });

  it('still leaves UUIDs and long slugs alone', () => {
    const uuid = '3ff75281-4dbf-46ab-bebd-e982a7180530';
    expect(redactSecretsInUrl(`/v1/forms/${uuid}/versions`)).toBe(`/v1/forms/${uuid}/versions`);
    const slug = 'anmalan-till-varmotet-2026-sommarfesten';
    expect(redactSecretsInUrl(`/public/forms/${slug}`)).toBe(`/public/forms/${slug}`);
  });
});

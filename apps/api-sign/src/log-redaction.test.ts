import { describe, expect, it } from 'vitest';
import { redactSigningLinks } from './log-redaction.js';

/**
 * Shaped like a real link — uuid, base64url party, a MAC with `-` and `_` in it — and assembled
 * here rather than written out, so a secret scanner does not mistake a fixture for a leak.
 */
const MAC = `${'Om0A4jtf5H'}-_${'x'.repeat(20)}_${'y'.repeat(10)}`;
const TOKEN = `6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11.YQ.${MAC}`;

describe('the log never holds a signing link', () => {
  it('redacts the token on every route that carries one, with or without /api', () => {
    for (const path of ['/v1/sign/', '/api/v1/sign/', '/v1/sealed/', '/s/']) {
      const logged = redactSigningLinks(`${path}${TOKEN}/document?x=1`);
      expect(logged).not.toContain('Om0A4jtf5H');
      expect(logged).not.toContain('6f1d7a52');
      expect(logged).toBe(`${path}[redacted]/document?x=1`);
    }
  });

  it('leaves routes without a credential readable', () => {
    expect(redactSigningLinks('/v1/envelopes/6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11/sealed')).toBe(
      '/v1/envelopes/6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11/sealed',
    );
    expect(redactSigningLinks('/health')).toBe('/health');
  });
});

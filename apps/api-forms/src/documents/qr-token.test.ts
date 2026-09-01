import { describe, expect, it } from 'vitest';
import { deriveQrKey, signAdmissionToken, verifyAdmissionToken } from './qr-token.js';

const SECRET = 'test-secret-at-least-thirty-two-characters-long';
const key = deriveQrKey(SECRET);
const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';

describe('the admission token', () => {
  it('verifies a token it issued', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    expect(verifyAdmissionToken(token, EVENT, key)).toEqual({ ok: true, reference: 'AB12-CD34' });
  });

  it('carries the reference in the clear, so a broken scanner can be typed around', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    expect(token.startsWith('AB12-CD34.')).toBe(true);
  });

  it('stays short enough to scan on a cheap phone', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    // A dense QR is the failure mode at a door in bad light.
    expect(token.length).toBeLessThanOrEqual(32);
  });

  it('rejects a tampered reference', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    const tampered = token.replace('AB12-CD34', 'ZZ99-ZZ99');
    expect(verifyAdmissionToken(tampered, EVENT, key)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a token minted for another event', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: OTHER_EVENT }, key);
    expect(verifyAdmissionToken(token, EVENT, key).ok).toBe(false);
  });

  it('rejects a token signed with another key', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    const otherKey = deriveQrKey('a-completely-different-secret-value-here');
    expect(verifyAdmissionToken(token, EVENT, otherKey).ok).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', 'AB12-CD34.short']) {
      expect(verifyAdmissionToken(bad, EVENT, key)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('tolerates a scanner that upper-cases and pads', () => {
    const token = signAdmissionToken({ reference: 'AB12-CD34', eventId: EVENT }, key);
    expect(verifyAdmissionToken(`  ${token.toLowerCase()}  `, EVENT, key).ok).toBe(true);
  });
});

describe('key derivation', () => {
  it('is deterministic for a given master secret', () => {
    expect(deriveQrKey(SECRET).equals(deriveQrKey(SECRET))).toBe(true);
  });

  it('does not hand out the master secret — a leaked QR key must not mint access tokens', () => {
    expect(key.toString('utf8')).not.toContain(SECRET);
    expect(key.toString('hex')).not.toBe(Buffer.from(SECRET).toString('hex'));
  });
});

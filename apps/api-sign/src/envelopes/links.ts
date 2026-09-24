import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A party's signing link: `<envelopeId>.<partyId, base64url>.<HMAC>`.
 *
 * Derived rather than stored, so a retried `POST /v1/envelopes` answers with the same links it gave
 * the first time — a hashed random token can be checked but never handed out twice. The HMAC is
 * what makes it unguessable; rotating `SIGN_LINK_SECRET` revokes every link at once.
 */
export function signToken(secret: string, envelopeId: string, partyId: string): string {
  return `${envelopeId}.${Buffer.from(partyId).toString('base64url')}.${mac(secret, envelopeId, partyId)}`;
}

export function readToken(
  secret: string,
  token: string,
): { envelopeId: string; partyId: string } | null {
  const [envelopeId, encoded, given, extra] = token.split('.');
  if (!envelopeId || !encoded || !given || extra !== undefined) return null;
  if (!/^[0-9a-f-]{36}$/.test(envelopeId)) return null;
  const partyId = Buffer.from(encoded, 'base64url').toString();
  const expected = Buffer.from(mac(secret, envelopeId, partyId));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { envelopeId, partyId };
}

/**
 * A §5.3 download link: `<envelopeId>.<expiry, unix seconds>.<HMAC>`. Short-lived by construction
 * — the expiry is inside the MAC, so it cannot be extended — and domain-separated from signing
 * links, so neither kind of token can be passed off as the other.
 */
export function sealedToken(secret: string, envelopeId: string, expiresAt: Date): string {
  const expiry = Math.floor(expiresAt.getTime() / 1000).toString();
  return `${envelopeId}.${expiry}.${sealedMac(secret, envelopeId, expiry)}`;
}

export function readSealedToken(secret: string, token: string, now: Date): string | null {
  const [envelopeId, expiry, given, extra] = token.split('.');
  if (!envelopeId || !expiry || !given || extra !== undefined) return null;
  if (!/^[0-9a-f-]{36}$/.test(envelopeId) || !/^\d{1,12}$/.test(expiry)) return null;
  const expected = Buffer.from(sealedMac(secret, envelopeId, expiry));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  if (Number(expiry) * 1000 <= now.getTime()) return null;
  return envelopeId;
}

function sealedMac(secret: string, envelopeId: string, expiry: string): string {
  return createHmac('sha256', secret)
    .update(`sealed\0${envelopeId}\0${expiry}`)
    .digest('base64url');
}

function mac(secret: string, envelopeId: string, partyId: string): string {
  return createHmac('sha256', secret).update(`${envelopeId}\0${partyId}`).digest('base64url');
}

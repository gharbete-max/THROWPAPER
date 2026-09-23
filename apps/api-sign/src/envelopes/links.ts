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

function mac(secret: string, envelopeId: string, partyId: string): string {
  return createHmac('sha256', secret).update(`${envelopeId}\0${partyId}`).digest('base64url');
}

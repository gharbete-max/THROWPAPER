import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * The respondent's receipt for their own finished document.
 *
 * Somebody who has just sent a form has no account, no session and never will. What lets them
 * download the PDF of what they wrote — and nobody else's — is this token, handed back in the
 * submit response and nowhere else:
 *
 * - **Bound to one submission.** The id is inside the signed payload, so a token for one person's
 *   answers cannot be pointed at another's. A reference alone is never enough: it is eight
 *   characters printed on a card, read aloud at a door, and quoted in email.
 * - **Short-lived.** A day. It exists for the minutes after sending, and for a tab left open
 *   overnight; it is not a permanent link to somebody's answers.
 * - **Its own key.** Derived from `DOCUMENT_SIGNING_SECRET` under a purpose label, so it can never
 *   verify as a download link, an admission QR or a session — nor any of those as it.
 *
 * Shape: `<submissionId>.<expiresAtSeconds>.<base64url HMAC-SHA256>`.
 */
const HKDF_INFO = 'throwpaper/finished-document/v1';

/** One day. Long enough for a tab left open, short enough not to be a standing link. */
export const FINISHED_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function deriveFinishedKey(documentSigningSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(documentSigningSecret),
      Buffer.alloc(0),
      Buffer.from(HKDF_INFO),
      32,
    ),
  );
}

export function signFinishedToken(
  submissionId: string,
  key: Buffer,
  now: Date = new Date(),
  ttlSeconds = FINISHED_TOKEN_TTL_SECONDS,
): string {
  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds;
  return `${submissionId}.${expires}.${mac(submissionId, expires, key)}`;
}

export type FinishedTokenFailure = 'malformed' | 'bad-signature' | 'expired';

export function verifyFinishedToken(
  token: string,
  key: Buffer,
  now: Date = new Date(),
): { ok: true; submissionId: string } | { ok: false; reason: FinishedTokenFailure } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [submissionId, expiresText, provided] = parts as [string, string, string];
  if (!UUID.test(submissionId) || !/^\d{1,12}$/.test(expiresText) || provided.length !== 43) {
    return { ok: false, reason: 'malformed' };
  }

  const expires = Number(expiresText);
  const expected = Buffer.from(mac(submissionId, expires, key));
  const given = Buffer.from(provided);
  // Signature before expiry, so a forged token learns nothing from which answer it gets.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }
  if (expires * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, submissionId };
}

function mac(submissionId: string, expires: number, key: Buffer): string {
  return createHmac('sha256', key).update(`${submissionId}\n${expires}`).digest('base64url');
}

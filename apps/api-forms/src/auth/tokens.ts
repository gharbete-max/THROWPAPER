import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@tp/shared/api';

/**
 * Access tokens are short-lived JWTs; refresh tokens are opaque and stored hashed.
 *
 * Bearer + refresh rather than cookie-only (CLAUDE.md rule 3), so the mobile clients in the Later
 * section of the roadmap can use this API unchanged.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

const ISSUER = 'throwpaper/api-forms';

export interface AccessTokenClaims {
  userId: string;
  organisationId: string;
  role: Role;
}

/** URL-safe secret. Only the hash of this ever reaches the database. */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time compare, so a token cannot be recovered by timing a series of guesses. */
export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newFamilyId(): string {
  return randomUUID();
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  return new SignJWT({ organisationId: claims.organisationId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

/** Null rather than a throw — an expired or forged token is a 401, not a server error. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
    });
    const userId = payload.sub;
    const organisationId = payload['organisationId'];
    const role = payload['role'];
    if (
      typeof userId !== 'string' ||
      typeof organisationId !== 'string' ||
      (role !== 'admin' && role !== 'operator')
    ) {
      return null;
    }
    return { userId, organisationId, role };
  } catch {
    return null;
  }
}

export function expiryFrom(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

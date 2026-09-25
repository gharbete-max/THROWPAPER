import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Who a request is, for rate limiting: the credential it carries, not the address it came from.
 *
 * Every route here carries one — a signer's link or a sealed link in the path, or a caller's
 * service token in the header. Keying on it limits each link and each caller on its own, and does
 * not depend on the network: behind a TLS terminator every visitor would share one address, and
 * a per-address limit would throttle every signer in every organisation together. A request with
 * no credential (the page itself, a stray path) falls back to its address.
 *
 * Hashed, so no credential sits in the limiter's memory as itself.
 */
export function rateLimitKey(request: Pick<FastifyRequest, 'url' | 'headers' | 'ip'>): string {
  const path = request.url.split('?')[0] ?? '';
  const link = /^\/(?:api\/)?v1\/(sign|sealed)\/([^/]+)/.exec(path);
  if (link) return `${link[1]}:${digest(link[2]!)}`;
  const authorization = request.headers['authorization'];
  if (typeof authorization === 'string' && authorization) return `caller:${digest(authorization)}`;
  return `ip:${request.ip}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

/**
 * Generous for callers, tight where a person acts. A signer signs or declines once; sixty tries a
 * minute on one link is already a script. Forms polls envelope status and fetches sealed files
 * for many envelopes on one token, so a caller gets room.
 */
export const RATE_LIMITS = {
  global: { max: 600, timeWindow: '1 minute' },
  signerAction: { max: 20, timeWindow: '1 minute' },
} as const;

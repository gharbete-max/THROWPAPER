import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

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

/** Requests an address may make a minute to the signer endpoints, before any link is checked. */
export const IP_FLOOD_MAX = 300;
const IP_WINDOW_MS = 60_000;
/** The most addresses remembered; past it the table is cleared rather than grown. */
const IP_TABLE_MAX = 50_000;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SIGNER_ROUTE = /^\/(?:api\/)?v1\/(sign|sealed)\//;

/**
 * A cheap limit per address and per route (`sign`, `sealed`), run before the credential limiter
 * and before the link's HMAC is computed. The credential limiter gives every forged link a bucket
 * of its own, so a flood of forged links was never counted; here it is, by where it comes from.
 * It is generous (a person makes a handful of requests), so a proxy that shows every visitor as one
 * address needs `trustProxy` set or the limit set higher — a deployment decision, as the other.
 * The computer itself is exempt: the desktop edition is loopback-only and its own app is the only
 * caller. In memory, a fixed window; `at` is the clock in milliseconds (tests move it).
 *
 * ponytail: one process, one table; a second instance counts for itself, so share it if scaled out.
 */
export function ipFlood() {
  const table = new Map<string, { count: number; resetAt: number }>();
  return function refuses(
    request: Pick<FastifyRequest, 'url' | 'ip'>,
    reply: Pick<FastifyReply, 'header' | 'code' | 'send'>,
    at = Date.now(),
  ): boolean {
    const route = SIGNER_ROUTE.exec(request.url.split('?')[0] ?? '')?.[1];
    if (!route || LOOPBACK.has(request.ip)) return false;
    const key = `${route}:${request.ip}`;
    let entry = table.get(key);
    if (!entry || at >= entry.resetAt) {
      if (table.size >= IP_TABLE_MAX) table.clear();
      entry = { count: 0, resetAt: at + IP_WINDOW_MS };
      table.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= IP_FLOOD_MAX) return false;
    reply
      .header('retry-after', String(Math.ceil((entry.resetAt - at) / 1000)))
      .code(429)
      .send({
        error: { code: 'rate-limited', message: 'Too many requests. Try again in a minute.' },
      });
    return true;
  };
}

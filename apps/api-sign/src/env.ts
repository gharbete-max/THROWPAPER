import { config } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_SIGN_DATABASE_URL } from './db/client.js';

config({ path: ['.env', '../../.env'] });

const Env = z.object({
  API_SIGN_PORT: z.coerce.number().int().default(4003),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SIGN_DATABASE_URL: z.string().url().default(DEFAULT_SIGN_DATABASE_URL),
  /** Where signers open their links: the apps/sign page. */
  SIGN_PUBLIC_URL: z.string().url().default('http://localhost:5175'),
  /** Where this API is reachable from outside: §5.3 sealed-document links point here. */
  API_SIGN_PUBLIC_URL: z.string().url().default('http://localhost:4003'),
  /** The built signing page (`apps/sign/dist`) to serve from this origin; unset in development. */
  SIGN_SERVE_APP: z.string().optional(),
});

export const env = Env.parse(process.env);

/**
 * The key signing links are derived from. Required, never defaulted: a guessable key would make
 * every signing link in the database guessable. Read only by the server, so the migration and the
 * seed run without it.
 */
export function signLinkSecret(): string {
  const secret = process.env['SIGN_LINK_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('SIGN_LINK_SECRET must be set, at least 32 characters, unique per environment');
  }
  return secret;
}

/**
 * The seal's key and certificate, as PEM. Required, never defaulted, like the link secret: a
 * server that generated its own at boot would seal with a different certificate after every
 * restart. `pnpm --filter @tp/api-sign seal:dev-cert` writes a development pair for local use.
 */
export function sealPems(): { keyPem: string; certPem: string } | 'ephemeral' {
  // For the e2e suite and throwaway runs: a pair made at boot and forgotten at exit. Never in
  // production — seals made with a key nobody kept can be checked only against themselves.
  if (process.env['SIGN_SEAL_EPHEMERAL'] === 'true') {
    if (env.NODE_ENV === 'production') {
      throw new Error('SIGN_SEAL_EPHEMERAL is refused in production; set SIGN_SEAL_KEY/CERT');
    }
    return 'ephemeral';
  }
  const keyPem = process.env['SIGN_SEAL_KEY'];
  const certPem = process.env['SIGN_SEAL_CERT'];
  if (!keyPem || !certPem) {
    throw new Error(
      'SIGN_SEAL_KEY and SIGN_SEAL_CERT must be set (PEM). For development: pnpm --filter @tp/api-sign seal:dev-cert',
    );
  }
  return { keyPem, certPem };
}

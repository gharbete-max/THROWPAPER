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

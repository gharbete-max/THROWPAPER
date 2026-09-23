import Fastify, { type FastifyInstance } from 'fastify';
import { CONTRACT_VERSION } from '@tp/shared';

/**
 * The Sign product's backend (`docs/adr/0009-where-signing-lives.md`).
 *
 * A skeleton on purpose: identity data, evidence and sealed documents will live only here, in a
 * database of its own, and the first route that touches any of them arrives with the tests and the
 * storage that make it safe (P1c). What exists now is what every product has on day one — a health
 * check that says which contract it speaks — and the seam it will sign through
 * (`providers/agreement.ts`, moved from Forms).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' } });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-sign',
    contractVersion: CONTRACT_VERSION,
  }));

  return app;
}

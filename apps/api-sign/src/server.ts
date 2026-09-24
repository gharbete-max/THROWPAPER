import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { CONTRACT_VERSION } from '@tp/shared';
import type { Db } from './db/client.js';
import { registerEnvelopeRoutes } from './routes/envelopes.js';
import { registerSealedRoutes } from './routes/sealed.js';
import { registerSignerRoutes } from './routes/signer.js';
import type { Sealer } from './sealing/certificate.js';

export interface ServerOptions {
  db: Db;
  /** Signing links are derived from this (see `envelopes/links.ts`). */
  linkSecret: string;
  /** Where the apps/sign page is served; signing links point there. */
  publicUrl: string;
  /** Where this API is reachable from outside; §5.3 download links point here. */
  apiUrl: string;
  /** The key and certificate a completed envelope is sealed with (`sealing/certificate.ts`). */
  sealer: Sealer;
  /** Injected so tests fetch documents without a network. */
  fetch?: typeof fetch;
  /** Injected so tests can move time, e.g. past an envelope's expiry. */
  now?: () => Date;
}

/**
 * The Sign product's backend (`docs/adr/0009-where-signing-lives.md`).
 *
 * Two audiences, two kinds of credential: callers of CONTRACT §5 (Forms, or anything else an
 * organisation connects) present a service token; a signer presents only the link they were sent.
 * Identity data, evidence and documents live in Sign's own database and nowhere else.
 */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    // A PDF inline in a request is not a thing §5 does; documents arrive by URL.
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /** One error shape, and nothing internal in it — the same rule as api-forms' handler. */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply
        .code(status)
        .send({ error: { code: 'internal', message: 'Something went wrong. Try again.' } });
    }
    return reply
      .code(status)
      .send({ error: { code: error.code ?? 'bad-request', message: error.message } });
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-sign',
    contractVersion: CONTRACT_VERSION,
  }));

  const deps = {
    db: options.db,
    linkSecret: options.linkSecret,
    publicUrl: options.publicUrl.replace(/\/$/, ''),
    apiUrl: options.apiUrl.replace(/\/$/, ''),
    sealer: options.sealer,
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
  };
  registerEnvelopeRoutes(app, deps);
  registerSignerRoutes(app, deps);
  registerSealedRoutes(app, deps);

  return app;
}

export type Deps = {
  db: Db;
  linkSecret: string;
  publicUrl: string;
  apiUrl: string;
  sealer: Sealer;
  fetch: typeof fetch;
  now: () => Date;
};

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { CONTRACT_VERSION } from '@tp/shared';
import type { Db } from './db/client.js';
import { registerEnvelopeRoutes } from './routes/envelopes.js';
import fastifyStatic from '@fastify/static';
import { redactSigningLinks } from './log-redaction.js';
import { registerSealedRoutes } from './routes/sealed.js';
import { registerSignerRoutes } from './routes/signer.js';
import { registerIdentityRoutes } from './routes/identity.js';
import type { IdentityProvider } from '@tp/signing';
import type { Sealer } from './sealing/certificate.js';
import { createHookDelivery, type HookDelivery } from './envelopes/hooks.js';

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
  /**
   * The built signing page (`apps/sign/dist`), served by this same server — the desktop edition
   * and any single-origin deployment. The page calls `/api/v1/...`; without a proxy in front, the
   * server strips `/api` itself, the same rule api-forms uses.
   */
  serveAppFrom?: string;
  /** §5.4 delivery. Defaults to posting with `fetch`; tests inject a recorder. */
  hooks?: HookDelivery;
  /**
   * §5.6 identity providers (`identity/providers.ts`). Empty — the default — means no e-ID is
   * offered, and §5.6 says so to every caller.
   */
  identity?: readonly IdentityProvider[];
}

/**
 * Headers on everything this server answers. The signing link is a credential in the URL, so
 * `no-referrer` is the one that matters most: nothing the page links to may learn it. The page
 * injects its token stylesheet as a `<style>` element, hence `'unsafe-inline'` for styles only.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

/**
 * The Sign product's backend (`docs/adr/0009-where-signing-lives.md`).
 *
 * Two audiences, two kinds of credential: callers of CONTRACT §5 (Forms, or anything else an
 * organisation connects) present a service token; a signer presents only the link they were sent.
 * Identity data, evidence and documents live in Sign's own database and nowhere else.
 */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const appDir = options.serveAppFrom;
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
      // Signing and sealed links are credentials in the path; see `log-redaction.ts`.
      serializers: {
        req(request: { method: string; url: string; ip?: string }) {
          return {
            method: request.method,
            url: redactSigningLinks(request.url),
            remoteAddress: request.ip,
          };
        },
      },
    },
    // A PDF inline in a request is not a thing §5 does; documents arrive by URL.
    bodyLimit: 1024 * 1024,
    rewriteUrl: appDir
      ? (request) => {
          const url = request.url ?? '/';
          return url.startsWith('/api/') ? url.slice('/api'.length) : url;
        }
      : undefined,
  }).withTypeProvider<ZodTypeProvider>();

  app.addHook('onSend', async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });

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
    hooks:
      options.hooks ??
      createHookDelivery({
        fetch: options.fetch ?? fetch,
        log: (message, detail) => app.log.warn(detail ?? {}, message),
      }),
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
  };
  registerEnvelopeRoutes(app, deps);
  registerSignerRoutes(app, deps);
  registerSealedRoutes(app, deps);
  registerIdentityRoutes(app, { db: options.db, identity: options.identity ?? [] });

  if (appDir) {
    // `cacheControl: false`, or the plugin writes its own header over ours on `sendFile`.
    await app.register(fastifyStatic, {
      root: appDir,
      wildcard: false,
      index: false,
      cacheControl: false,
    });
    // The page is one document: `/s/<token>` and anything else that is not the API gets it, and
    // the page asks the API what the link opens. An unknown API path stays a JSON 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/v1/')) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      }
      return reply.header('cache-control', 'no-store').sendFile('index.html');
    });
  }

  return app;
}

export type Deps = {
  db: Db;
  linkSecret: string;
  publicUrl: string;
  apiUrl: string;
  sealer: Sealer;
  hooks: HookDelivery;
  fetch: typeof fetch;
  now: () => Date;
};

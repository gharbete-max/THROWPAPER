import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { readSealedToken } from '../envelopes/links.js';
import { readSeal, withEnvelope } from '../envelopes/store.js';
import type { Deps } from '../server.js';
import { fail } from './envelopes.js';

/**
 * Where a §5.3 link leads: the sealed bytes. The link is the credential — issued to a caller that
 * held a service token for this envelope's organisation a few minutes ago — so a bad, expired or
 * foreign link answers the same 404 as a missing envelope.
 */
export function registerSealedRoutes(app: FastifyInstance, deps: Deps): void {
  app.withTypeProvider<ZodTypeProvider>().get('/v1/sealed/:token', {
    schema: { tags: ['envelopes'], params: z.object({ token: z.string().min(1).max(200) }) },
    handler: async (request, reply) => {
      const now = deps.now();
      const envelopeId = readSealedToken(deps.linkSecret, request.params.token, now);
      const seal =
        envelopeId &&
        (await withEnvelope(deps, envelopeId, now, (loaded) =>
          loaded.envelope.status === 'completed'
            ? readSeal(deps.db, envelopeId, loaded.trailSha256)
            : Promise.resolve(null),
        ));
      if (!seal) return fail(reply, 404, 'not-found', 'This link does not open anything');
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${envelopeId}.pdf"`)
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(seal.bytes));
    },
  });
}

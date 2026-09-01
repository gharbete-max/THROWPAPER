import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { api } from '@tp/shared';
import type { Repositories } from '../db/repositories/index.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  expiryFrom,
  generateSecret,
  hashSecret,
  newFamilyId,
  signAccessToken,
} from '../auth/tokens.js';

export interface DemoOptions {
  reset: () => void;
  users: Array<{ email: string; role: string }>;
  formSlug: string;
}

/**
 * Routes that exist **only** in demo mode.
 *
 * They are registered from `buildServer` solely when a `demo` option is passed, and that option is
 * only ever constructed by `demo/main.ts`. There is no environment variable that turns these on in
 * a normal server — the structure is the guarantee, not a flag somebody could set by accident.
 */
export function registerDemoRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; demo: DemoOptions; jwtSecret: string },
): void {
  app.get('/demo/info', {
    schema: {
      tags: ['demo'],
      response: {
        200: z.object({
          demo: z.literal(true),
          formSlug: z.string(),
          users: z.array(z.object({ email: z.string(), role: z.string() })),
        }),
      },
    },
    handler: async () => ({
      demo: true as const,
      formSlug: deps.demo.formSlug,
      users: deps.demo.users,
    }),
  });

  /** Puts the dataset back without a restart, for when a demo has been thoroughly poked at. */
  app.post('/demo/reset', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['demo'], response: { 200: z.object({ status: z.literal('reset') }) } },
    handler: async () => {
      deps.demo.reset();
      return { status: 'reset' as const };
    },
  });

  /**
   * Signs in as one of the demo users without the magic link.
   *
   * In demo mode mail goes to an in-memory provider nobody can read, so the real flow is a dead
   * end. This is an authentication bypass and is written as one on purpose: it only accepts the
   * demo users, and the route does not exist unless the server was built in demo mode.
   */
  app.post('/demo/sign-in', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['demo'],
      body: z.object({ email: z.string().email() }),
      response: { 200: api.TokenPair, 403: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const { email } = z.object({ email: z.string().email() }).parse(request.body);

      if (!deps.demo.users.some((user) => user.email === email.toLowerCase())) {
        return reply.code(403).send({
          error: { code: 'not-a-demo-user', message: 'Only the demo users can sign in this way' },
        });
      }

      const organisation = await deps.repos.organisations.first();
      const user = organisation ? await deps.repos.users.findByEmail(organisation.id, email) : null;
      if (!organisation || !user) {
        return reply
          .code(403)
          .send({ error: { code: 'not-a-demo-user', message: 'Demo user not found' } });
      }

      const now = new Date();
      const refreshSecret = generateSecret();
      await deps.repos.tokens.createRefreshToken({
        userId: user.id,
        familyId: newFamilyId(),
        tokenHash: hashSecret(refreshSecret),
        rotatedFrom: null,
        userAgent: request.headers['user-agent'] ?? null,
        expiresAt: expiryFrom(now, REFRESH_TOKEN_TTL_SECONDS),
      });

      return reply.send({
        accessToken: await signAccessToken(
          { userId: user.id, organisationId: user.organisationId, role: user.role },
          deps.jwtSecret,
          now,
        ),
        refreshToken: refreshSecret,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        organisation: {
          id: organisation.id,
          name: organisation.name,
          slug: organisation.slug,
          defaultLocale: organisation.defaultLocale,
          supportedLocales: organisation.supportedLocales,
        },
      });
    },
  });
}

import type { FastifyInstance } from 'fastify';
import { api } from '@tp/shared';
import type { AuthService, IssuedSession } from '../auth/service.js';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';

const { RequestMagicLink, ExchangeToken, RefreshRequest, LogoutRequest } = api;

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { auth: AuthService; guard: AuthGuardDeps },
): void {
  app.post('/v1/auth/magic-link', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: {
      tags: ['auth'],
      body: RequestMagicLink,
      response: { 202: api.RequestMagicLinkResponse },
    },
    handler: async (request, reply) => {
      const body = RequestMagicLink.parse(request.body);
      await deps.auth.requestMagicLink({
        email: body.email.toLowerCase(),
        redirectTo: body.redirectTo,
        ip: request.ip,
      });
      // Always 202. Whether the address exists is not this endpoint's business to reveal.
      return reply.code(202).send({ status: 'sent' as const });
    },
  });

  app.post('/v1/auth/token', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      tags: ['auth'],
      body: ExchangeToken,
      response: { 200: api.TokenPair, 401: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const body = ExchangeToken.parse(request.body);
      const result = await deps.auth.exchange(body.token, request.headers['user-agent'] ?? null);
      if (!result.ok) {
        return reply.code(401).send({
          error: {
            code: `magic-link-${result.reason}`,
            message: 'This sign-in link is no longer valid',
          },
        });
      }
      return reply.send(toTokenPair(result.session));
    },
  });

  app.post('/v1/auth/refresh', {
    schema: {
      tags: ['auth'],
      body: RefreshRequest,
      response: { 200: api.TokenPair, 401: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const body = RefreshRequest.parse(request.body);
      const result = await deps.auth.refresh(
        body.refreshToken,
        request.headers['user-agent'] ?? null,
      );
      if (!result.ok) {
        return reply.code(401).send({
          error: { code: `refresh-${result.reason}`, message: 'Please sign in again' },
        });
      }
      return reply.send(toTokenPair(result.session));
    },
  });

  app.post('/v1/auth/logout', {
    schema: { tags: ['auth'], body: LogoutRequest },
    handler: async (request, reply) => {
      const body = LogoutRequest.parse(request.body);
      await deps.auth.logout(body.refreshToken);
      return reply.code(204).send();
    },
  });

  app.get('/v1/me', {
    preHandler: requireAuth(deps.guard),
    schema: { tags: ['auth'], response: { 200: api.MeResponse, 401: api.ErrorResponse } },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
      }
      return reply.send({
        user: toSessionUser(auth.user),
        organisation: toOrganisation(auth.organisation),
      });
    },
  });
}

function toTokenPair(session: IssuedSession) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    user: toSessionUser(session.user),
    organisation: toOrganisation(session.organisation),
  };
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
}) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function toOrganisation(organisation: {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  supportedLocales: string[];
}) {
  return {
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    defaultLocale: organisation.defaultLocale,
    supportedLocales: organisation.supportedLocales,
  };
}

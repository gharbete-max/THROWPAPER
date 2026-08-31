import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@tp/shared/api';
import type { OrganisationRecord, Repositories, UserRecord } from '../db/repositories/index.js';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { user: UserRecord; organisation: OrganisationRecord };
  }
}

export interface AuthGuardDeps {
  repos: Repositories;
  jwtSecret: string;
}

/**
 * Bearer-token guard. `roles` narrows it further; v0.1 has exactly two roles (START-HERE §In
 * scope) and deliberately no permissions matrix — that is A14.
 */
export function requireAuth(deps: AuthGuardDeps, roles?: readonly Role[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) return unauthorised(reply, 'Missing bearer token');

    const claims = await verifyAccessToken(token, deps.jwtSecret);
    if (!claims) return unauthorised(reply, 'Invalid or expired token');

    const user = await deps.repos.users.findById(claims.userId);
    if (!user || user.disabledAt) return unauthorised(reply, 'Invalid or expired token');

    const organisation = await deps.repos.organisations.findById(user.organisationId);
    if (!organisation) return unauthorised(reply, 'Invalid or expired token');

    // The role comes from the database, not the token: a demotion must take effect immediately
    // rather than when the access token happens to expire.
    if (roles && !roles.includes(user.role)) {
      return reply
        .code(403)
        .send({ error: { code: 'forbidden', message: 'Your role does not allow this action' } });
    }

    request.auth = { user, organisation };
  };
}

function unauthorised(reply: FastifyReply, message: string) {
  return reply.code(401).send({ error: { code: 'unauthorised', message } });
}

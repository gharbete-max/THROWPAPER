import type { FastifyRequest } from 'fastify';
import type { Repositories } from './db/repositories/index.js';

/**
 * SPEC-shared.md §Auth: "Full audit log: who changed what, when."
 *
 * Every mutation goes through this one function. A single call site is the only way the log stays
 * true — scattered inserts drift the moment someone adds an endpoint in a hurry.
 */
export async function recordAudit(
  repos: Repositories,
  request: FastifyRequest,
  entry: {
    action: string;
    entityType: string;
    entityId: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const auth = request.auth;
  if (!auth) return;
  await repos.audit.record({
    organisationId: auth.organisation.id,
    actorUserId: auth.user.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: request.ip,
  });
}

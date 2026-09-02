import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api, forms as formSchemas } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { Repositories } from '../db/repositories/index.js';
import { recordAudit } from '../audit.js';
import { toFormResponse } from '../forms/service.js';

/**
 * Administrator support work: who is in the organisation, and what does one of them see.
 *
 * ## Looking at somebody's workspace is not becoming them
 *
 * The obvious way to build "see what they see" is impersonation — mint a session as that user and
 * hand it to the administrator. This does not do that, and the reason is worth writing down:
 *
 * - Every action taken during an impersonated session is recorded as the *user's* action. The
 *   audit log stops being able to answer "who did this", which is the only question it exists for.
 * - An administrator who forgets they are impersonating is one keystroke from editing somebody
 *   else's work while wearing their name.
 * - Ending impersonation cleanly is genuinely hard, and getting it wrong leaves an administrator
 *   holding a session they cannot see the edges of.
 *
 * Instead these are ordinary administrator requests: the administrator's own token, their own
 * name in the audit log, the server answering "here is what that person's workspace contains".
 * It is read-only by construction — there is no write endpoint here at all. An administrator who
 * needs to *change* something uses the ordinary form endpoints, where `admin` access already lets
 * them, and where the log will say it was them.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const adminOnly = requireAuth(deps.guard, ['admin']);

  const errorResponses = {
    401: api.ErrorResponse,
    403: api.ErrorResponse,
    404: api.ErrorResponse,
  } as const;

  const UserParam = z.object({ id: z.string().uuid() });

  /**
   * Everybody in the organisation, with enough numbers beside each name to be useful.
   *
   * The counts are gathered from one pass over the organisation's forms rather than two queries
   * per person: a hundred colleagues would otherwise be two hundred queries to draw one list.
   */
  app.get('/v1/admin/users', {
    preHandler: adminOnly,
    schema: {
      tags: ['admin'],
      response: { 200: formSchemas.UserListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const [people, active, binned] = await Promise.all([
        deps.repos.users.list(auth.organisation.id),
        deps.repos.forms.list(auth.organisation.id, { scope: 'all' }),
        deps.repos.forms.list(auth.organisation.id, { scope: 'trash' }),
      ]);

      const tally = (rows: readonly { ownerUserId: string | null }[]) => {
        const counts = new Map<string, number>();
        for (const row of rows) {
          if (!row.ownerUserId) continue;
          counts.set(row.ownerUserId, (counts.get(row.ownerUserId) ?? 0) + 1);
        }
        return counts;
      };
      const owned = tally(active);
      const trashed = tally(binned);

      return reply.send({
        users: people.map((person) => ({
          id: person.id,
          name: person.name,
          email: person.email,
          role: person.role,
          disabled: person.disabledAt !== null,
          formCount: owned.get(person.id) ?? 0,
          trashCount: trashed.get(person.id) ?? 0,
        })),
      });
    },
  });

  /**
   * One person's workspace, as they see it.
   *
   * `scope` takes the same words the ordinary forms list does, so "their bin" and "their forms"
   * are the same request with a different pile — and the support view can offer exactly the tabs
   * the person themselves has.
   *
   * The `access` on each form is still the **administrator's** access, not the user's: it says
   * what the person reading may do, because that is what the buttons on the page will do. Saying
   * otherwise would be drawing a page that lies about who is holding it.
   */
  app.get('/v1/admin/users/:id/forms', {
    preHandler: adminOnly,
    schema: {
      tags: ['admin'],
      params: UserParam,
      querystring: formSchemas.FormListQuery,
      response: { 200: formSchemas.FormListResponse, ...errorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = UserParam.parse(request.params);
      const { scope } = formSchemas.FormListQuery.parse(request.query);

      const person = await deps.repos.users.findById(id);
      // Checked against the administrator's own organisation, not just existence: a uuid from
      // another tenant must not become a way to read across the boundary.
      if (!person || person.organisationId !== auth.organisation.id) return notFound(reply);

      const records = await deps.repos.forms.list(auth.organisation.id, {
        // `all` on a support view means "everything of theirs", which is `active` for one person,
        // not the organisation's entire catalogue.
        scope: scope === 'all' ? 'active' : scope,
        userId: person.id,
      });

      const [counts, shareCounts, people, ownShares] = await Promise.all([
        deps.repos.submissions.countCompleteByForm(
          auth.organisation.id,
          records.map((record) => record.id),
        ),
        deps.repos.forms.shareCounts(
          auth.organisation.id,
          records.map((record) => record.id),
        ),
        // The owner of a form on somebody's "shared with me" tab is somebody else again, so the
        // names come from the directory rather than from the person being looked at.
        deps.repos.users.list(auth.organisation.id),
        // The visiting administrator's own shares: a form that was also shared with them should
        // say so, rather than reading as one they reached only by privilege.
        deps.repos.forms.sharesForUser(auth.organisation.id, auth.user.id),
      ]);
      const names = new Map(people.map((entry) => [entry.id, entry.name]));
      const ownShareRole = new Map(ownShares.map((share) => [share.formId, share.role]));

      await recordAudit(deps.repos, request, {
        action: 'admin.viewed_user_forms',
        entityType: 'user',
        entityId: person.id,
        after: { scope, count: records.length },
      });

      return reply.send({
        forms: records.map((record) =>
          toFormResponse(record, auth.organisation.supportedLocales, counts[record.id] ?? 0, {
            // The administrator's access, since these are the administrator's buttons — except
            // where they happen to own it themselves, which `accessFor` decides.
            access:
              formSchemas.accessFor({
                userId: auth.user.id,
                userRole: auth.user.role,
                ownerUserId: record.ownerUserId,
              }) ?? 'admin',
            sharedRole: ownShareRole.get(record.id) ?? null,
            ownerName: record.ownerUserId ? (names.get(record.ownerUserId) ?? null) : null,
            shareCount: shareCounts[record.id] ?? 0,
          }),
        ),
      });
    },
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'No such user' } });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

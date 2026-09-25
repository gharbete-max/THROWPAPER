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
  deps: {
    repos: Repositories;
    guard: AuthGuardDeps;
    /** The ordinary magic link, sent to a person the moment they are added (ADR 0002 §3). */
    sendSignInLink: (email: string, ip: string) => Promise<void>;
  },
): void {
  const adminOnly = requireAuth(deps.guard, ['admin']);

  const errorResponses = {
    401: api.ErrorResponse,
    403: api.ErrorResponse,
    404: api.ErrorResponse,
  } as const;

  /** The two ways a well-formed request about a real person can still be refused. */
  const writeErrorResponses = { ...errorResponses, 409: api.ErrorResponse } as const;

  const UserParam = z.object({ id: z.string().uuid() });

  /**
   * A person, in the shape the list already uses.
   *
   * The counts are zero on creation and not recomputed on an update, which is the honest answer
   * for both: a new colleague owns nothing, and changing somebody's role does not move their
   * forms. The list is what reports counts, and it recounts every time it is drawn.
   */
  const summarise = (person: {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'operator';
    disabledAt: Date | null;
  }) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    disabled: person.disabledAt !== null,
    formCount: 0,
    trashCount: 0,
  });

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
   * Adds somebody to the organisation.
   *
   * There is no invitation and no acceptance step, because the product already has a token with
   * an expiry and a single use and it is called a magic link. The account exists from here; the
   * person signs in the ordinary way, at the address given. ADR 0002 records why that is enough
   * and what it costs.
   *
   * No password is set because there are none to set.
   */
  app.post('/v1/admin/users', {
    preHandler: adminOnly,
    schema: {
      tags: ['admin'],
      body: formSchemas.CreateUser,
      response: { 201: formSchemas.UserSummary, ...writeErrorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const body = formSchemas.CreateUser.parse(request.body);

      const person = await deps.repos.users.create({
        organisationId: auth.organisation.id,
        email: body.email,
        name: body.name,
        role: body.role,
      });
      // `null` is the unique index answering, which is a duplicate rather than a failure.
      if (!person) return alreadyHere(reply);

      await recordAudit(deps.repos, request, {
        action: 'user.create',
        entityType: 'user',
        entityId: person.id,
        after: { email: person.email, name: person.name, role: person.role },
      });

      // Their way in: the same single-use, fifteen-minute link the sign-in page sends. Through
      // the configured provider, so the desktop's test mode writes it to the outbox (rule 7).
      // A mail provider that fails does not undo the account: it exists, and a retry would only
      // be told it is "already here". The person can still ask for a link at the sign-in page.
      await deps.sendSignInLink(person.email, request.ip).catch((err: unknown) => {
        request.log.error({ err }, 'the new person’s sign-in link was not sent');
      });

      return reply.code(201).send(summarise(person));
    },
  });

  /**
   * Changes somebody's role, disables them, or re-enables them.
   *
   * The last-administrator guard is **not** here. It lives in the repository, where it can be
   * atomic with the write — checked in the route and written after, two administrators demoting
   * each other in the same moment would both read the other as still in place, both pass, and
   * leave the organisation with none. See `UserUpdateResult`.
   *
   * Disabling rather than deleting, which the schema decided before this endpoint existed: a
   * deleted user orphans every audit row naming them, and the log's only job is to answer who did
   * something.
   */
  app.patch('/v1/admin/users/:id', {
    preHandler: adminOnly,
    schema: {
      tags: ['admin'],
      params: UserParam,
      body: formSchemas.UpdateUser,
      response: { 200: formSchemas.UserSummary, ...writeErrorResponses },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);
      const { id } = UserParam.parse(request.params);
      const changes = formSchemas.UpdateUser.parse(request.body);

      /*
       * Checked against the administrator's own organisation before the write, not only that the
       * row exists. A uuid from another tenant must not become a way to change somebody there —
       * the same boundary the workspace endpoint below draws, for the same reason.
       */
      const person = await deps.repos.users.findById(id);
      if (!person || person.organisationId !== auth.organisation.id) return notFound(reply);

      const before = { role: person.role, disabled: person.disabledAt !== null };
      const result = await deps.repos.users.update(id, changes);

      if (!result.ok) {
        return result.reason === 'last-admin' ? lastAdmin(reply) : notFound(reply);
      }

      const after = { role: result.user.role, disabled: result.user.disabledAt !== null };
      await recordAudit(deps.repos, request, {
        action: 'user.update',
        entityType: 'user',
        entityId: result.user.id,
        before,
        after,
      });

      return reply.send(summarise(result.user));
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

function alreadyHere(reply: FastifyReply) {
  return reply.code(409).send({
    error: { code: 'email-taken', message: 'Somebody with that address is already here' },
  });
}

/**
 * The message names the way out, not just the refusal.
 *
 * "Forbidden" sends an administrator to the database. "Promote another administrator first" is
 * the same refusal with the next step in it, and the next step is one they can take themselves.
 */
function lastAdmin(reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: 'last-admin',
      message: 'Promote another administrator first — an organisation must keep one',
    },
  });
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

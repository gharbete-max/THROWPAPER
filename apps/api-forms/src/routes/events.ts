import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { EventRecord, Repositories } from '../db/repositories/index.js';
import { localeConfigFor, toEventResponse } from '../events/service.js';
import { recordAudit } from '../audit.js';

const IdParam = z.object({ id: z.string().uuid() });

type EventPatchRecord = Partial<Omit<EventRecord, 'id' | 'organisationId' | 'createdAt'>>;

export function registerEventRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const authenticated = requireAuth(deps.guard);
  // Operators run a segment day to day; changing the event record itself is an admin action.
  const adminOnly = requireAuth(deps.guard, ['admin']);

  app.get('/v1/events', {
    preHandler: authenticated,
    schema: {
      tags: ['events'],
      response: { 200: api.EventListResponse, 401: api.ErrorResponse, 403: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const records = await deps.repos.events.list(auth.organisation.id);
      const locales = localeConfigFor(auth.organisation);
      const events = await Promise.all(
        records.map(async (record) =>
          toEventResponse(record, await deps.repos.events.countRegistrations(record.id), locales),
        ),
      );
      return reply.send({ events });
    },
  });

  app.get('/v1/events/:id', {
    preHandler: authenticated,
    schema: {
      tags: ['events'],
      params: IdParam,
      response: {
        200: api.EventResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
        404: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const { id } = IdParam.parse(request.params);
      const record = await deps.repos.events.findById(auth.organisation.id, id);
      if (!record) return notFound(reply);

      return reply.send(
        toEventResponse(
          record,
          await deps.repos.events.countRegistrations(record.id),
          localeConfigFor(auth.organisation),
        ),
      );
    },
  });

  app.post('/v1/events', {
    preHandler: adminOnly,
    schema: {
      tags: ['events'],
      body: api.EventInput,
      response: { 201: api.EventResponse, 401: api.ErrorResponse, 403: api.ErrorResponse },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const body = api.EventInput.parse(request.body);
      const record = await deps.repos.events.create({
        organisationId: auth.organisation.id,
        name: body.name,
        description: body.description ?? {},
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        venueName: body.venueName ?? null,
        venueAddress: body.venueAddress ?? null,
        capacity: body.capacity ?? null,
        registrationClosesAt: body.registrationClosesAt
          ? new Date(body.registrationClosesAt)
          : null,
        status: body.status ?? 'draft',
      });

      await recordAudit(deps.repos, request, {
        action: 'event.created',
        entityType: 'event',
        entityId: record.id,
        after: record,
      });

      return reply.code(201).send(toEventResponse(record, 0, localeConfigFor(auth.organisation)));
    },
  });

  app.patch('/v1/events/:id', {
    preHandler: adminOnly,
    schema: {
      tags: ['events'],
      params: IdParam,
      body: api.EventPatch,
      response: {
        200: api.EventResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
        404: api.ErrorResponse,
        409: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const { id } = IdParam.parse(request.params);
      const body = api.EventPatch.parse(request.body);

      const before = await deps.repos.events.findById(auth.organisation.id, id);
      if (!before) return notFound(reply);
      if (before.status === 'archived') {
        return reply.code(409).send({
          error: { code: 'event-archived', message: 'Restore the event before editing it' },
        });
      }

      const updated = await deps.repos.events.update(auth.organisation.id, id, toPatch(body));
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'event.updated',
        entityType: 'event',
        entityId: id,
        before,
        after: updated,
      });

      return reply.send(
        toEventResponse(
          updated,
          await deps.repos.events.countRegistrations(id),
          localeConfigFor(auth.organisation),
        ),
      );
    },
  });

  /**
   * Archive, not delete. Rule 7 says nothing deletes without a confirmation step, and an event
   * with registrations behind it should never vanish — archiving is reversible and auditable.
   */
  app.post('/v1/events/:id/archive', {
    preHandler: adminOnly,
    schema: {
      tags: ['events'],
      params: IdParam,
      response: {
        200: api.EventResponse,
        401: api.ErrorResponse,
        403: api.ErrorResponse,
        404: api.ErrorResponse,
      },
    },
    handler: async (request, reply) => {
      const auth = request.auth;
      if (!auth) return unauthenticated(reply);

      const { id } = IdParam.parse(request.params);
      const before = await deps.repos.events.findById(auth.organisation.id, id);
      if (!before) return notFound(reply);

      const updated = await deps.repos.events.update(auth.organisation.id, id, {
        status: 'archived',
      });
      if (!updated) return notFound(reply);

      await recordAudit(deps.repos, request, {
        action: 'event.archived',
        entityType: 'event',
        entityId: id,
        before,
        after: updated,
      });

      return reply.send(
        toEventResponse(
          updated,
          await deps.repos.events.countRegistrations(id),
          localeConfigFor(auth.organisation),
        ),
      );
    },
  });
}

function toPatch(body: api.EventPatch): EventPatchRecord {
  const patch: EventPatchRecord = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.startsAt !== undefined) patch.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) patch.endsAt = new Date(body.endsAt);
  if (body.venueName !== undefined) patch.venueName = body.venueName ?? null;
  if (body.venueAddress !== undefined) patch.venueAddress = body.venueAddress ?? null;
  if (body.capacity !== undefined) patch.capacity = body.capacity ?? null;
  if (body.registrationClosesAt !== undefined) {
    patch.registrationClosesAt = body.registrationClosesAt
      ? new Date(body.registrationClosesAt)
      : null;
  }
  if (body.status !== undefined) patch.status = body.status;
  return patch;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'not-found', message: 'Event not found' } });
}

/** The guard already rejects these; this only satisfies the type narrowing. */
function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorised', message: 'Not signed in' } });
}

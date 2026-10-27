import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { api } from '@tp/shared';
import type { AuthGuardDeps } from '../auth/plugin.js';
import { requireAuth } from '../auth/plugin.js';
import type { PersonRecord, Repositories } from '../db/repositories/index.js';

const IdParam = z.object({ id: z.guid() });

const orgId = (request: FastifyRequest) => {
  if (!request.auth) throw new Error('not signed in');
  return request.auth.organisation.id;
};

const toResponse = (person: PersonRecord) => ({
  ...person,
  createdAt: person.createdAt.toISOString(),
});

/** The people list: any signed-in user keeps it, since registering someone is day-to-day work. */
export function registerPeopleRoutes(
  app: FastifyInstance,
  deps: { repos: Repositories; guard: AuthGuardDeps },
): void {
  const preHandler = requireAuth(deps.guard);
  const errors = { 401: api.ErrorResponse, 403: api.ErrorResponse, 404: api.ErrorResponse };

  app.get('/v1/people', {
    preHandler,
    schema: { tags: ['people'], response: { 200: api.PersonListResponse, ...errors } },
    handler: async (request, reply) => {
      const people = await deps.repos.people.list(orgId(request));
      return reply.send({ people: people.map(toResponse) });
    },
  });

  app.post('/v1/people', {
    preHandler,
    schema: {
      tags: ['people'],
      body: api.PersonInput,
      response: { 201: api.PersonResponse, ...errors },
    },
    handler: async (request, reply) => {
      const person = await deps.repos.people.create(
        orgId(request),
        api.PersonInput.parse(request.body),
      );
      return reply.code(201).send(toResponse(person));
    },
  });

  app.put('/v1/people/:id', {
    preHandler,
    schema: {
      tags: ['people'],
      params: IdParam,
      body: api.PersonInput,
      response: { 200: api.PersonResponse, ...errors },
    },
    handler: async (request, reply) => {
      const person = await deps.repos.people.update(
        orgId(request),
        IdParam.parse(request.params).id,
        api.PersonInput.parse(request.body),
      );
      if (!person) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Person not found' } });
      }
      return reply.send(toResponse(person));
    },
  });

  app.delete('/v1/people/:id', {
    preHandler,
    schema: { tags: ['people'], params: IdParam, response: { 204: z.null(), ...errors } },
    handler: async (request, reply) => {
      const removed = await deps.repos.people.remove(
        orgId(request),
        IdParam.parse(request.params).id,
      );
      if (!removed) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Person not found' } });
      }
      return reply.code(204).send(null);
    },
  });
}

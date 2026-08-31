import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from './db/client.js';
import { CONTRACT_VERSION } from '@tp/shared';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' } });

  app.get('/health', async (_request, reply) => {
    let database: 'up' | 'down' = 'down';
    try {
      await sql`select 1`;
      database = 'up';
    } catch (error) {
      app.log.error({ error }, 'health check could not reach the database');
    }
    return reply.code(database === 'up' ? 200 : 503).send({
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'api-forms',
      contractVersion: CONTRACT_VERSION,
      database,
    });
  });

  return app;
}

import Fastify, { type FastifyInstance } from 'fastify';
import { CONTRACT_VERSION } from '@tp/shared';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' } });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-mailer',
    contractVersion: CONTRACT_VERSION,
  }));

  return app;
}

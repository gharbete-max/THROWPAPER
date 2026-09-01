import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { CONTRACT_VERSION } from '@tp/shared';
import { createDrizzleRepositories, type Repositories } from './db/repositories/index.js';
import { createAuthService } from './auth/service.js';
import { createConsoleMailTransport, type MailTransport } from './auth/mail.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFormRoutes } from './routes/forms.js';
import { registerPublicFormRoutes } from './routes/public-forms.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { createPdfRenderer, type PdfRenderer } from './documents/render.js';
import { createLocalDocumentStore, type DocumentStore } from './documents/store.js';
import { ADMISSION_BULK_JOB, createAdmissionBulkHandler } from './documents/admission-service.js';
import { createWorker } from './jobs/worker.js';

export interface ServerOptions {
  /** Injected by the tests; defaults to the Drizzle implementation over Postgres. */
  repos?: Repositories;
  mail?: MailTransport;
  jwtSecret?: string;
  appUrl?: string;
  /** When false, /health does not touch the database. Used by tests with no Postgres. */
  probeDatabase?: boolean;
  /** Injected by tests. Defaults to Playwright Chromium and a local directory. */
  renderer?: PdfRenderer;
  store?: DocumentStore;
  /**
   * The background worker polls on an interval in production. Tests drain it by hand instead, so
   * a job runs exactly when the test says it does.
   */
  startWorker?: boolean;
}

/**
 * The database module is imported lazily and only when no repositories were injected.
 *
 * Importing it eagerly would drag in env.ts, so every test — including ones that pass their own
 * repositories — would need a full production environment to build a server. CI caught exactly
 * that.
 */
async function loadDatabase() {
  const { db, sql } = await import('./db/client.js');
  return { repos: createDrizzleRepositories(db), ping: () => sql`select 1` };
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const database = options.repos ? null : await loadDatabase();
  const repos = options.repos ?? database?.repos;
  if (!repos) throw new Error('no repositories available');

  const mail = options.mail ?? createConsoleMailTransport((message) => app.log.info(message));
  const jwtSecret = options.jwtSecret ?? requireSecret();
  const appUrl = options.appUrl ?? process.env['APP_URL'] ?? 'http://localhost:5173';
  const probeDatabase = options.probeDatabase ?? database !== null;

  await app.register(cors, { origin: appUrl, credentials: false });
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Formwork API', version: '0.1.0' },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });

  const guard = { repos, jwtSecret };
  const auth = createAuthService({ repos, mail, config: { jwtSecret, appUrl } });

  const renderer = options.renderer ?? createPdfRenderer();
  const store =
    options.store ??
    createLocalDocumentStore({
      directory: process.env['DOCUMENT_DIR'] ?? '.documents',
      signingSecret: jwtSecret,
    });

  const admission = { repos, renderer, store, jwtSecret };
  const worker = createWorker({
    repos,
    handlers: { [ADMISSION_BULK_JOB]: createAdmissionBulkHandler(admission) },
    onError: (error, job) => app.log.error({ error, jobId: job.id }, 'job failed'),
  });
  app.decorate('worker', worker);

  if (options.startWorker ?? options.repos === undefined) worker.start();

  // Chromium and the poll timer both outlive a request, so they are shut down with the server.
  app.addHook('onClose', async () => {
    worker.stop();
    await renderer.close();
  });

  registerAuthRoutes(app, { auth, guard });
  registerEventRoutes(app, { repos, guard });
  registerFormRoutes(app, { repos, guard });
  registerPublicFormRoutes(app, { repos, mail, appUrl });
  registerDocumentRoutes(app, { repos, guard, admission, store });

  app.get('/health', async (_request, reply) => {
    let state: 'up' | 'down' | 'skipped' = 'skipped';
    if (probeDatabase && database) {
      try {
        await database.ping();
        state = 'up';
      } catch (error) {
        app.log.error({ error }, 'health check could not reach the database');
        state = 'down';
      }
    }
    return reply.code(state === 'down' ? 503 : 200).send({
      status: state === 'down' ? 'degraded' : 'ok',
      service: 'api-forms',
      contractVersion: CONTRACT_VERSION,
      database: state,
    });
  });

  /** The generated OpenAPI document — SPEC-forms.md §7 wants it derived from the Zod schemas. */
  app.get('/openapi.json', async () => app.swagger());

  return app;
}

/**
 * Refuses to start without a signing secret rather than falling back to a default. A predictable
 * secret in production would let anyone mint an admin access token.
 */
function requireSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters. See .env.example.');
  }
  return secret;
}

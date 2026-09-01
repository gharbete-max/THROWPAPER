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
import { createConsoleMailProvider, type MailProvider } from './auth/mail.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFormRoutes } from './routes/forms.js';
import { registerPublicFormRoutes } from './routes/public-forms.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { createPdfRenderer, type PdfRenderer } from './documents/render.js';
import { createLocalDocumentStore, type DocumentStore } from './documents/store.js';
import { ADMISSION_BULK_JOB, createAdmissionBulkHandler } from './documents/admission-service.js';
import { createWorker } from './jobs/worker.js';
import { registerSendingDomainRoutes } from './routes/sending-domains.js';
import { registerCheckInRoutes } from './routes/checkin.js';
import { registerDemoRoutes, type DemoOptions } from './routes/demo.js';
import { MAIL_SEND_JOB, createMailSendHandler } from './mail/send-job.js';
import { createSesMailProvider } from './mail/ses.js';
import type { TxtResolver } from './mail/domain-verification.js';

export interface ServerOptions {
  /** Injected by the tests; defaults to the Drizzle implementation over Postgres. */
  repos?: Repositories;
  mail?: MailProvider;
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
  /** Stubbed by the domain-verification tests so no real DNS is queried. */
  resolver?: TxtResolver;
  /** Where the operator notification goes. */
  operatorAddress?: string | null;
  /**
   * Present only in demo mode. Its presence is what registers the /demo routes — there is no
   * environment variable that turns them on in a normal server.
   */
  demo?: DemoOptions;
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

  const mail = options.mail ?? configuredMailProvider((message: string) => app.log.info(message));
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
  const mailDeps = {
    repos,
    provider: mail,
    admission,
    appUrl,
    operatorAddress: options.operatorAddress ?? process.env['MAIL_OPERATOR'] ?? null,
  };

  const worker = createWorker({
    repos,
    handlers: {
      [ADMISSION_BULK_JOB]: createAdmissionBulkHandler(admission),
      [MAIL_SEND_JOB]: createMailSendHandler(mailDeps),
    },
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
  registerPublicFormRoutes(app, {
    repos,
    mail,
    appUrl,
    // One job per message, keyed so a retry cannot double-send.
    onSubmitted: async (submissionId) => {
      const organisation = await repos.organisations.first();
      if (!organisation) return;
      for (const templateKey of ['registration.confirmation', 'registration.notification']) {
        await repos.jobs.enqueue({
          organisationId: organisation.id,
          kind: MAIL_SEND_JOB,
          idempotencyKey: `${MAIL_SEND_JOB}:${templateKey}:${submissionId}`,
          payload: { templateKey, submissionId },
          progressTotal: 1,
        });
      }
    },
  });
  registerDocumentRoutes(app, { repos, guard, admission, store });
  registerSendingDomainRoutes(app, { repos, guard, resolver: options.resolver });
  registerCheckInRoutes(app, { repos, guard, jwtSecret });
  if (options.demo) registerDemoRoutes(app, { repos, demo: options.demo, jwtSecret });

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
      // The app reads this to decide whether to show the demo banner.
      mode: options.demo ? 'demo' : 'live',
    });
  });

  /** The generated OpenAPI document — SPEC-forms.md §7 wants it derived from the Zod schemas. */
  app.get('/openapi.json', async () => app.swagger());

  return app;
}

/**
 * Which provider to send through.
 *
 * Console by default so development never needs AWS credentials. `MAIL_PROVIDER=ses` switches to
 * Amazon SES in the region from `MAIL_REGION` — `eu-north-1` (Stockholm), so recipient data stays
 * in Sweden (START-HERE decision 4).
 */
function configuredMailProvider(log: (message: string) => void): MailProvider {
  const provider = process.env['MAIL_PROVIDER'] ?? 'console';
  if (provider !== 'ses') return createConsoleMailProvider(log);

  const from = process.env['MAIL_FROM'];
  if (!from) {
    throw new Error('MAIL_PROVIDER=ses requires MAIL_FROM to be set to a verified sender address.');
  }

  return createSesMailProvider({
    region: process.env['MAIL_REGION'] ?? 'eu-north-1',
    from,
    ...(process.env['MAIL_CONFIGURATION_SET']
      ? { configurationSet: process.env['MAIL_CONFIGURATION_SET'] }
      : {}),
  });
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

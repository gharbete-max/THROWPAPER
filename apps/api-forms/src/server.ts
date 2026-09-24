import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { FastifyError } from 'fastify';
import { redactSecretsInUrl } from './log-redaction.js';
import { constants as zlibConstants } from 'node:zlib';
import { REVALIDATE, cacheControlForFile } from './cache-headers.js';
import { buildLlmsTxt, buildRobots, buildSitemap, isPrivatePath } from './sitemap.js';
import {
  BROTLI_QUALITY,
  compressPayload,
  negotiateEncoding,
  worthCompressing,
} from './fallback-compression.js';
import { CONTRACT_VERSION } from '@tp/shared';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pickText } from '@tp/i18n';
import { createDrizzleRepositories, type Repositories } from './db/repositories/index.js';
import { withLinkPreview, type LinkPreview } from './documents/link-preview.js';
import {
  accentTile,
  withClientIdentity,
  type ClientIdentity,
} from './documents/client-identity.js';
import { toThemedCssBlock } from '@tp/tokens';
import { resolveTokens } from './routes/brand-kit.js';
import { createAuthService } from './auth/service.js';
import { createConsoleMailProvider, type MailProvider } from './auth/mail.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFormRoutes } from './routes/forms.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerLedgerRoutes } from './routes/ledger.js';
import { registerPublicFormRoutes } from './routes/public-forms.js';
import { registerPublicContactRoutes } from './routes/public-contact.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerPublicInvoiceRoutes } from './routes/public-invoices.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerSigningRoutes } from './routes/signing.js';
import { registerPhoneScanRoutes } from './routes/phone-scan.js';
import { createPhoneScanStore, type PhoneScanStore } from './phone-scan/store.js';
import { createSignClient, type SignConnection } from './signing/client.js';
import { createPdfRenderer, type PdfRenderer } from './documents/render.js';
import { deriveFinishedKey } from './documents/finished-token.js';
import { createLocalDocumentStore, type DocumentStore } from './documents/store.js';
import { ADMISSION_BULK_JOB, createAdmissionBulkHandler } from './documents/admission-service.js';
import { createWorker } from './jobs/worker.js';
import { registerSendingDomainRoutes } from './routes/sending-domains.js';
import { registerCheckInRoutes } from './routes/checkin.js';
import { registerBrandKitRoutes } from './routes/brand-kit.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { createLocalAssetStore, type AssetStore } from './uploads/store.js';
import { createLocalUploadStore, type PrivateUploadStore } from './uploads/private-store.js';
import { sweepExpiredUploads } from './uploads/lifecycle.js';
import { MAX_IMAGE_BYTES, checkImage } from './uploads/image.js';
import { imageSize, isNearSquare } from './uploads/image-size.js';
import { registerDemoRoutes, type DemoOptions } from './routes/demo.js';
import { MAIL_SEND_JOB, createMailSendHandler } from './mail/send-job.js';
import { SIGNING_INVITE_JOB, createSigningInviteHandler } from './signing/invitations.js';
import { createOutboxMailProvider, createSmtpMailProvider } from './mail/smtp.js';
import { createSesMailProvider } from './mail/ses.js';
import type { TxtResolver } from './mail/domain-verification.js';

export interface ServerOptions {
  /** Injected by the tests; defaults to the Drizzle implementation over Postgres. */
  repos?: Repositories;
  mail?: MailProvider;
  jwtSecret?: string;
  /** Signs download links. Required, and must differ from `jwtSecret`. See env.ts. */
  documentSigningSecret?: string;
  appUrl?: string;
  /** Scanning with a phone: the sessions (shared with the desktop's relay), and where a phone
   *  reaches this app. Default: a store of its own, and `appUrl`. */
  phoneScans?: PhoneScanStore;
  phoneOrigin?: () => Promise<string | null>;
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
  /** Where the marketing site's "get in touch" form goes — our inbox, not a customer's. */
  contactAddress?: string | null;
  /**
   * Present only in demo mode. Its presence is what registers the /demo routes — there is no
   * environment variable that turns them on in a normal server.
   */
  demo?: DemoOptions;
  /**
   * Absolute path to the built `apps/forms` bundle. When set, the API also serves the app, so the
   * whole product is one container — which is what makes a demo deployable in one step.
   *
   * Unset in development, where Vite serves the app and proxies here.
   */
  serveAppFrom?: string;
  /**
   * The Sign product this deployment sends documents to (CONTRACT §5, P1c-3), or null for none.
   * Defaults to `SIGN_API_URL` + `SIGN_SERVICE_TOKEN`; the desktop passes its local Sign.
   */
  signing?: SignConnection | null;
  /** Injected by tests so no real Sign is called. */
  signFetch?: typeof fetch;

  /** Uploaded images. Injected by the tests and by demo mode; local disk otherwise. */
  assets?: AssetStore;
  uploadStore?: PrivateUploadStore;
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
  const appDir = options.serveAppFrom ?? process.env['SERVE_APP'];

  /*
   * Which proxies to believe about the client's address. See `TRUST_PROXY` in env.ts.
   *
   * A list rather than `true`, so a client cannot forge its own address by writing
   * `X-Forwarded-For`. `false` — the default — means `request.ip` is the socket, which is right on
   * localhost and wrong behind any TLS terminator.
   */
  const trusted = (process.env['TRUST_PROXY'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const app = Fastify({
    trustProxy: trusted.length > 0 ? trusted : false,
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
      /**
       * The URL is logged on every request, and several of this app's URLs *are* the credential.
       *
       * Fastify's default `req` serializer emits `{method, url, …}`. Bodies and headers are never
       * logged, so the bearer token is safe — but `/i/<token>`, `/public/forms/:slug/resume/<token>`
       * and the signed document download all carry their secret in the path. Every one of those was
       * being written to stdout in cleartext, on every hit, and then kept for as long as the log is
       * kept — which is currently forever.
       *
       * Redacting by shape rather than by route on purpose: a route added next year gets this for
       * free, and the alternative is a list that has to be remembered. A long run of hex or
       * base64url is not something a slug or an id needs to be.
       */
      serializers: {
        req(request: { method: string; url: string; ip?: string }) {
          return {
            method: request.method,
            url: redactSecretsInUrl(request.url),
            remoteAddress: request.ip,
          };
        },
      },
    },
    /**
     * The app calls `/api/v1/...`. In development Vite proxies that to this server and strips the
     * prefix; in the container there is no proxy, so the server strips it itself. Same rule, same
     * shape, one place each.
     *
     * Without this the container serves an app that renders and then fails every request — which
     * is worse than not starting, because it looks like it works.
     */
    rewriteUrl: appDir
      ? (request) => {
          const url = request.url ?? '/';
          return url.startsWith('/api/') ? url.slice('/api'.length) : url;
        }
      : undefined,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * One error shape, and nothing internal in it.
   *
   * Fastify's default handler answers `{ statusCode, error, message }` — which is not the
   * `ErrorResponse` contract every route in this app declares, so a client reading
   * `body.error.code` got `undefined` for exactly the responses it most needed to branch on.
   *
   * It also puts `error.message` in the body. For a validation failure that is the point; for an
   * unexpected throw it is whatever the layer below said, and the layer below is Postgres. A
   * constraint violation would have replied with the constraint's name, the column, and by
   * implication the schema. So 5xx says one sentence and the detail goes to the log, where it is
   * useful and not public.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      // Logged in full — this is the only copy of what actually happened.
      request.log.error({ err: error }, 'unhandled error');
      return reply.code(status).send({
        error: { code: 'internal', message: 'Something went wrong. Try again.' },
      });
    }

    /*
     * Below 500 the message is ours: a Zod validation failure, or a route that threw a known
     * HTTP error deliberately. Those are safe to return and are what a client acts on.
     */
    return reply.code(status).send({
      error: { code: error.code ?? 'bad-request', message: error.message },
    });
  });

  const database = options.repos ? null : await loadDatabase();
  const repos = options.repos ?? database?.repos;
  if (!repos) throw new Error('no repositories available');

  const mail = options.mail ?? configuredMailProvider((message: string) => app.log.info(message));
  const jwtSecret = options.jwtSecret ?? requireSecret('JWT_SECRET');
  const documentSigningSecret =
    options.documentSigningSecret ?? requireSecret('DOCUMENT_SIGNING_SECRET');
  if (documentSigningSecret === jwtSecret) {
    throw new Error(
      'DOCUMENT_SIGNING_SECRET must differ from JWT_SECRET: one signs sessions, the other download links.',
    );
  }
  const appUrl = options.appUrl ?? process.env['APP_URL'] ?? 'http://localhost:5173';
  const probeDatabase = options.probeDatabase ?? database !== null;
  /* HSTS and upgrade-insecure-requests are correct in front of TLS and break a localhost page. */
  const isProduction = process.env['NODE_ENV'] === 'production';

  /**
   * Security headers, on a server that hands HTML to browsers.
   *
   * There were none. Not a weak set — none at all: no framing policy, no `nosniff`, no referrer
   * policy, no content policy. That is defensible for an API nobody points a browser at, and this
   * one serves the app, the marketing site and every public registration page.
   *
   * The policy is written against what the app actually loads, which is little: no inline scripts,
   * no external origins, no CDN. That makes `script-src 'self'` achievable rather than aspirational
   * — the version of this header that is worth having.
   */
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        /*
         * No inline scripts anywhere: the shipped HTML loads two modules by src and nothing else.
         *
         * `wasm-unsafe-eval` is the one addition, for the OCR engine in the builder
         * (`screens/builder/paper/ocr.ts`): Chromium refuses to instantiate WebAssembly under a
         * bare `'self'`. It permits WebAssembly compilation and nothing else — no `eval`, no
         * `Function`, no inline handlers — which is why it is not `unsafe-eval`.
         */
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        /*
         * Styles need `unsafe-inline` and that is a deliberate cost, not an oversight. The brand
         * palette is injected as a `<style>` block — inline on the server for a page whose first
         * impression is the point, and at runtime in the app because an organisation's kit
         * replaces it. A nonce would work for the server-rendered half and not for the half the
         * client writes after a fetch.
         */
        styleSrc: ["'self'", "'unsafe-inline'"],
        /* `data:` for the QR on an admission card, `blob:` for a CSV or attachment being saved. */
        imgSrc: ["'self'", 'data:', 'blob:'],
        /*
         * `data:` because the print compiler embeds the font's own bytes.
         *
         * That is deliberate and load-bearing elsewhere: a PDF has to carry its typeface rather
         * than hope the reader has it. The invoice page uses the same stylesheet, so a policy of
         * `'self'` alone silently rendered somebody's invoice in a fallback face — found by
         * opening one, not by reading the header.
         */
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        /*
         * Nothing here may be framed, including the public form.
         *
         * Embedding a form in a customer's own page is a feature this product may well want, and
         * when it does it should be a decision with an allow-list behind it — not something that
         * works today because nobody set a header. Until then a registration page that can be
         * framed is a registration page that can be clickjacked.
         */
        frameAncestors: ["'none'"],
        /* Breaks every localhost page, and adds nothing that HSTS does not already do in front. */
        ...(isProduction ? {} : { upgradeInsecureRequests: null }),
      },
    },
    /* Only meaningful over TLS, and actively unhelpful on a development machine. */
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    /* The door screen reads a QR from the camera, so that one capability stays. */
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  /**
   * One capability, granted to one screen.
   *
   * Helmet does not write this, and its absence means every API a browser has ever added is
   * available to any script that gets onto the page. The camera is named because check-in needs
   * it; everything else is refused rather than left to the browser's default.
   */
  app.addHook('onSend', async (_request, reply) => {
    reply.header(
      'Permissions-Policy',
      'camera=(self), geolocation=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    );
  });

  /**
   * Responses are compressed on the way out.
   *
   * Nothing in front of this server does it. Measured on the built site, the rendered landing page
   * is 20,085 bytes of markup and 4,804 gzipped — 77% of every site page, and a comparable share of
   * every JSON list, was being paid for by the visitor for no reason. It is registered here, before
   * the routes, so the hook wraps the static files and the site render as well as the API.
   *
   * Registered *after* helmet deliberately: the security headers are set on a response that is
   * still uncompressed, which is the order that leaves `Content-Length` and `Content-Encoding`
   * consistent with the body actually sent.
   *
   * Already-compressed bytes are left alone — the plugin consults `mime-db`, and the mark's WebP
   * loops, the PNG icons and the woff2 subsets are all flagged incompressible there, so the CPU is
   * never spent re-deflating a PNG to make it a few bytes larger.
   *
   * Brotli is offered first and gzip kept for anything that cannot take it — at quality 5, not the
   * plugin's default of 4. That default is the one setting measurably worth overriding: on the
   * built stylesheet q4 produces 13,264 bytes against gzip's 12,095, so the encoding offered first
   * would have been the worse one. q5 gives 11,794 for about 0.3 ms more, and on the largest
   * bundle 103,783 against gzip's 118,438. `fallback-compression.ts` records the same measurement
   * for the rendered page and uses the same quality, so the two paths agree.
   *
   * BREACH is the reason to think twice about compressing a page, and it does not apply here: the
   * attack needs a secret in the response body alongside attacker-controlled text, and this
   * product has no session cookie and no CSRF token in its markup — the access token lives in
   * `localStorage` and travels in a header.
   */
  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    brotliOptions: {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      },
    },
  });

  /**
   * And the same for the responses the plugin structurally cannot reach.
   *
   * `@fastify/compress` hangs its work off an `onRoute` hook, so it covers routes and only routes.
   * The server-rendered site, a form's link preview and an invoice are all served from
   * `setNotFoundHandler` — not a route, because `@fastify/static` owns `/*` — so without this the
   * measurement that justified the plugin would not have applied to the pages it was measured on.
   *
   * A plain `onSend` hook on the root instance *does* reach the not-found handler, which is what
   * makes this possible at all; the `Permissions-Policy` header above arrives the same way.
   *
   * Guarded on `content-encoding` being unset, so a response the plugin already compressed is
   * never compressed twice. See `fallback-compression.ts` for why this is as small as it is.
   */
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.getHeader('content-encoding')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;

    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const type = reply.getHeader('content-type');
    if (!worthCompressing(typeof type === 'string' ? type : undefined, body.length)) return payload;

    const encoding = negotiateEncoding(request.headers['accept-encoding']);
    if (!encoding) return payload;

    reply.header('content-encoding', encoding);
    /*
     * Without this a shared cache can hand a brotli body to a client that cannot read it. The
     * plugin sets it on its own responses; this path has to set its own.
     */
    reply.header('vary', 'accept-encoding');
    const compressed = compressPayload(body, encoding);
    // Fastify will not recompute a length it has already been told.
    reply.header('content-length', compressed.length);
    return compressed;
  });

  await app.register(cors, { origin: appUrl, credentials: false });
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });
  /**
   * The cap is set here as well as per-request. Without a global limit a client can announce a
   * multi-gigabyte part and have it buffered before any handler runs.
   */
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Loppa API', version: '0.1.0' },
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
      signingSecret: documentSigningSecret,
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
      [SIGNING_INVITE_JOB]: createSigningInviteHandler({ repos, provider: mail }),
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

  /**
   * Respondent attachments live apart from the public asset store, in their own directory.
   *
   * Personal data rather than page furniture: nothing here is ever served from a public route, so
   * keeping the two in one directory would make it far too easy to expose the wrong one.
   */
  const uploadStore =
    options.uploadStore ??
    createLocalUploadStore(
      process.env['UPLOAD_DIR'] ?? join(process.env['DOCUMENT_DIR'] ?? '.documents', 'uploads'),
    );

  /**
   * Housekeeping, on the same terms as the worker: a timer inside the process, one pass at a
   * time, an error logged rather than thrown, gated by the same flag so tests run it by hand.
   * Not a queued job — the queue belongs to an organisation and this belongs to none. Two
   * instances sweeping at once is harmless; every statement is idempotent.
   */
  if (options.startWorker ?? options.repos === undefined) {
    let sweeping = false;
    const sweep = () => {
      if (sweeping) return;
      sweeping = true;
      sweepExpiredUploads({ repos, uploadStore })
        .then((result) => {
          if (result.rowsDeleted > 0) app.log.info(result, 'swept expired uploads');
        })
        .catch((err: unknown) => app.log.error({ err }, 'upload sweep failed'))
        .finally(() => {
          sweeping = false;
        });
    };
    const timer = setInterval(sweep, 60 * 60 * 1000);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
    app.addHook('onReady', async () => sweep());
  }

  registerAuthRoutes(app, { auth, guard });
  registerEventRoutes(app, { repos, guard });
  registerFormRoutes(app, { repos, guard });
  registerAdminRoutes(app, { repos, guard });
  registerLedgerRoutes(app, { repos, guard });
  registerInvoiceRoutes(app, { repos, guard, renderer });
  registerPublicInvoiceRoutes(app, { repos, renderer });
  registerPublicContactRoutes(app, {
    mail,
    contactAddress:
      options.contactAddress === undefined
        ? (process.env['CONTACT_TO'] ?? null)
        : options.contactAddress,
  });
  registerPublicFormRoutes(app, {
    repos,
    mail,
    appUrl,
    uploadStore,
    finished: { renderer, key: deriveFinishedKey(documentSigningSecret) },
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
  registerDocumentRoutes(app, { repos, guard, admission, store, uploadStore });
  const signing =
    options.signing !== undefined
      ? options.signing
      : process.env['SIGN_API_URL'] && process.env['SIGN_SERVICE_TOKEN']
        ? { apiUrl: process.env['SIGN_API_URL'], serviceToken: process.env['SIGN_SERVICE_TOKEN'] }
        : null;
  registerSigningRoutes(app, {
    repos,
    guard,
    store,
    uploadStore,
    renderer,
    sign: signing ? createSignClient(signing, options.signFetch) : null,
    // The app's origin with the `/api` prefix: served by this process, or proxied to it by Vite.
    publicApiUrl: `${appUrl.replace(/\/$/, '')}/api`,
  });
  registerPhoneScanRoutes(app, {
    guard,
    store: options.phoneScans ?? createPhoneScanStore(),
    // On a server the phone opens the app's own public address; the desktop passes its LAN relay.
    phoneOrigin: options.phoneOrigin ?? (async () => appUrl),
  });
  registerSendingDomainRoutes(app, { repos, guard, resolver: options.resolver });
  registerCheckInRoutes(app, { repos, guard, jwtSecret });
  registerBrandKitRoutes(app, { repos, guard });

  const assets =
    options.assets ??
    createLocalAssetStore({
      directory:
        process.env['ASSET_DIR'] ?? join(process.env['DOCUMENT_DIR'] ?? '.documents', 'assets'),
    });
  registerUploadRoutes(app, { repos, guard, assets, uploadStore });
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

  if (appDir) {
    /**
     * `index: false` so the root is not answered by the file on disk.
     *
     * `fastify-static` serves `index.html` for `/` before any handler runs, which meant the
     * landing page — the one page on this domain a search engine actually reads — was the only
     * site route still shipped as an empty shell. Every other route already fell through to the
     * not-found handler, so `/features/ledger` was server-rendered and `/` was not.
     *
     * The file is still served everywhere it should be: the fallback below reaches for it by name.
     */
    /**
     * `cacheControl: false` so the plugin stops writing its own `max-age=0` and `setHeaders`
     * decides instead. Left on, the two disagree and the plugin wins.
     *
     * See `cache-headers.ts`: a hashed bundle is kept for a year, an unhashed name — `index.html`,
     * `sw.js` — is revalidated every time. Before this, all 83 bundles were re-requested on every
     * navigation to be told nothing had changed.
     *
     * Two things about this API are worth writing down, because both fail quietly:
     *
     * The first argument is a Fastify reply, not a Node `ServerResponse`. `res.setHeader` — the
     * name the parameter invites — is not a function on it, and the throw surfaces as a 500 from
     * the static route rather than as anything mentioning `setHeaders`.
     *
     * And the plugin's own `maxAge` is milliseconds. `maxAge: 31536000`, which reads as a year in
     * the unit `Cache-Control` actually uses, emits `max-age=31536` — eight and three quarter
     * hours. Writing the header directly is not a workaround for that; it is the reason the header
     * is written directly, since the value then says what it means.
     */
    await app.register(fastifyStatic, {
      root: appDir,
      wildcard: false,
      index: false,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        reply.header('cache-control', cacheControlForFile(appDir, filePath));
      },
    });

    /**
     * `robots.txt` and `sitemap.xml`, built from the site's own route list.
     *
     * Both answered 404 — as JSON, from the not-found handler below — which is what a search
     * engine got when it asked this deployment what it was allowed to read and what there was to
     * read. Registered as real routes rather than files on disk so the `Sitemap:` line and every
     * `<loc>` carry this deployment's `APP_URL`; a checked-in file would have to name one host,
     * and the product is meant to be deployable as somebody else's.
     *
     * They are also routes rather than special cases in the fallback because that is what makes
     * them compressed: `@fastify/compress` attaches per route. See `sitemap.ts`.
     */
    app.get('/robots.txt', async (_request, reply) => {
      return reply
        .type('text/plain; charset=utf-8')
        .header('cache-control', 'public, max-age=3600')
        .send(buildRobots(appUrl));
    });

    /**
     * `llms.txt` — a description of the site, for something reading rather than indexing it.
     *
     * Its title and summary are lifted from the home page's own `<title>` and description rather
     * than written again here: those are already where the product says what it is, and a second
     * copy is a second thing to keep true. See `buildLlmsTxt`.
     *
     * This does **not** decide whether AI crawlers are welcome. That is a `robots.txt` question
     * and the owner's to answer; `llms.txt` grants nothing and withholds nothing.
     */
    app.get('/llms.txt', async (_request, reply) => {
      const site = await siteRenderer(appDir);
      if (!site) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      }

      const { head } = site.render('/', appUrl);
      const title = /<title>([^<]*)<\/title>/.exec(head)?.[1];
      const description = /<meta name="description" content="([^"]*)"/.exec(head)?.[1];
      /*
       * If the head ever stops carrying either, say nothing rather than something made up: an
       * `llms.txt` describing the site as "undefined" is worse than no file.
       */
      if (!title || !description) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      }

      const english = site.SITE_ROUTES.filter(
        (route) => site.splitLocale(route).locale === site.SITE_DEFAULT_LOCALE,
      );

      return reply
        .type('text/plain; charset=utf-8')
        .header('cache-control', 'public, max-age=3600')
        .send(buildLlmsTxt({ title, description, routes: english, origin: appUrl }));
    });

    app.get('/sitemap.xml', async (_request, reply) => {
      const site = await siteRenderer(appDir);
      /*
       * No SSR bundle means no site to map. A 404 is the honest answer — an empty `<urlset>` would
       * tell a crawler this deployment has no pages, which it would then believe.
       */
      if (!site) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      }

      return reply
        .type('application/xml; charset=utf-8')
        .header('cache-control', 'public, max-age=3600')
        .send(buildSitemap(site.SITE_ROUTES, appUrl));
    });

    /**
     * SPA fallback. Anything that is not an API route and not a file on disk is a client route —
     * `/f/:slug`, `/events/:id/check-in` — and must return index.html rather than a 404.
     *
     * The API prefixes are excluded explicitly: a mistyped endpoint should 404 as an endpoint, not
     * silently hand back an HTML page that a fetch will fail to parse.
     */
    app.setNotFoundHandler(async (request, reply) => {
      // `rewriteUrl` has already stripped `/api`; the original is kept so that a mistyped
      // `/api/...` still answers as an endpoint rather than as a page.
      const raw = (request.raw as { originalUrl?: string }).originalUrl ?? request.url;
      const path = raw.split('?')[0] ?? '';
      const isApi =
        path.startsWith('/api/') ||
        path.startsWith('/v1/') ||
        path.startsWith('/public/') ||
        path.startsWith('/demo/') ||
        path === '/health' ||
        path === '/openapi.json';

      if (isApi || request.method !== 'GET' || looksLikeAsset(path)) {
        return reply.code(404).send({ error: { code: 'not-found', message: 'Not found' } });
      }

      /**
       * Every HTML document below is revalidated rather than kept.
       *
       * They share a property that makes caching them by time wrong: the URL does not determine
       * the bytes. A site page changes with the build, `/f/:slug` carries a preview of a form its
       * author can retitle, `/i/:token` is somebody's invoice, and the shell is rewritten per
       * deployment with the customer's own palette and wordmark. None of those can be renamed the
       * way a hashed bundle can, so none of them may be served from a cache without asking.
       *
       * Set once here rather than at the four `send` sites below, so a fifth cannot be added
       * without it. `no-cache` still allows a 304 on the `ETag`, so the usual case stays cheap.
       */
      reply.header('cache-control', REVALIDATE);

      /**
       * And the signed-in screens refuse indexing outright.
       *
       * `robots.txt` already asks a crawler not to fetch these, which is the weaker of the two
       * statements: a crawler that is not allowed to look is also not allowed to read the header
       * saying "do not index", so a link to `/events` from somebody's blog can still put the URL
       * in an index with nothing but a title guessed from the anchor text. This covers the arrival
       * `robots.txt` cannot.
       *
       * Scoped to the same list `robots.txt` is built from, so the two cannot drift apart and say
       * different things about the same path. A published form at `/f/:slug` is deliberately not
       * in it — that is a customer's public page — and an invoice already sets its own header
       * further up, on the route that renders it.
       */
      if (isPrivatePath(path)) reply.header('x-robots-tag', 'noindex');

      /**
       * The public site is rendered here, not in the browser.
       *
       * A landing page whose markup arrives empty and fills in after a bundle downloads is a
       * landing page a crawler reads as blank and a visitor on a slow connection reads as broken.
       * These pages are a pure function of their content module — no session, no fetch — so
       * rendering them on the server is honest rather than a shell with a spinner in it.
       *
       * The app is deliberately not rendered here: it is behind a bearer token this server does
       * not have, and there is no crawler on the other side of a sign-in.
       */
      const site = await renderSite(appDir, path, appUrl);
      if (site) return reply.code(site.status).type('text/html; charset=utf-8').send(site.html);

      /**
       * A public form link gets a real preview card.
       *
       * Everything else gets the shipped `index.html` unchanged: the app's own screens are behind
       * a sign-in and nobody pastes them into a chat window. See `link-preview.ts` for why this
       * cannot be done in React.
       */
      const slug = /^\/f\/([A-Za-z0-9][A-Za-z0-9-]{0,63})$/.exec(path)?.[1];
      if (slug) {
        const preview = await previewForSlug(repos, slug, appUrl);
        if (preview) {
          const shell = await readFile(join(appDir, 'index.html'), 'utf8');
          return reply.type('text/html; charset=utf-8').send(withLinkPreview(shell, preview));
        }
      }

      /**
       * A white-labelled deployment serves the shell wearing the customer's identity.
       *
       * Only when client mode is on: with it off there is nothing to correct, and reading the
       * brand kit on every HTML request to discover that would be a database round trip bought for
       * no one. See `client-identity.ts` for why this cannot be done in the browser — the sign-in
       * screen has no session to hang a brand off, so the server is the only thing that knows.
       */
      const identity = await clientIdentity(repos, assets);
      if (identity) {
        const shell = await readFile(join(appDir, 'index.html'), 'utf8');
        return reply.type('text/html; charset=utf-8').send(withClientIdentity(shell, identity));
      }

      return reply.sendFile('index.html');
    });
  }

  return app;
}

/**
 * The server-rendered public site, or `null` when this path is not one of its pages.
 *
 * The SSR bundle is imported lazily and only once: it pulls in React and the whole site tree, and
 * a deployment that never serves the site (an API-only container) should not pay for it at boot.
 */
let sitePromise: Promise<SiteRenderer | null> | null = null;

interface SiteRenderer {
  /**
   * Every address the site has: each page in each language it is published in.
   *
   * The sitemap is built from this, which is what the route list said it was for from the day it
   * was written. Reading it here rather than restating it is what keeps a new page or a new
   * language from being served and never indexed.
   */
  SITE_ROUTES: readonly string[];
  /** The language an unprefixed URL serves, and the one `llms.txt` is written in. */
  SITE_DEFAULT_LOCALE: string;
  /** Splits `/sv/contact` into its language and its page — see `site/locale.ts`. */
  splitLocale: (path: string) => { locale: string; path: string };
  isSiteRoute: (path: string) => boolean;
  /** An address only the site could own and does not have — rendered as its 404, not the app's shell. */
  isSiteShaped: (path: string) => boolean;
  render: (
    path: string,
    origin: string,
  ) => { html: string; head: string; lang: string; status: 200 | 404 };
}

/** The bundle, loaded at most once per process. `import()` caches, but the promise is the guard. */
function siteRenderer(appDir: string): Promise<SiteRenderer | null> {
  sitePromise ??= loadSite(appDir);
  return sitePromise;
}

async function loadSite(appDir: string): Promise<SiteRenderer | null> {
  try {
    /**
     * `dist-server` sits beside the client build. In development this file is never reached —
     * Vite serves the app and this whole branch is dead — so a missing bundle is a normal state
     * rather than a failure, and the site falls back to being client-rendered.
     */
    const entry = pathToFileURL(join(appDir, '..', 'dist-server', 'entry-server.js')).href;
    return (await import(entry)) as SiteRenderer;
  } catch {
    return null;
  }
}

async function renderSite(
  appDir: string,
  path: string,
  appUrl: string,
): Promise<{ html: string; status: number } | null> {
  const site = await siteRenderer(appDir);
  if (!site) return null;

  try {
    // Inside the try: a bundle from an older build lacks `isSiteShaped`, and that must serve the
    // shell rather than take down every page.
    if (!(site.isSiteRoute(path) || site.isSiteShaped(path))) return null;
    const shell = await readFile(join(appDir, 'index.html'), 'utf8');
    const { html, head, lang, status } = site.render(path, appUrl);
    return {
      status,
      html: shell
        /*
         * The shell ships `lang="en"`, and the site is no longer only English. `/de/` served with
         * an English `lang` is the same defect the invoice and the confirmation email each had
         * once: nothing on screen looks wrong, and a screen reader pronounces German with English
         * phonetics. `link-preview.ts` does the identical rewrite for `/f/:slug`.
         */
        .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
        .replace(/<title>[^<]*<\/title>/, '')
        .replace(/<\/head>/, `  ${head}\n  </head>`)
        // The markup React will hydrate, so the page is readable before any script runs.
        .replace('<div id="root"></div>', `<div id="root">${html}</div>`),
    };
  } catch {
    // A render that throws must not take the page down: fall through to the client-rendered shell.
    return null;
  }
}

/**
 * The preview for a published form, or `null`.
 *
 * **Only published forms.** A draft's title is the author's working note and has not been shown to
 * anybody; a link to one already refuses to render the form, and it must not leak the title
 * either. A form that does not exist gets the plain shell for the same reason — a preview that
 * confirms which slugs are real is a way to enumerate them.
 */
/**
 * The customer's identity for the app shell, or `null` when this deployment is our own.
 *
 * Swallows its own failures for the same reason `previewForSlug` does: this decorates a page that
 * has to load, and a database blip must serve the app rather than a 500. The cost of failing open
 * is one page in our branding, which is the state every page was in before this existed.
 */
async function clientIdentity(
  repos: Repositories,
  assets: AssetStore,
): Promise<ClientIdentity | null> {
  try {
    const organisation = await repos.organisations.first();
    if (!organisation) return null;

    const { tokens } = await resolveTokens(repos, organisation.id);
    if (!tokens.clientMode) return null;

    const logo = tokens.logoLight ?? tokens.logoDark;
    const usable = logo ? await logoSuitsAFavicon(assets, logo) : false;

    return {
      // Their brand name where they set one, the legal entity otherwise — the two often differ.
      wordmark: tokens.wordmark ?? organisation.name,
      poweredBy: tokens.poweredBy,
      logoLight: tokens.logoLight,
      logoDark: tokens.logoDark,
      palette: toThemedCssBlock(tokens),
      /* Their mark only where it survives the size; their colour otherwise. */
      favicon: usable && logo ? logo : accentTile(tokens.colour.primary),
      touchIcon: logo,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a logo is square enough to be a favicon, answered once per file.
 *
 * Cached on the asset path, which is safe forever rather than merely convenient: the path is the
 * SHA-256 of the file's own bytes, so it cannot come to mean a different image. A new upload is a
 * new key and the old entry is simply never asked for again.
 *
 * Without the cache this is a two-megabyte disk read on every HTML request, to answer a question
 * whose answer cannot change.
 */
// ponytail: unbounded map keyed by upload hash, one entry per logo ever uploaded; an LRU if a tenant
// somehow cycles thousands of logos.
const faviconSuitability = new Map<string, boolean>();

async function logoSuitsAFavicon(assets: AssetStore, path: string): Promise<boolean> {
  const cached = faviconSuitability.get(path);
  if (cached !== undefined) return cached;

  let answer = false;
  try {
    const key = path.slice(path.lastIndexOf('/') + 1);
    const stored = await assets.get(key);
    if (stored) {
      const check = checkImage(stored.content);
      // An unreadable header falls back to the tile, which is the safe direction to be wrong in.
      if (check.ok) answer = isNearSquare(imageSize(stored.content, check.format));
    }
  } catch {
    answer = false;
  }

  faviconSuitability.set(path, answer);
  return answer;
}

async function previewForSlug(
  repos: Repositories,
  slug: string,
  appUrl: string,
): Promise<LinkPreview | null> {
  try {
    const organisation = await repos.organisations.first();
    if (!organisation) return null;

    const form = await repos.forms.findBySlug(organisation.id, slug);
    if (!form?.publishedVersionId) return null;

    const versions = await repos.forms.listVersions(form.id);
    const published = versions.find((version) => version.id === form.publishedVersionId);
    if (!published) return null;

    const locale = organisation.defaultLocale;
    const title = pickText(
      { default: locale, supported: organisation.supportedLocales, fallbacks: {} },
      form.title,
      locale,
    ).value;
    if (!title) return null;

    const origin = appUrl.replace(/\/$/, '');
    const { tokens } = await resolveTokens(repos, organisation.id);

    return {
      title,
      organisation: organisation.name,
      url: `${origin}/f/${slug}`,
      // The organisation's own logo where they have uploaded one; the product's mark otherwise.
      image: tokens.logoLight
        ? new URL(tokens.logoLight, `${origin}/`).toString()
        : `${origin}/icon-512.png`,
      locale,
      /*
       * The whole theme, not only the light half. A respondent opening a form on a phone set to
       * dark should get the organisation's dark palette in the first paint too, and `toThemedCss`
       * carries the media query and the explicit `data-theme` opt-in together.
       */
      palette: toThemedCssBlock(tokens),
    };
  } catch {
    /**
     * A preview is decoration on a page that has to load. If the lookup fails — a database blip, a
     * form row that no longer parses — the visitor still gets the app, which will fetch the form
     * itself and show its own error. Failing the page over a meta tag would be the wrong trade.
     */
    return null;
  }
}

/**
 * A request for a file that is not there, as opposed to a client route.
 *
 * Handing back index.html for a missing `.js` is the worst available answer: the browser refuses
 * the module on MIME grounds and the page is blank, with an error that says nothing about the
 * actual cause. A 404 is recoverable — the service worker falls back, a reload fixes it.
 *
 * This is not hypothetical. Deploy a new build and a visitor still holding the previous
 * index.html asks for asset hashes that no longer exist; that is a rolling deploy, not an edge
 * case. Client routes have no file extension, which is what makes the two safe to tell apart.
 */
function looksLikeAsset(path: string): boolean {
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return /\.[a-z0-9]{1,8}$/i.test(lastSegment);
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
  if (provider === 'smtp' || provider === 'outbox') return configuredLocalMailProvider(provider);
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
 * Direct SMTP (`CLAUDE.md` rule 2) or the `.eml` outbox, from the environment.
 *
 * The desktop edition builds these from its own settings file instead; this is the same pair for
 * a server that runs without Mailer and without SES.
 */
function configuredLocalMailProvider(provider: 'smtp' | 'outbox'): MailProvider {
  const from = process.env['MAIL_FROM'];
  if (!from) throw new Error(`MAIL_PROVIDER=${provider} requires MAIL_FROM to be set.`);
  if (provider === 'outbox') {
    return createOutboxMailProvider({
      directory:
        process.env['MAIL_OUTBOX_DIR'] ??
        join(process.env['DOCUMENT_DIR'] ?? '.documents', 'outbox'),
      from,
    });
  }
  const host = process.env['SMTP_HOST'];
  if (!host) throw new Error('MAIL_PROVIDER=smtp requires SMTP_HOST.');
  return createSmtpMailProvider({
    host,
    port: Number(process.env['SMTP_PORT'] ?? 587),
    secure: process.env['SMTP_SECURE'] === 'true',
    ...(process.env['SMTP_USER'] ? { user: process.env['SMTP_USER'] } : {}),
    ...(process.env['SMTP_PASSWORD'] ? { password: process.env['SMTP_PASSWORD'] } : {}),
    from,
  });
}

/**
 * Refuses to start without a secret rather than falling back to a default. A predictable
 * `JWT_SECRET` in production would let anyone mint an admin access token; a predictable
 * `DOCUMENT_SIGNING_SECRET` would let anyone mint a link to a ZIP of registrations.
 */
function requireSecret(name: 'JWT_SECRET' | 'DOCUMENT_SIGNING_SECRET'): string {
  const secret = process.env[name];
  if (!secret || secret.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters. See .env.example.`);
  }
  return secret;
}

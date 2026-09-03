import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { createMemoryMailProvider } from './auth/mail.js';
import { createMemoryRepositories } from './db/repositories/index.js';
import { createMemoryDocumentStore } from './documents/store.js';
import { TEST_JWT_SECRET, createFakePdfRenderer, testOrganisation } from './test-support.js';

/**
 * The deployed image is one container: the API also serves the built app, so a client route like
 * `/f/varmotet` has to fall back to index.html while `/v1/...` still 404s as an API.
 *
 * Getting that boundary wrong is invisible in development, where Vite serves the app on its own
 * port and this code path never runs. It only shows up in production, as a form URL that returns
 * JSON to somebody who was sent a link.
 */
/**
 * One published form and one draft, so the preview can be checked for what it says *and* for what
 * it refuses to say. A draft's title is the author's working note; a link to one already refuses to
 * render the form, and it must not leak the title in a chat window either.
 */
const PUBLISHED_FORM = {
  id: 'form-published',
  organisationId: testOrganisation.id,
  slug: 'varmotet',
  title: { 'sv-SE': 'Anmälan till Vårmötet' },
  eventId: null,
  publishedVersionId: 'version-1',
  ownerUserId: null,
  deletedAt: null,
  opensAt: null,
  closesAt: null,
  maxSubmissions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

const DRAFT_FORM = {
  ...(PUBLISHED_FORM as object),
  id: 'form-draft',
  slug: 'hemligt',
  title: { 'sv-SE': 'Internt utkast' },
  publishedVersionId: null,
} as never;

const PUBLISHED_VERSION = {
  id: 'version-1',
  formId: 'form-published',
  version: 1,
  definition: { schemaVersion: 1, fields: [], settings: {} },
  createdAt: new Date(),
} as never;

let app: FastifyInstance;
let root: string;
let dir: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tp-serve-app-'));
  dir = join(root, 'dist');
  mkdirSync(dir);

  /**
   * A stub SSR bundle beside the client build, laid out the way `pnpm build` lays it out.
   *
   * Stubbed rather than built: this test is about the *wiring* — does the server find the bundle,
   * ask it whether a path is a site route, and put what it returns into the shell — and building
   * the real site here would make a routing test depend on React rendering.
   */
  mkdirSync(join(root, 'dist-server'));
  writeFileSync(
    join(root, 'dist-server', 'entry-server.js'),
    [
      "export const SITE_ROUTES = ['/', '/features/ledger'];",
      'export const isSiteRoute = (path) => SITE_ROUTES.includes(path);',
      'export const render = (path) => ({',
      '  html: `<div class="site">rendered ${path}</div>`,',
      `  head: '<title>Site</title><link rel="canonical" href="https://x.test/" />',`,
      `  styles: ':root{--x:1}',`,
      '});',
    ].join('\n'),
  );
  /**
   * A realistic shell, not `<div id="root">` on its own.
   *
   * The link preview injects before `</head>`, so a fixture without a head silently proved
   * nothing — the negative cases passed for the wrong reason and the positive one failed for a
   * reason that does not exist in production. What is served is a real document; the fixture
   * should be one.
   */
  writeFileSync(
    join(dir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <title>Formwork</title>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Formwork"}');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1)');

  app = await buildServer({
    repos: createMemoryRepositories({
      organisations: [testOrganisation],
      forms: [PUBLISHED_FORM, DRAFT_FORM],
      formVersions: [PUBLISHED_VERSION],
    }),
    mail: createMemoryMailProvider(),
    store: createMemoryDocumentStore(TEST_JWT_SECRET),
    renderer: createFakePdfRenderer(),
    jwtSecret: TEST_JWT_SECRET,
    appUrl: 'http://localhost:5173',
    probeDatabase: false,
    startWorker: false,
    serveAppFrom: dir,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('serving the built app from the API', () => {
  it('serves index.html at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('id="root"');
  });

  it('serves static assets', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log(1)');

    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifest.statusCode).toBe(200);
  });

  it.each(['/f/varmotet', '/check-in', '/events/some-id/registrations', '/deep/unknown/route'])(
    'falls back to the app shell for the client route %s',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('id="root"');
    },
  );

  it('keeps a query string off the decision', async () => {
    const response = await app.inject({ method: 'GET', url: '/f/varmotet?locale=en-GB' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('id="root"');
  });

  it.each(['/v1/nope', '/public/forms/nope-at-all', '/demo/info', '/openapi.json'])(
    'still answers %s as an API, not with the app shell',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.body).not.toContain('id="root"');
    },
  );

  it('404s an unknown API route as JSON', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not-found' } });
  });

  it('does not serve the app shell for a non-GET request', async () => {
    const response = await app.inject({ method: 'POST', url: '/f/varmotet' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not-found' } });
  });

  /**
   * The app is built to call `/api/v1/...`, because in development Vite proxies that here and
   * strips the prefix. In the container there is no proxy.
   *
   * This was found by opening the page rather than by reading the code: the shell rendered, and
   * then every request came back as HTML and the form reported that it did not exist. A container
   * that serves a broken app is worse than one that will not start.
   */
  describe('the /api prefix the app actually calls', () => {
    it('answers /api/health the same as /health', async () => {
      const direct = await app.inject({ method: 'GET', url: '/health' });
      const prefixed = await app.inject({ method: 'GET', url: '/api/health' });
      expect(prefixed.statusCode).toBe(200);
      expect(prefixed.json()).toMatchObject({ status: 'ok' });
      expect(prefixed.json()).toEqual(direct.json());
    });

    it('routes a prefixed API call to the API, not the app shell', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/public/forms/nope-at-all' });
      expect(response.body).not.toContain('id="root"');
      expect(response.headers['content-type']).toContain('application/json');
    });

    it('keeps the query string when stripping the prefix', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health?x=1' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok' });
    });

    it('404s an unknown /api route as JSON rather than as a page', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('id="root"');
      expect(response.json()).toMatchObject({ error: { code: 'not-found' } });
    });

    it('does not strip a client route that merely begins with the letters api', async () => {
      const response = await app.inject({ method: 'GET', url: '/apiary' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('id="root"');
    });
  });

  /**
   * Deploy a new build and a visitor still holding the previous index.html asks for asset hashes
   * that no longer exist. Answering those with the app shell makes the browser refuse the module
   * on MIME grounds and the page goes blank, reporting nothing useful. A 404 is recoverable.
   *
   * Found the way it happens in production: by rebuilding the app under a running server and then
   * wondering why the page was empty.
   */
  describe('a missing file is not a client route', () => {
    it.each([
      '/assets/index-DELETED.js',
      '/assets/index-DELETED.css',
      '/gone.js',
      '/icon-192.png',
      '/fonts/inter.woff2',
      '/old-service-worker.js.map',
    ])('404s %s rather than handing back the app shell', async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('id="root"');
    });

    it.each(['/f/varmotet', '/check-in', '/events/abc/registrations'])(
      'still serves the shell for %s, which has no extension',
      async (url) => {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('id="root"');
      },
    );

    it('serves the shell for a form slug containing a dot', async () => {
      // A trailing extension is the signal, not a dot anywhere in the path.
      const response = await app.inject({ method: 'GET', url: '/f/spring.meeting/details' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('id="root"');
    });
  });

  it('still answers /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  /**
   * The link preview.
   *
   * The whole distribution model here is "send somebody a link", and that link previewed in Slack,
   * WhatsApp and Teams as "Formwork" with no title and no organisation — an unlabelled link to an
   * unfamiliar domain asking for a name and an email, which is a reasonable thing to distrust.
   */
  describe('a public form link', () => {
    it('previews with the form title and the organisation', async () => {
      const response = await app.inject({ method: 'GET', url: '/f/varmotet' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('og:title" content="Anmälan till Vårmötet"');
      expect(response.body).toContain(`og:site_name" content="${testOrganisation.name}"`);
      expect(response.body).toContain('og:url" content="http://localhost:5173/f/varmotet"');
      // Still the app: the tags are added to the shell, not served instead of it.
      expect(response.body).toContain('id="root"');
    });

    it('says nothing at all about an unpublished form', async () => {
      const response = await app.inject({ method: 'GET', url: '/f/hemligt' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('id="root"');
      expect(response.body).not.toContain('Internt utkast');
      expect(response.body).not.toContain('og:title');
    });

    it('says nothing about a slug that does not exist', async () => {
      // A preview that confirms which slugs are real is a way to enumerate them.
      const response = await app.inject({ method: 'GET', url: '/f/no-such-form' });

      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('og:title');
    });

    it('leaves the app’s own screens unbranded', async () => {
      // Nobody pastes `/events/…` into a chat window, and those screens are behind a sign-in.
      const response = await app.inject({ method: 'GET', url: '/events/some-id/registrations' });
      expect(response.body).not.toContain('og:title');
    });
  });

  /**
   * The public site is rendered here, not in the browser.
   *
   * A landing page whose markup arrives empty and fills in once a bundle downloads is a page a
   * crawler reads as blank. These routes have no session and no fetch, so there is nothing to
   * stop the server drawing them.
   */
  describe('the public site', () => {
    it.each(['/', '/features/ledger'])('server-renders %s into the shell', async (url) => {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(`rendered ${url}`);
      // Into the shipped shell, not instead of it.
      expect(response.body).toContain('id="root"');
      expect(response.body).toContain('rel="canonical"');
    });

    /**
     * The root is the one that got away.
     *
     * `fastify-static` answers `/` with `index.html` before any handler runs, so the landing page
     * — the single page on this domain a search engine actually reads — was the only site route
     * still shipped as an empty shell while `/features/…` rendered correctly.
     */
    it('renders the root rather than serving the file on disk', async () => {
      const response = await app.inject({ method: 'GET', url: '/' });
      expect(response.body).toContain('rendered /');
    });

    it('leaves the app alone', async () => {
      // Behind a bearer token this server does not have, and no crawler on the other side of it.
      const response = await app.inject({ method: 'GET', url: '/events' });
      expect(response.body).not.toContain('class="site"');
      expect(response.body).toContain('id="root"');
    });
  });
});

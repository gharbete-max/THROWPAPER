import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
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
      "export const SITE_ROUTES = ['/', '/features/ledger', '/contact', '/contact/sent', '/sv'];",
      'export const isSiteRoute = (path) => SITE_ROUTES.includes(path);',
      "export const isSiteShaped = (path) => path.startsWith('/features/');",
      /*
       * The rendered markup is padded to a realistic size on purpose.
       *
       * A real site page is ~20 KB of prose and markup. A stub that returned one short `<div>`
       * sat under the compression threshold, so the compression assertions below passed for
       * static files and failed for the site — reporting a defect that exists only in the
       * fixture. Padding it is what makes this stub stand in for the thing it is standing in for.
       */
      'const filler = `<p>${"the door is a mode ".repeat(120)}</p>`;',
      'export const render = (path) => ({',
      '  status: SITE_ROUTES.includes(path) ? 200 : 404,',
      '  html: `<div class="site">rendered ${path}${filler}</div>`,',
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
      '    <title>Loppa</title>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Loppa"}');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1)');
  /**
   * A second asset, big enough to compress and named the way Vite names one.
   *
   * `index.js` above is fourteen bytes: under the compression threshold, so it proves nothing
   * about compression, and a test written against it would have passed whether or not the plugin
   * was registered. The content hash in the name is the other half — it is what makes the file
   * safe to cache forever, and the header assertions below are about exactly that name shape.
   */
  writeFileSync(
    join(dir, 'assets', 'index-D34DB33F.js'),
    `export const marks = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `mark-${i}`))};\n`,
  );

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
   * WhatsApp and Teams as "Loppa" with no title and no organisation — an unlabelled link to an
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

    /**
     * An address only the site could own, and does not have, is the site's 404 — not the app's
     * shell at 200. A crawler that gets a 200 for `/features/nothing` indexes it; a monitor never
     * learns the link on the brochure is dead.
     */
    it('answers a site-shaped address it does not have with the site’s own 404', async () => {
      const response = await app.inject({ method: 'GET', url: '/features/nothing' });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('rendered /features/nothing');
    });
  });

  /**
   * Nothing sits in front of this server to compress for it.
   *
   * The deployment is one container answering the public internet directly, so a response that
   * leaves here uncompressed is uncompressed when it arrives. That was every site page, every
   * JSON list and every JavaScript bundle.
   */
  describe('compression', () => {
    it('compresses a JavaScript bundle when the client offers brotli', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/assets/index-D34DB33F.js',
        headers: { 'accept-encoding': 'br' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBe('br');
      // The point of the exercise: fewer bytes on the wire than the file has on disk.
      const onDisk = statSync(join(dir, 'assets', 'index-D34DB33F.js')).size;
      expect(response.rawPayload.length).toBeLessThan(onDisk);
    });

    it('falls back to gzip for a client that cannot take brotli', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/assets/index-D34DB33F.js',
        headers: { 'accept-encoding': 'gzip' },
      });

      expect(response.headers['content-encoding']).toBe('gzip');
    });

    /**
     * The server-rendered site is the reason this plugin is here at all, and it is built per
     * request rather than read off disk — a different path through the plugin than a static file.
     */
    it('compresses the server-rendered site', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'accept-encoding': 'br' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBe('br');
      /*
       * `Vary` is the half that is easy to forget and expensive to get wrong: without it a shared
       * cache can hand a brotli body to a client that never asked for one.
       */
      expect(response.headers['vary']).toBe('accept-encoding');
    });

    /**
     * A client that asks for no encoding gets none, and gets a readable body.
     *
     * Worth asserting rather than assuming: a plugin that compressed regardless would break every
     * `curl` without flags, and — more to the point — every one of the assertions above this
     * `describe` block, which read `response.body` as text.
     */
    it('leaves a response alone when nothing is offered', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/assets/index-D34DB33F.js',
        headers: { 'accept-encoding': 'identity' },
      });

      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.body).toContain('mark-399');
    });
  });

  /**
   * Everything went out as `max-age=0` — `fastify-static`'s default, and a round trip per bundle
   * per navigation to be told nothing had changed. The policy itself is unit-tested in
   * `cache-headers.test.ts`; these are about the wiring, which is the half that was wrong.
   */
  describe('cache headers', () => {
    it('keeps a content-hashed bundle for a year', async () => {
      const response = await app.inject({ method: 'GET', url: '/assets/index-D34DB33F.js' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });

    /**
     * The plugin writes its own `cache-control` unless told not to, and when both are set the
     * plugin wins — so this asserts the absence of the old value as much as the presence of the
     * new one.
     */
    it('no longer sends the plugin’s own max-age=0', async () => {
      const response = await app.inject({ method: 'GET', url: '/assets/index-D34DB33F.js' });
      expect(response.headers['cache-control']).not.toContain('max-age=0');
    });

    it('revalidates the shell rather than keeping it', async () => {
      // `/events` is a client route: no site page, no preview — the plain shipped shell.
      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.body).toContain('id="root"');
      expect(response.headers['cache-control']).toBe('no-cache');
    });

    /**
     * A site page changes with the build and cannot be renamed the way a bundle can.
     */
    it('revalidates a server-rendered page', async () => {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-cache');
    });

    it('revalidates the manifest', async () => {
      const response = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-cache');
    });
  });

  /**
   * Both of these answered 404 — as JSON, from the not-found handler — which is what a crawler got
   * when it asked what it was allowed to read and what there was to read. The documents themselves
   * are unit-tested in `sitemap.test.ts`; these are about them being reachable and correctly typed.
   */
  describe('telling a crawler what is here', () => {
    it('serves robots.txt as plain text', async () => {
      const response = await app.inject({ method: 'GET', url: '/robots.txt' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toContain('User-agent: *');
    });

    /** The origin is `APP_URL`, not the request's `Host` — the same value the canonicals use. */
    it('points robots.txt at the sitemap on the configured origin', async () => {
      const response = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(response.body).toContain('Sitemap: http://localhost:5173/sitemap.xml');
    });

    it('serves sitemap.xml as XML, built from the site’s own routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/xml');
      expect(response.body).toContain('<loc>http://localhost:5173/</loc>');
      expect(response.body).toContain('<loc>http://localhost:5173/features/ledger</loc>');
      expect(response.body).toContain('<loc>http://localhost:5173/sv</loc>');
    });

    it('leaves the contact confirmation out of the sitemap', async () => {
      const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

      expect(response.body).not.toContain('/contact/sent');
      expect(response.body).toContain('<loc>http://localhost:5173/contact</loc>');
    });

    /**
     * Neither may be swallowed by the SPA fallback. Answering `/robots.txt` with the app shell is
     * the failure this replaces, only harder to notice — it would be a 200.
     */
    it.each(['/robots.txt', '/sitemap.xml'])(
      'does not answer %s with the app shell',
      async (url) => {
        const response = await app.inject({ method: 'GET', url });
        expect(response.body).not.toContain('id="root"');
      },
    );
  });
});

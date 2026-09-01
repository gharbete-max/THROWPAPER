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
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tp-serve-app-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Formwork"}');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log(1)');

  app = await buildServer({
    repos: createMemoryRepositories({ organisations: [testOrganisation] }),
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
  rmSync(dir, { recursive: true, force: true });
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

  it('still answers /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

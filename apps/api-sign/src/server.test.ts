import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@tp/shared';
import { CONTRACT_ENDPOINTS } from '@tp/shared/contract';
import { buildServer } from './server.js';
import { registry } from './contract-registry.js';
import type { Db } from './db/client.js';
import { generateDevCertificate, loadSealer } from './sealing/certificate.js';

/** No route below reaches the database; a server that tried would throw on this. */
const noDatabase = {} as Db;
const sealer = await loadSealer(await generateDevCertificate());

function server() {
  return buildServer({
    db: noDatabase,
    linkSecret: 'x'.repeat(32),
    publicUrl: 'https://sign.example.test',
    apiUrl: 'https://api.sign.example.test',
    sealer,
  });
}

describe('the signing page, served from the same origin', () => {
  async function withApp() {
    const dir = mkdtempSync(join(tmpdir(), 'tp-sign-app-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>page</title>');
    const app = await buildServer({
      db: noDatabase,
      linkSecret: 'x'.repeat(32),
      publicUrl: 'https://sign.example.test',
      apiUrl: 'https://sign.example.test/api',
      sealer,
      serveAppFrom: dir,
    });
    return app;
  }

  it('answers a signing link with the page, never cached, and never leaking the link', async () => {
    const app = await withApp();
    const page = await app.inject({ method: 'GET', url: '/s/some.token.value' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>page</title>');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('strips /api for the page, and keeps an unknown API path a JSON 404', async () => {
    const app = await withApp();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().status).toBe('ok');
    const missing = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not-found');
    await app.close();
  });
});

describe('the Sign backend', () => {
  it('answers its health check with the contract it speaks', async () => {
    const app = await server();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api-sign',
      contractVersion: CONTRACT_VERSION,
    });
    await app.close();
  });

  /**
   * `pnpm contract:check` reads the registry's "implemented" and believes it. This holds the claim
   * to the thing: every endpoint Sign says it implements is a route Sign serves.
   */
  it('serves every contract endpoint its registry calls implemented', async () => {
    const app = await server();
    await app.ready();
    const claimed = registry.entries.filter((entry) => entry.status === 'implemented');
    expect(claimed.length).toBeGreaterThan(0);
    for (const entry of claimed) {
      const endpoint = CONTRACT_ENDPOINTS.find((candidate) => candidate.id === entry.id)!;
      expect(app.hasRoute({ method: endpoint.method, url: endpoint.path }), entry.id).toBe(true);
    }
    await app.close();
  });
});

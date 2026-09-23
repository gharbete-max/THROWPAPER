import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@tp/shared';
import { CONTRACT_ENDPOINTS } from '@tp/shared/contract';
import { buildServer } from './server.js';
import { registry } from './contract-registry.js';
import type { Db } from './db/client.js';

/** No route below reaches the database; a server that tried would throw on this. */
const noDatabase = {} as Db;

function server() {
  return buildServer({
    db: noDatabase,
    linkSecret: 'x'.repeat(32),
    publicUrl: 'https://sign.example.test',
  });
}

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

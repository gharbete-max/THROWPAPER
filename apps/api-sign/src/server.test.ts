import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '@tp/shared';
import { buildServer } from './server.js';

describe('the Sign backend', () => {
  it('answers its health check with the contract it speaks', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api-sign',
      contractVersion: CONTRACT_VERSION,
    });
    await app.close();
  });

  it('serves no envelope route before the storage that makes one safe exists', async () => {
    const app = await buildServer();
    const response = await app.inject({ method: 'POST', url: '/v1/envelopes', payload: {} });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

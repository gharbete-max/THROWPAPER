import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IdentityProvider } from '@tp/signing';
import { buildServer } from '../server.js';
import { testDatabase, usePglite } from '../test-database.js';
import { serviceTokens } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { sha256 } from '../envelopes/store.js';
import { generateDevCertificate, loadSealer } from '../sealing/certificate.js';
import {
  CONSOLE_IDENTITY_NAME,
  createConsoleIdentityProvider,
  identityProvidersFromEnv,
} from './providers.js';

/** CONTRACT §5.6 on the desktop's database: nothing offered unless configured, and never a lie. */
usePglite();
const database = (await testDatabase())!;
const db: Db = database.db;
const sealer = await loadSealer(await generateDevCertificate());
const ORG = randomUUID();
const OTHER = randomUUID();
const HASH = 'a'.repeat(64);

async function tokenFor(organisationId: string): Promise<string> {
  const token = `svc_${randomUUID()}`;
  await db.insert(serviceTokens).values({
    organisationId,
    name: 'forms',
    tokenSha256: sha256(token),
    allowedOrigins: ['http://forms.test'],
  });
  return token;
}

async function server(identity: IdentityProvider[]): Promise<FastifyInstance> {
  const app = await buildServer({
    db,
    linkSecret: 'test-link-secret-at-least-thirty-two-chars',
    publicUrl: 'http://sign.test',
    apiUrl: 'http://sign.test',
    sealer,
    identity,
  });
  await app.ready();
  return app;
}

let none: FastifyInstance;
let withConsole: FastifyInstance;
let token: string;
let otherToken: string;

beforeAll(async () => {
  none = await server([]);
  withConsole = await server([createConsoleIdentityProvider()]);
  token = await tokenFor(ORG);
  otherToken = await tokenFor(OTHER);
});

afterAll(async () => {
  await none.close();
  await withConsole.close();
  await database.drop();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

function start(app: FastifyInstance, t: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/identity/sessions',
    headers: auth(t),
    payload: {
      organisationId: ORG,
      method: 'console',
      documentSha256: HASH,
      locale: 'sv-SE',
      idempotencyKey: `idem-${randomUUID()}`,
      ...overrides,
    },
  });
}

describe('which providers exist', () => {
  it('none, unless one is named', () => {
    expect(identityProvidersFromEnv({})).toEqual([]);
    expect(identityProvidersFromEnv({ EID_PROVIDER: '' })).toEqual([]);
  });

  it('the development provider, outside production only', () => {
    expect(identityProvidersFromEnv({ EID_PROVIDER: 'console' })).toHaveLength(1);
    expect(() =>
      identityProvidersFromEnv({ EID_PROVIDER: 'console', NODE_ENV: 'production' }),
    ).toThrow(/cannot run in production/);
  });

  it('refuses a provider name it does not know rather than pretending', () => {
    expect(() => identityProvidersFromEnv({ EID_PROVIDER: 'bankid' })).toThrow(/not a provider/);
  });
});

describe('§5.6', () => {
  it('answers only a service token', async () => {
    const response = await none.inject({ method: 'GET', url: '/v1/identity/methods' });
    expect(response.statusCode).toBe(401);
  });

  it('offers no method when no provider is configured, and refuses to start one', async () => {
    const methods = await none.inject({
      method: 'GET',
      url: '/v1/identity/methods',
      headers: auth(token),
    });
    expect(methods.json()).toEqual({ methods: [] });
    const started = await start(none, token);
    expect(started.statusCode).toBe(422);
    expect(started.json().error.code).toBe('method-unavailable');
  });

  it('with the development provider: test environment, simple level, and a name saying so', async () => {
    const methods = await withConsole.inject({
      method: 'GET',
      url: '/v1/identity/methods',
      headers: auth(token),
    });
    expect(methods.json()).toEqual({
      methods: [{ method: 'console', provider: 'console', environment: 'test' }],
    });

    const started = await start(withConsole, token);
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ status: 'complete', environment: 'test' });
    expect(started.json()).not.toHaveProperty('launchUrl');

    const result = await withConsole.inject({
      method: 'GET',
      url: `/v1/identity/sessions/${started.json().reference}`,
      headers: auth(token),
    });
    expect(result.json()).toEqual({
      reference: started.json().reference,
      status: 'complete',
      environment: 'test',
      documentSha256: HASH,
      method: 'console',
      level: 'simple',
      name: CONSOLE_IDENTITY_NAME,
    });
  });

  it('caps a provider that claims more than its method can carry', async () => {
    const boastful: IdentityProvider = {
      name: 'boastful',
      environment: 'test',
      methods: ['console'],
      sign: async () => ({ reference: 'r1', status: 'complete' }),
      result: async () => ({
        reference: 'r1',
        status: 'complete',
        environment: 'production',
        method: 'console',
        level: 'qualified',
      }),
    };
    const app = await server([boastful]);
    try {
      const started = await start(app, token);
      const result = await app.inject({
        method: 'GET',
        url: `/v1/identity/sessions/${started.json().reference}`,
        headers: auth(token),
      });
      expect(result.json().level).toBe('simple');
      // The provider's own environment, not the result's claim.
      expect(result.json().environment).toBe('test');
    } finally {
      await app.close();
    }
  });

  it('keeps one organisation out of another’s sessions', async () => {
    const started = await start(withConsole, token);
    const peek = await withConsole.inject({
      method: 'GET',
      url: `/v1/identity/sessions/${started.json().reference}`,
      headers: auth(otherToken),
    });
    expect(peek.statusCode).toBe(404);
    const wrongOrg = await start(withConsole, otherToken);
    expect(wrongOrg.statusCode).toBe(403);
  });
});

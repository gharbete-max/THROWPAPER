import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { createMemoryMailTransport } from './auth/mail.js';
import { createMemoryRepositories, type MemoryState } from './db/repositories/index.js';
import type { OrganisationRecord, UserRecord } from './db/repositories/index.js';

/**
 * Builds a server over in-memory repositories, so the rules that matter can be tested without a
 * Postgres to hand. CI runs the Drizzle implementation against a real database as well.
 */
export const TEST_JWT_SECRET = 'test-secret-at-least-thirty-two-characters-long';

export const testOrganisation: OrganisationRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Demo AB',
  slug: 'demo',
  defaultLocale: 'sv-SE',
  supportedLocales: ['sv-SE', 'en-GB'],
};

export const adminUser: UserRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  organisationId: testOrganisation.id,
  email: 'admin@example.com',
  name: 'Alva Admin',
  role: 'admin',
  disabledAt: null,
};

export const operatorUser: UserRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  organisationId: testOrganisation.id,
  email: 'operator@example.com',
  name: 'Oskar Operatör',
  role: 'operator',
  disabledAt: null,
};

export interface TestHarness {
  app: FastifyInstance;
  state: MemoryState;
  mail: ReturnType<typeof createMemoryMailTransport>;
  close: () => Promise<void>;
}

export async function createTestHarness(seed: Partial<MemoryState> = {}): Promise<TestHarness> {
  const repos = createMemoryRepositories({
    organisations: [testOrganisation],
    users: [adminUser, operatorUser],
    ...seed,
  });
  const mail = createMemoryMailTransport();

  const app = await buildServer({
    repos,
    mail,
    jwtSecret: TEST_JWT_SECRET,
    appUrl: 'http://localhost:5173',
    probeDatabase: false,
  });
  await app.ready();

  return { app, state: repos.state, mail, close: () => app.close() };
}

/** Runs the full magic-link round trip and returns the resulting token pair. */
export async function signIn(harness: TestHarness, email: string) {
  await harness.app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link',
    payload: { email },
  });

  const link = harness.mail.sent.at(-1)?.text ?? '';
  const token = /token=([A-Za-z0-9_-]+)/.exec(link)?.[1];
  if (!token) throw new Error(`No magic link was sent to ${email}`);

  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/auth/token',
    payload: { token },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Exchange failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; role: string };
  };
}

export function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

/** A valid event body, so tests only state the field they care about. */
export function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    name: { 'sv-SE': 'Vårmötet', 'en-GB': 'Spring meeting' },
    description: { 'sv-SE': 'Årets viktigaste möte.' },
    startsAt: '2026-05-14T09:00:00.000Z',
    endsAt: '2026-05-14T16:00:00.000Z',
    venueName: 'Storgatan 19',
    capacity: 2,
    status: 'open',
    ...overrides,
  };
}

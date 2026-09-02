import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { createMemoryMailProvider } from './auth/mail.js';
import { createMemoryRepositories, type MemoryState } from './db/repositories/index.js';
import type { OrganisationRecord, Repositories, UserRecord } from './db/repositories/index.js';
import { createMemoryDocumentStore } from './documents/store.js';
import { createMemoryAssetStore } from './uploads/store.js';
import { createMemoryUploadStore } from './uploads/private-store.js';
import type { DocumentStore } from './documents/store.js';
import type { PdfRenderer } from './documents/render.js';

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

/**
 * A renderer that does not launch Chromium.
 *
 * Route and job tests care about orchestration — which documents were produced, what the job
 * recorded, whether a failure was survived. The real renderer is exercised by admission.test.ts,
 * which is the slow one and only needs to run once.
 */
export function createFakePdfRenderer(
  options: { failOn?: (html: string) => boolean } = {},
): PdfRenderer & { rendered: string[] } {
  const rendered: string[] = [];
  return {
    rendered,
    async render(html) {
      if (options.failOn?.(html)) throw new Error('render failed');
      rendered.push(html);
      return Buffer.from(`%PDF-1.4 fake ${rendered.length}`);
    },
    async close() {},
  };
}

export interface TestHarness {
  app: FastifyInstance;
  repos: Repositories;
  state: MemoryState;
  mail: ReturnType<typeof createMemoryMailProvider>;
  store: DocumentStore & { files: Map<string, Buffer> };
  uploadStore: ReturnType<typeof createMemoryUploadStore>;
  assets: ReturnType<typeof createMemoryAssetStore>;
  renderer: PdfRenderer & { rendered: string[] };
  close: () => Promise<void>;
}

export async function createTestHarness(
  seed: Partial<MemoryState> = {},
  options: { renderer?: PdfRenderer & { rendered: string[] } } = {},
): Promise<TestHarness> {
  const repos = createMemoryRepositories({
    organisations: [testOrganisation],
    users: [adminUser, operatorUser],
    ...seed,
  });
  const mail = createMemoryMailProvider();
  const store = createMemoryDocumentStore(TEST_JWT_SECRET);
  const assets = createMemoryAssetStore();
  const uploadStore = createMemoryUploadStore();
  const renderer = options.renderer ?? createFakePdfRenderer();

  const app = await buildServer({
    repos,
    mail,
    store,
    assets,
    uploadStore,
    renderer,
    jwtSecret: TEST_JWT_SECRET,
    appUrl: 'http://localhost:5173',
    probeDatabase: false,
    // Tests drain the queue by hand, so a job runs exactly when the test says it does.
    startWorker: false,
  });
  await app.ready();

  return {
    app,
    repos,
    state: repos.state,
    mail,
    store,
    assets,
    uploadStore,
    renderer,
    close: () => app.close(),
  };
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

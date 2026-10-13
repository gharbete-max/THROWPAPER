import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { buildServer } from '../server.js';
import { createDrizzleRepositories } from '../db/repositories/index.js';
import * as schema from '../db/schema.js';
import { signAccessToken } from '../auth/tokens.js';
import { createMemoryMailProvider } from '../auth/mail.js';
import { createMemoryDocumentStore } from '../documents/store.js';
import { createMemoryAssetStore } from '../uploads/store.js';
import { createMemoryUploadStore } from '../uploads/private-store.js';
import {
  TEST_DOCUMENT_SECRET,
  TEST_JWT_SECRET,
  bearer,
  createFakePdfRenderer,
} from '../test-support.js';

/**
 * Sending, over a real Postgres: the queued jobs, their idempotency key and their status are rows,
 * not a fake's array. Skipped, loudly, where there is no migrated database (as `database.test.ts`).
 */
const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const sql = postgres(url, { max: 2, connect_timeout: 3, onnotice: () => {} });
const migrated = await sql`select 1 from jobs limit 1`.then(
  () => true,
  () => false,
);
const SLUG = 'send-db-test';

afterAll(async () => {
  if (migrated) await sql`delete from organisations where slug = ${SLUG}`;
  await sql.end();
});

describe.skipIf(!migrated)('send over a real database', () => {
  it('queues once per key and recipient, sends on the worker, and reports each', async () => {
    const repos = createDrizzleRepositories(drizzle(sql, { schema }));
    const [org] = await sql`
      insert into organisations (name, slug, default_locale, supported_locales)
      values ('Send Test AB', ${SLUG}, 'sv-SE', ${sql.array(['sv-SE'])})
      on conflict (slug) do update set name = excluded.name returning id`;
    const organisationId = String(org!['id']);
    const user =
      (await repos.users.findByEmail(organisationId, 'send@example.com')) ??
      (await repos.users.create({
        organisationId,
        email: 'send@example.com',
        name: 'Sture',
        role: 'admin',
      }))!;
    expect(user.organisationId).toBe(organisationId);

    const mail = createMemoryMailProvider();
    const app = await buildServer({
      repos,
      mail,
      store: createMemoryDocumentStore(TEST_DOCUMENT_SECRET),
      assets: createMemoryAssetStore(),
      uploadStore: createMemoryUploadStore(),
      renderer: createFakePdfRenderer(),
      jwtSecret: TEST_JWT_SECRET,
      documentSigningSecret: TEST_DOCUMENT_SECRET,
      appUrl: 'http://localhost:5173',
      probeDatabase: false,
      startWorker: false,
      contactAddress: null,
      signing: null,
    });
    await app.ready();
    try {
      const headers = bearer(
        await signAccessToken(
          { userId: user.id, organisationId, role: user.role },
          TEST_JWT_SECRET,
        ),
      );
      mail.sent.length = 0;

      const key = crypto.randomUUID();
      const body = {
        key,
        confirmed: true,
        template: {
          layout: 'letter',
          locale: 'sv-SE',
          currency: 'SEK',
          title: 'Hej {{name}}',
          body: '{{amount}}',
        },
        subject: 'Hej',
        message: '',
        rows: [1, 2, 3].map((n) => ({
          name: `Person ${n}`,
          email: `p${n}@example.com`,
          amount: `${n}00,50`,
          reference: String(n),
        })),
      };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/send/batch',
        headers,
        payload: body,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/v1/send/batch',
        headers,
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      // The same press twice: the same three rows, not six.
      expect(second.json().items.map((i: { id: string }) => i.id)).toEqual(
        first.json().items.map((i: { id: string }) => i.id),
      );
      const [{ count }] = (await sql`select count(*)::int as count from jobs
        where organisation_id = ${organisationId} and kind = 'send.document'`) as unknown as [
        { count: number },
      ];
      expect(count).toBe(3);
      expect(mail.sent).toHaveLength(0);

      await app.worker.drain(50);
      expect(mail.sent.map((m) => m.to)).toEqual([
        'p1@example.com',
        'p2@example.com',
        'p3@example.com',
      ]);
      const ids = first
        .json()
        .items.map((i: { id: string }) => i.id)
        .join(',');
      const status = await app.inject({
        method: 'GET',
        url: `/v1/send/status?ids=${ids}`,
        headers,
      });
      expect(status.json().items.map((i: { state: string }) => i.state)).toEqual([
        'sent',
        'sent',
        'sent',
      ]);
    } finally {
      await app.close();
    }
  });
});

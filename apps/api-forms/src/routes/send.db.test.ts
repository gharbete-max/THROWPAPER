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
 * Sending and campaigns, over a real Postgres: the queued jobs, their idempotency key and their status are rows,
 * not a fake's array. Skipped, loudly, where there is no migrated database (as `database.test.ts`).
 */
const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const sql = postgres(url, { max: 2, connect_timeout: 3, onnotice: () => {} });
const migrated = await sql`select 1 from jobs, campaign_suppressions limit 1`.then(
  () => true,
  () => false,
);
const SLUG = 'send-db-test';
// Campaigns share this file because the worker takes any queued job: two files draining one database at once would take each other's.
const CAMPAIGN_SLUG = 'campaign-db-test';

afterAll(async () => {
  if (migrated) await sql`delete from organisations where slug in (${SLUG}, ${CAMPAIGN_SLUG})`;
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

  it('queues once per key and address, skips the suppressed, and an unsubscribe stops the next', async () => {
    const repos = createDrizzleRepositories(drizzle(sql, { schema }));
    const [org] = await sql`
      insert into organisations (name, slug, default_locale, supported_locales)
      values ('Campaign Test AB', ${CAMPAIGN_SLUG}, 'sv-SE', ${sql.array(['sv-SE'])})
      on conflict (slug) do update set name = excluded.name returning id`;
    const organisationId = String(org!['id']);
    const user =
      (await repos.users.findByEmail(organisationId, 'campaign@example.com')) ??
      (await repos.users.create({
        organisationId,
        email: 'campaign@example.com',
        name: 'Sture',
        role: 'admin',
      }))!;
    await sql`delete from campaign_suppressions where organisation_id = ${organisationId}`;
    await sql`delete from jobs where organisation_id = ${organisationId}`;

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
      const body = (key: string) => ({
        key,
        confirmed: true,
        subject: 'News {{name | friend}}',
        body: 'Hello {{name | there}}',
        footer: 'Sender. Stop: {{unsubscribe}}',
        rows: ['a', 'b', 'c'].map((n) => ({
          name: n === 'c' ? '' : `Person ${n}`,
          email: `${n}@campaign-db.example.com`,
          amount: '',
          reference: '',
        })),
      });
      const key = crypto.randomUUID();

      // The repository: added once, first reason kept, scoped to the organisation.
      const list = repos.campaignSuppressions;
      await list.add(organisationId, ' B@Campaign-Db.example.com ', 'bounced');
      await list.add(organisationId, 'b@campaign-db.example.com', 'manual');
      expect((await list.list(organisationId)).map((e) => [e.email, e.reason])).toEqual([
        ['b@campaign-db.example.com', 'bounced'],
      ]);
      expect(
        await list.among('00000000-0000-4000-8000-000000000000', ['b@campaign-db.example.com']),
      ).toEqual([]);

      const first = await app.inject({
        method: 'POST',
        url: '/v1/send/campaign',
        headers,
        payload: body(key),
      });
      const second = await app.inject({
        method: 'POST',
        url: '/v1/send/campaign',
        headers,
        payload: body(key),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().skipped).toEqual(['b@campaign-db.example.com']);
      expect(second.json().items.map((i: { id: string }) => i.id)).toEqual(
        first.json().items.map((i: { id: string }) => i.id),
      );
      const [{ count }] = (await sql`select count(*)::int as count from jobs
        where organisation_id = ${organisationId} and kind = 'send.campaign'`) as unknown as [
        { count: number },
      ];
      expect(count).toBe(2);

      await app.worker.drain(50);
      expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
        ['a@campaign-db.example.com', 'News Person a'],
        ['c@campaign-db.example.com', 'News friend'],
      ]);

      // A's own link: asking records nothing, the press does, and the next campaign skips A.
      const link = /api(\/v1\/unsubscribe\?t=\S+)/.exec(mail.sent[0]!.text)![1]!;
      expect((await app.inject({ method: 'GET', url: link })).statusCode).toBe(200);
      expect(await list.among(organisationId, ['a@campaign-db.example.com'])).toEqual([]);
      const done = await app.inject({ method: 'POST', url: link });
      expect(done.statusCode).toBe(200);
      expect(done.body).toContain('a@campaign-db.example.com');
      expect(await list.among(organisationId, ['a@campaign-db.example.com'])).toEqual([
        'a@campaign-db.example.com',
      ]);
      const next = await app.inject({
        method: 'POST',
        url: '/v1/send/campaign',
        headers,
        payload: body(crypto.randomUUID()),
      });
      expect(next.json().skipped).toEqual([
        'a@campaign-db.example.com',
        'b@campaign-db.example.com',
      ]);
    } finally {
      await app.close();
    }
  });
});

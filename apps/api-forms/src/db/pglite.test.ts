import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalDatabase } from './pglite.js';
import { seedDemo } from './seed-demo.js';
import { bootstrapWorkspace, mintLocalSignInLink } from '../desktop/workspace.js';
import { createAuthService } from '../auth/service.js';
import { createMemoryMailProvider } from '../mail/provider.js';

/**
 * The desktop edition's claim, measured: the migrations and the Drizzle repositories the server
 * runs on Postgres run unchanged on the embedded one.
 *
 * `database.test.ts` skips without a Postgres, so on most machines it proves nothing. This file
 * needs no server, which is the point of PGlite — it always runs.
 */
const migrationsFolder = join(import.meta.dirname, '..', '..', 'drizzle');
const scratch = await mkdtemp(join(tmpdir(), 'loppa-pglite-'));

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// Each test boots a WebAssembly Postgres and runs sixteen migrations: seconds, not milliseconds.
describe('the embedded database', { timeout: 60_000 }, () => {
  it('applies every migration and round-trips the demo seed through the repositories', async () => {
    const local = await openLocalDatabase({ migrationsFolder });
    try {
      const { organisationId, formSlug } = await seedDemo(local.db);

      const organisation = await local.repos.organisations.first();
      expect(organisation?.id).toBe(organisationId);
      expect(organisation?.supportedLocales).toEqual(['sv-SE', 'en-GB']);

      const form = await local.repos.forms.findBySlug(organisationId, formSlug);
      expect(form).not.toBeNull();
      expect(await local.repos.submissions.countComplete(form!.id)).toBe(200);

      // Per-locale JSONB text with å ä ö, through a driver that is not postgres.js.
      const [event] = await local.repos.events.list(organisationId);
      expect(event?.venueName).toBe('Näringslivets Hus');

      // A second seed is a no-op, as `pnpm db:seed` promises.
      await seedDemo(local.db);
      expect(await local.repos.submissions.countComplete(form!.id)).toBe(200);
    } finally {
      await local.close();
    }
  });

  it('claims a job exactly once — the update-returning path the worker depends on', async () => {
    const local = await openLocalDatabase({ migrationsFolder });
    try {
      const { organisationId } = await seedDemo(local.db);
      const job = await local.repos.jobs.enqueue({
        organisationId,
        kind: 'noop',
        idempotencyKey: 'pglite-test',
        payload: {},
        progressTotal: 1,
      });
      const again = await local.repos.jobs.enqueue({
        organisationId,
        kind: 'noop',
        idempotencyKey: 'pglite-test',
        payload: {},
        progressTotal: 1,
      });
      expect(again.id).toBe(job.id);

      const claimed = await local.repos.jobs.claim(new Date(Date.now() + 1000));
      expect(claimed?.id).toBe(job.id);
      expect(await local.repos.jobs.claim(new Date(Date.now() + 1000))).toBeNull();
    } finally {
      await local.close();
    }
  });

  it('keeps what it wrote across a close and a reopen of the same directory', async () => {
    const dataDir = join(scratch, 'persist');
    const first = await openLocalDatabase({ dataDir, migrationsFolder });
    await bootstrapWorkspace(first.db, {
      organisationName: 'Föreningen Åkervägen',
      name: 'Örjan Ägare',
      email: 'Orjan@Example.com',
    });
    await first.close();

    const second = await openLocalDatabase({ dataDir, migrationsFolder });
    try {
      const organisation = await second.repos.organisations.first();
      expect(organisation?.name).toBe('Föreningen Åkervägen');
      const admin = await second.repos.users.findByEmail(organisation!.id, 'orjan@example.com');
      expect(admin?.role).toBe('admin');

      // Bootstrapping a workspace that already has an organisation writes nothing.
      expect(
        await bootstrapWorkspace(second.db, {
          organisationName: 'Someone else',
          name: 'Intruder',
          email: 'intruder@example.com',
        }),
      ).toBe(false);
      expect(await second.repos.users.list(organisation!.id)).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});

describe('the local sign-in link', { timeout: 60_000 }, () => {
  it('is an ordinary single-use magic link, exchanged by the ordinary auth service', async () => {
    const local = await openLocalDatabase({ migrationsFolder });
    try {
      expect(await mintLocalSignInLink(local.repos, 'http://127.0.0.1:4101')).toBeNull();

      await bootstrapWorkspace(local.db, {
        organisationName: 'Local AB',
        name: 'Ada',
        email: 'ada@example.com',
      });
      const link = await mintLocalSignInLink(local.repos, 'http://127.0.0.1:4101/');
      expect(link).toMatch(/^http:\/\/127\.0\.0\.1:4101\/auth\/callback\?token=/);

      const token = new URL(link!).searchParams.get('token')!;
      const auth = createAuthService({
        repos: local.repos,
        mail: createMemoryMailProvider(),
        config: { jwtSecret: 'x'.repeat(32), appUrl: 'http://127.0.0.1:4101' },
      });
      const first = await auth.exchange(token);
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.session.user.email).toBe('ada@example.com');

      // Replayed, it fails — the link is not a standing bypass.
      const second = await auth.exchange(token);
      expect(second).toEqual({ ok: false, reason: 'used' });
    } finally {
      await local.close();
    }
  });
});

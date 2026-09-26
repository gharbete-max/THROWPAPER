import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDrizzleRepositories } from './repositories/index.js';
import * as schema from './schema.js';

/**
 * The one test that needs a real Postgres.
 *
 * Everything else runs against the in-memory repositories, so `pnpm verify` is meaningful without
 * Docker. This covers what a fake cannot: that the migration matches the schema and that the
 * Drizzle implementation round-trips through it.
 *
 * It creates and removes its own organisation rather than reading the seed, so it depends on the
 * migration alone. A test that needed `pnpm db:seed` to have run first would be a second, hidden
 * ordering requirement — and an ordering mistake in CI is exactly what this file caught.
 */
const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });

const connected = await sql`select 1`.then(
  () => true,
  () => false,
);
// Present but unmigrated is a different problem from absent, and deserves a different message.
const migrated = connected
  ? await sql`select 1 from organisations limit 1`.then(
      () => true,
      () => false,
    )
  : false;

const SLUG = 'smoke-test-org';
/** One organisation per user test — see `freshOrganisation`. Removed together in `afterAll`. */
const USERS_SLUG_PREFIX = 'smoke-users-';

afterAll(async () => {
  if (migrated) {
    await sql`delete from organisations where slug = ${SLUG}`;
    // Users cascade with their organisation, so removing these removes the people too.
    await sql`delete from organisations where slug like ${USERS_SLUG_PREFIX + '%'}`;
  }
  await sql.end();
});

describe.skipIf(!migrated)('drizzle repositories against a real database', () => {
  const db = drizzle(sql, { schema });
  const repos = createDrizzleRepositories(db);

  async function organisation() {
    const [row] = await sql`
      insert into organisations (name, slug, default_locale, supported_locales)
      values ('Smoke Test AB', ${SLUG}, 'sv-SE', ${sql.array(['sv-SE', 'en-GB'])})
      on conflict (slug) do update set name = excluded.name
      returning id
    `;
    if (!row) throw new Error('could not create the smoke-test organisation');
    return String(row['id']);
  }

  it('reads an organisation back with its locale configuration', async () => {
    const id = await organisation();
    const found = await repos.organisations.findById(id);
    expect(found?.slug).toBe(SLUG);
    expect(found?.supportedLocales).toEqual(['sv-SE', 'en-GB']);
    expect(found?.defaultLocale).toBe('sv-SE');
  });

  it('round-trips an event, including per-locale JSONB text', async () => {
    const organisationId = await organisation();

    const created = await repos.events.create({
      organisationId,
      name: { 'sv-SE': 'Testmöte åäö', 'en-GB': 'Test meeting' },
      description: {},
      startsAt: new Date('2027-01-01T09:00:00Z'),
      endsAt: new Date('2027-01-01T10:00:00Z'),
      venueName: null,
      venueAddress: null,
      capacity: null,
      registrationClosesAt: null,
      status: 'draft',
    });

    const fetched = await repos.events.findById(organisationId, created.id);
    // Nordic characters must survive the JSONB round trip, not just the PDF.
    expect(fetched?.name['sv-SE']).toBe('Testmöte åäö');
    expect(fetched?.name['en-GB']).toBe('Test meeting');

    const updated = await repos.events.update(organisationId, created.id, { status: 'open' });
    expect(updated?.status).toBe('open');
  });

  /**
   * The user writes, against the database that actually enforces them.
   *
   * Every other test of these two methods runs on the in-memory repository, which reimplements the
   * last-administrator rule in JavaScript. That proves the *rule*, and proves nothing about the
   * implementation that ships: the unique index, the `FOR UPDATE` lock and the transaction around
   * them exist only here, and until this test ran they had never executed anywhere.
   */
  describe('administering people', () => {
    /**
     * A fresh organisation per test, unlike the shared one above.
     *
     * `organisation()` upserts a single slug, so every test that used it would share one tenant —
     * and these tests are about *"the only enabled administrator"*, a property that stops being
     * true the moment a previous test's administrator is still lying around. Which it is: the
     * demotion tests deliberately leave theirs in place, because the write was refused.
     */
    let counter = 0;
    async function freshOrganisation() {
      counter += 1;
      const slug = `${USERS_SLUG_PREFIX}${counter}`;
      const [row] = await sql`
        insert into organisations (name, slug, default_locale, supported_locales)
        values ('Users Test AB', ${slug}, 'sv-SE', ${sql.array(['sv-SE'])})
        returning id
      `;
      if (!row) throw new Error('could not create the users-test organisation');
      return String(row['id']);
    }

    async function admin(organisationId: string, email: string) {
      const person = await repos.users.create({
        organisationId,
        email,
        name: 'Alva',
        role: 'admin',
      });
      if (!person) throw new Error(`could not create ${email}`);
      return person;
    }

    it('creates somebody and folds the address to lower case', async () => {
      const organisationId = await freshOrganisation();
      const person = await repos.users.create({
        organisationId,
        email: 'Kim@Example.COM',
        name: 'Kim',
        role: 'operator',
      });

      expect(person?.email).toBe('kim@example.com');
      // And sign-in, which lower-cases what it is given, finds that same row.
      expect((await repos.users.findByEmail(organisationId, 'KIM@example.com'))?.id).toBe(
        person?.id,
      );
    });

    /** `users_org_email_idx`, not a prior read — two administrators adding at once must not 500. */
    it('reports a duplicate address as null rather than throwing', async () => {
      const organisationId = await freshOrganisation();
      await repos.users.create({
        organisationId,
        email: 'dup@example.com',
        name: 'First',
        role: 'operator',
      });

      await expect(
        repos.users.create({
          organisationId,
          email: 'dup@example.com',
          name: 'Second',
          role: 'operator',
        }),
      ).resolves.toBeNull();
    });

    it('refuses to demote the only enabled administrator', async () => {
      const organisationId = await freshOrganisation();
      const only = await admin(organisationId, 'only@example.com');

      const result = await repos.users.update(only.id, { role: 'operator' });

      expect(result).toEqual({ ok: false, reason: 'last-admin' });
      expect((await repos.users.findById(only.id))?.role).toBe('admin');
    });

    it('refuses to disable the only enabled administrator', async () => {
      const organisationId = await freshOrganisation();
      const only = await admin(organisationId, 'solo@example.com');

      expect(await repos.users.update(only.id, { disabled: true })).toEqual({
        ok: false,
        reason: 'last-admin',
      });
    });

    it('allows the demotion once a second administrator exists', async () => {
      const organisationId = await freshOrganisation();
      const first = await admin(organisationId, 'first@example.com');
      await admin(organisationId, 'second@example.com');

      const result = await repos.users.update(first.id, { role: 'operator' });
      expect(result.ok).toBe(true);
    });

    /**
     * The write skew the lock exists for, run for real.
     *
     * Two administrators demoting each other at the same moment. Without `FOR UPDATE` both
     * transactions read the other as still an enabled administrator, both pass the check and both
     * commit — leaving an organisation with none, recoverable only from a database. With it they
     * serialise, so exactly one succeeds.
     *
     * This is the test that cannot be written against the in-memory repository at all: there is
     * no concurrency there to lose to.
     */
    it('lets only one of two simultaneous demotions through', async () => {
      const organisationId = await freshOrganisation();
      const one = await admin(organisationId, 'race-one@example.com');
      const two = await admin(organisationId, 'race-two@example.com');

      /*
       * A second connection, because the pool above is `max: 1`.
       *
       * Two transactions issued through one connection do not race — postgres.js queues the
       * second until the first has committed, so the test would pass by running sequentially and
       * prove nothing about the lock it is named after. Genuinely concurrent means two
       * connections.
       */
      const otherSql = postgres(url, { max: 1, onnotice: () => {} });
      const otherRepos = createDrizzleRepositories(drizzle(otherSql, { schema }));

      let first, second;
      try {
        [first, second] = await Promise.all([
          repos.users.update(one.id, { role: 'operator' }),
          otherRepos.users.update(two.id, { role: 'operator' }),
        ]);
      } finally {
        await otherSql.end();
      }

      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);

      const remaining = (await repos.users.list(organisationId)).filter(
        (person) => person.role === 'admin' && person.disabledAt === null,
      );
      expect(remaining).toHaveLength(1);
    });

    it('clears the disabled date on re-enabling rather than keeping it', async () => {
      const organisationId = await freshOrganisation();
      await admin(organisationId, 'keeper@example.com');
      const other = await admin(organisationId, 'toggled@example.com');

      await repos.users.update(other.id, { disabled: true });
      expect((await repos.users.findById(other.id))?.disabledAt).not.toBeNull();

      await repos.users.update(other.id, { disabled: false });
      expect((await repos.users.findById(other.id))?.disabledAt).toBeNull();
    });
  });

  /** Migration 0019 and the version lock, on a real Postgres — the same as `pglite.test.ts`. */
  it('keeps a builder session per form and person, behind its version lock', async () => {
    const organisationId = await organisation();
    const form = await repos.forms.create({
      organisationId,
      eventId: null,
      slug: 'smoke-builder-session',
      title: { 'sv-SE': 'Samtal' },
      draftDefinition: { schemaVersion: 1, fields: [], settings: {} },
      opensAt: null,
      closesAt: null,
      ownerUserId: null,
    });
    const people = await Promise.all(
      ['session-a', 'session-b'].map(async (name) => {
        const person = await repos.users.create({
          organisationId,
          email: `${name}-${form.id}@example.com`,
          name,
          role: 'operator',
        });
        if (!person) throw new Error(`could not create ${name}`);
        return person;
      }),
    );
    const [first, second] = people;
    const sessions = repos.builderSessions;
    const key = { organisationId, formId: form.id };
    const session = { sessionVersion: 1, note: 'Välj mat — å ä ö' };

    expect(await sessions.find(organisationId, form.id, first!.id)).toBeNull();
    expect(await sessions.save({ ...key, userId: first!.id, session, expected: 0 })).toMatchObject({
      version: 1,
      session,
    });
    expect(await sessions.save({ ...key, userId: first!.id, session, expected: 0 })).toBeNull();
    expect(await sessions.save({ ...key, userId: first!.id, session, expected: 1 })).toMatchObject({
      version: 2,
    });
    expect(await sessions.save({ ...key, userId: first!.id, session, expected: 1 })).toBeNull();
    expect(await sessions.find(organisationId, form.id, second!.id)).toBeNull();

    // Two saves from the same version at once: exactly one wins.
    const race = await Promise.all([
      sessions.save({ ...key, userId: first!.id, session, expected: 2 }),
      sessions.save({ ...key, userId: first!.id, session, expected: 2 }),
    ]);
    expect(race.filter((result) => result !== null)).toHaveLength(1);
  });

  it('writes an audit row', async () => {
    const organisationId = await organisation();

    await repos.audit.record({
      organisationId,
      actorUserId: null,
      action: 'test.smoke',
      entityType: 'test',
      entityId: null,
    });

    const entries = await repos.audit.list(organisationId);
    expect(entries.some((entry) => entry.action === 'test.smoke')).toBe(true);
  });

  /**
   * The sweep's SQL, for real: the bounded subselect over the partial index, the `returning`,
   * the `like` over JSONB cast to text. The fake proves the rules; this proves Postgres agrees.
   */
  it('sweeps expired anonymous uploads, oldest first, within the limit', async () => {
    const organisationId = await organisation();
    const form = await repos.forms.create({
      organisationId,
      eventId: null,
      slug: 'smoke-sweep',
      title: { 'sv-SE': 'Sopning' },
      draftDefinition: { schemaVersion: 1, fields: [], settings: {} },
      opensAt: null,
      closesAt: null,
      ownerUserId: null,
    });
    const key = (letter: string) => `${letter.repeat(64)}.pdf`;
    const row = async (letter: string, daysAgo: number) => {
      const created = await repos.uploads.create({
        organisationId,
        formId: form.id,
        storageKey: key(letter),
        filename: 'cv.pdf',
        contentType: 'application/pdf',
        bytes: 3,
      });
      await sql`update form_uploads set created_at = now() - make_interval(days => ${daysAgo}) where id = ${created.id}`;
      return created;
    };
    await row('a', 45);
    await row('b', 40);
    await row('c', 1);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(await repos.uploads.sweepExpired(cutoff, 1)).toEqual([key('a')]);
    expect(await repos.uploads.sweepExpired(cutoff, 10)).toEqual([key('b')]);
    expect(await repos.uploads.sweepExpired(cutoff, 10)).toEqual([]);
    expect(await repos.uploads.isReferenced(key('c'))).toBe(true);
    expect(await repos.uploads.isReferenced(key('a'))).toBe(false);

    // A key a form lists as its paper is referenced even with no upload row at all.
    expect(await repos.forms.referencesUpload(key('z'))).toBe(false);
    await repos.forms.update(organisationId, form.id, {
      draftDefinition: {
        schemaVersion: 1,
        fields: [],
        settings: {},
        paper: { sources: [{ key: key('z'), pages: 1 }] },
      },
    });
    expect(await repos.forms.referencesUpload(key('z'))).toBe(true);
  });

  it('takes back a job a dead worker left running, and fails it once attempts are spent', async () => {
    const organisationId = await organisation();
    const job = await repos.jobs.enqueue({
      organisationId,
      kind: 'smoke.job',
      idempotencyKey: `smoke:${Date.now()}`,
      payload: {},
      progressTotal: 1,
      maxAttempts: 2,
    });
    // As a worker that claimed it an hour ago and then died would have left it. Set directly:
    // `claim()` takes the oldest queued row, which on a shared database is not necessarily this.
    const lost = sql`
      update jobs set status = 'running', started_at = now() - interval '1 hour',
        attempts = attempts + 1
      where id = ${job.id}
    `;
    await lost;

    // Younger than the cutoff: left alone. (Its own row, not the count — the database is shared
    // with the e2e suite, whose rows this test does not own.)
    await repos.jobs.requeueStale(new Date(Date.now() - 2 * 60 * 60 * 1000));
    expect((await repos.jobs.findById(organisationId, job.id))?.status).toBe('running');
    // Older: queued again, and the lost claim counts as an attempt.
    expect(
      await repos.jobs.requeueStale(new Date(Date.now() - 30 * 60 * 1000)),
    ).toBeGreaterThanOrEqual(1);
    const requeued = await repos.jobs.findById(organisationId, job.id);
    expect(requeued?.status).toBe('queued');
    expect(requeued?.startedAt).toBeNull();
    expect(requeued?.attempts).toBe(1);

    // The second loss spends the last attempt.
    await sql`
      update jobs set status = 'running', started_at = now() - interval '1 hour',
        attempts = attempts + 1
      where id = ${job.id}
    `;
    await repos.jobs.requeueStale(new Date(Date.now() - 30 * 60 * 1000));
    const dead = await repos.jobs.findById(organisationId, job.id);
    expect(dead?.status).toBe('failed');
    expect(dead?.finishedAt).not.toBeNull();

    // A finished job runs again from the start; one that is queued is left as it is.
    const restarted = await repos.jobs.restart(job.id);
    expect(restarted?.status).toBe('queued');
    expect(restarted?.attempts).toBe(0);
    expect(restarted?.error).toBeNull();
    expect(restarted?.finishedAt).toBeNull();
    await sql`update jobs set status = 'running', started_at = now() where id = ${job.id}`;
    expect((await repos.jobs.restart(job.id))?.status).toBe('running');
    await sql`delete from jobs where id = ${job.id}`;
  });
});

if (!migrated) {
  const reason = connected
    ? 'database reachable but not migrated — run pnpm db:migrate'
    : `no Postgres at ${url.replace(/:[^:@]*@/, ':***@')} — run pnpm db:up`;

  describe('database smoke test', () => {
    it.skip(`SKIPPED — ${reason}`, () => {});
  });
}

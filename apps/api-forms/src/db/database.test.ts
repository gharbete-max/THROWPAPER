import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createDrizzleRepositories } from './repositories/index.js';

/**
 * The one test that needs a real Postgres.
 *
 * Everything else runs against the in-memory repositories, so `pnpm verify` is meaningful without
 * Docker. This covers what a fake cannot: that the migration matches the schema and that the
 * Drizzle implementation round-trips through it. CI always has a database, so it always runs
 * there — and it says loudly when it is skipped rather than passing quietly.
 */
const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';

const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
const reachable = await sql`select 1`.then(
  () => true,
  () => false,
);

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!reachable)('drizzle repositories against a real database', () => {
  const repos = createDrizzleRepositories(drizzle(sql));

  it('finds the seeded organisation with its locale configuration', async () => {
    const organisation = await repos.organisations.first();
    expect(organisation).not.toBeNull();
    expect(organisation?.supportedLocales.length).toBeGreaterThan(0);
    expect(organisation?.defaultLocale).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
  });

  it('round-trips an event, including per-locale JSONB text', async () => {
    const organisation = await repos.organisations.first();
    if (!organisation) throw new Error('no organisation — run pnpm db:seed');

    const created = await repos.events.create({
      organisationId: organisation.id,
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

    const fetched = await repos.events.findById(organisation.id, created.id);
    // Nordic characters must survive the JSONB round trip, not just the PDF.
    expect(fetched?.name['sv-SE']).toBe('Testmöte åäö');
    expect(fetched?.name['en-GB']).toBe('Test meeting');

    const updated = await repos.events.update(organisation.id, created.id, { status: 'open' });
    expect(updated?.status).toBe('open');
  });

  it('writes an audit row', async () => {
    const organisation = await repos.organisations.first();
    if (!organisation) throw new Error('no organisation — run pnpm db:seed');

    await repos.audit.record({
      organisationId: organisation.id,
      actorUserId: null,
      action: 'test.smoke',
      entityType: 'test',
      entityId: null,
    });

    const entries = await repos.audit.list(organisation.id);
    expect(entries.some((entry) => entry.action === 'test.smoke')).toBe(true);

    await sql`delete from audit_log where action = 'test.smoke'`;
    await sql`delete from events where name->>'sv-SE' = 'Testmöte åäö'`;
  });
});

if (!reachable) {
  describe('database smoke test', () => {
    it.skip(`SKIPPED — no Postgres at ${url.replace(/:[^:@]*@/, ':***@')}. Run pnpm db:up`, () => {});
  });
}

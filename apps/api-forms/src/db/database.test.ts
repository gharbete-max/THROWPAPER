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

afterAll(async () => {
  if (migrated) await sql`delete from organisations where slug = ${SLUG}`;
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
});

if (!migrated) {
  const reason = connected
    ? 'database reachable but not migrated — run pnpm db:migrate'
    : `no Postgres at ${url.replace(/:[^:@]*@/, ':***@')} — run pnpm db:up`;

  describe('database smoke test', () => {
    it.skip(`SKIPPED — ${reason}`, () => {});
  });
}

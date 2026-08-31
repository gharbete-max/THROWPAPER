import { db, sql } from './client.js';
import { events, organisations, users } from './schema.js';

/**
 * CLAUDE.md §Demo data — a broken seed blocks demos, so it grows with the schema.
 *
 * v0.1 scope: an organisation, an admin, an operator and one demo event in both locales. The
 * ~200 registrations arrive in phase 3 with the public form that creates them.
 */
const [organisation] = await db
  .insert(organisations)
  .values({
    name: 'Demo AB',
    slug: 'demo',
    defaultLocale: 'sv-SE',
    supportedLocales: ['sv-SE', 'en-GB'],
  })
  .onConflictDoUpdate({ target: organisations.slug, set: { name: 'Demo AB' } })
  .returning();

if (!organisation) throw new Error('seed could not create the organisation');

await db
  .insert(users)
  .values([
    {
      organisationId: organisation.id,
      email: 'admin@example.com',
      name: 'Alva Admin',
      role: 'admin',
    },
    {
      organisationId: organisation.id,
      email: 'operator@example.com',
      name: 'Oskar Operatör',
      role: 'operator',
    },
  ])
  .onConflictDoNothing();

const existing = await db.select({ id: events.id }).from(events).limit(1);
if (existing.length === 0) {
  await db.insert(events).values({
    organisationId: organisation.id,
    name: { 'sv-SE': 'Vårmötet 2026', 'en-GB': 'Spring meeting 2026' },
    description: {
      'sv-SE': 'Årets viktigaste möte, med lunch och rundvandring.',
      'en-GB': 'The main meeting of the year, with lunch and a tour.',
    },
    startsAt: new Date('2026-05-14T09:00:00Z'),
    endsAt: new Date('2026-05-14T16:00:00Z'),
    venueName: 'Näringslivets Hus',
    venueAddress: 'Storgatan 19, Göteborg',
    capacity: 200,
    registrationClosesAt: new Date('2026-05-07T23:59:59Z'),
    status: 'open',
  });
}

console.log('seed complete — sign in as admin@example.com or operator@example.com');
await sql.end();

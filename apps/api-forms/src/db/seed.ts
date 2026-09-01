import { eq } from 'drizzle-orm';
import { db, sql } from './client.js';
import { events, formVersions, forms, organisations, submissions, users } from './schema.js';
import { generateReference } from '../forms/public-service.js';
import { demoEventName, demoSchedule } from '../demo/schedule.js';
import { DEMO_DEFINITION, DEMO_FORM_SLUG } from '../demo/dataset.js';

/**
 * CLAUDE.md §Demo data — a broken seed blocks demos, so it grows with the schema.
 *
 * v0.1 scope (START-HERE): a demo event with ~200 registrations, and the form that collected them.
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

// Relative to now, so the demo never expires. See demo/schedule.ts for why that matters.
const schedule = demoSchedule();

const existingEvent = await db.select({ id: events.id }).from(events).limit(1);
let eventId = existingEvent[0]?.id;

if (!eventId) {
  const [event] = await db
    .insert(events)
    .values({
      organisationId: organisation.id,
      name: demoEventName(schedule),
      description: {
        'sv-SE': 'Årets viktigaste möte, med lunch och rundvandring.',
        'en-GB': 'The main meeting of the year, with lunch and a tour.',
      },
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      venueName: 'Näringslivets Hus',
      venueAddress: 'Storgatan 19, Göteborg',
      // Comfortably above the seeded 200, so a demo can still register somebody and watch it work.
      capacity: 250,
      registrationClosesAt: schedule.registrationClosesAt,
      status: 'open',
    })
    .returning();
  eventId = event?.id;
}

if (!eventId) throw new Error('seed could not create the demo event');

// The definition lives in demo/dataset.ts so the SQL seed and demo mode show the same product.
const DEFINITION = DEMO_DEFINITION;

const existingForm = await db.select({ id: forms.id }).from(forms).limit(1);

if (existingForm.length === 0) {
  const [form] = await db
    .insert(forms)
    .values({
      organisationId: organisation.id,
      eventId,
      slug: DEMO_FORM_SLUG,
      title: { 'sv-SE': 'Anmälan till Vårmötet', 'en-GB': 'Spring meeting registration' },
      status: 'published',
      draftDefinition: DEFINITION,
    })
    .returning();
  if (!form) throw new Error('seed could not create the demo form');

  const [version] = await db
    .insert(formVersions)
    .values({ formId: form.id, version: 1, definition: DEFINITION, publishedAt: new Date() })
    .returning();
  if (!version) throw new Error('seed could not publish the demo form');

  await db
    .update(forms)
    .set({ publishedVersionId: version.id, publishedVersion: 1 })
    .where(eq(forms.id, form.id));

  // Nordic names on purpose: the CSV export and the PDF both have to survive å ä ö, and a seed
  // full of "Test User 4" would never show that up.
  const firstNames = ['Alva', 'Björn', 'Cecilia', 'Dag', 'Elsa', 'Fredrik', 'Göran', 'Hanna'];
  const lastNames = ['Öberg', 'Ångström', 'Ekström', 'Lindqvist', 'Sjöberg', 'Häggkvist'];
  const orgs = ['Nordvik AB', 'Sjöström & Co', 'Ålands Bruk', 'Västra Handels'];
  const meals = ['standard', 'veg', 'gluten'];

  const rows = Array.from({ length: 200 }, (_, index) => {
    const first = firstNames[index % firstNames.length] ?? 'Alva';
    const last = lastNames[index % lastNames.length] ?? 'Öberg';
    return {
      organisationId: organisation.id,
      formId: form.id,
      formVersionId: version.id,
      eventId,
      reference: generateReference(),
      status: 'complete' as const,
      locale: index % 5 === 0 ? 'en-GB' : 'sv-SE',
      email: `deltagare${index + 1}@example.com`,
      data: {
        full_name: `${first} ${last}`,
        email: `deltagare${index + 1}@example.com`,
        organisation: orgs[index % orgs.length],
        meal: meals[index % meals.length],
        guests: index % 7 === 0 ? 1 : 0,
      },
      submittedAt: new Date(Date.now() - index * 3_600_000),
    };
  });

  await db.insert(submissions).values(rows);
}

console.log('seed complete — sign in as admin@example.com, form at /f/varmotet-2026');
await sql.end();

import { eq } from 'drizzle-orm';
import { createMaintenanceClient } from './client.js';
import {
  brandKits,
  events,
  formShares,
  formVersions,
  forms,
  organisations,
  submissions,
  users,
} from './schema.js';
import { demoEventName, demoSchedule } from '../demo/schedule.js';
import {
  demoRegistration,
  DEMO_ADMIN_EMAIL,
  DEMO_BRAND,
  DEMO_DEFINITION,
  DEMO_FORM_SLUG,
  DEMO_OPERATOR_EMAIL,
} from '../demo/dataset.js';
import { forms as formSchemas } from '@tp/shared';

/*
 * Its own connection rather than the serving pool: seeding inserts ~200 registrations in one
 * sequential script, which is maintenance work and not a request to be timed out.
 */
const { db, sql } = createMaintenanceClient();

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

/**
 * The seeded people, read back rather than assumed.
 *
 * `onConflictDoNothing` means a re-seed inserts nothing and returns nothing, so the ids have to
 * come from a select — the forms below belong to these two, and a form with a made-up owner is a
 * form nobody can see.
 */
const people = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(eq(users.organisationId, organisation.id));

const personId = (email: string): string => {
  const found = people.find((person) => person.email === email);
  if (!found) throw new Error(`seed could not find the demo user ${email}`);
  return found.id;
};
const adminId = personId(DEMO_ADMIN_EMAIL);
const operatorId = personId(DEMO_OPERATOR_EMAIL);

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
      ownerUserId: adminId,
    })
    .returning();
  if (!form) throw new Error('seed could not create the demo form');

  /**
   * Two more forms, so every tab of the workspace has something in it.
   *
   * A demo where all three forms belong to the same person and none is in the bin demonstrates
   * one quarter of the feature. Oskar's feedback form is shared with Alva, so "shared with me"
   * has a row; the old survey is binned a week ago, so the bin does too.
   */
  const feedback = formSchemas.findTemplate('customer-feedback');
  const [shared] = await db
    .insert(forms)
    .values({
      organisationId: organisation.id,
      eventId: null,
      slug: 'kundfeedback',
      title: { 'sv-SE': 'Kundfeedback', 'en-GB': 'Customer feedback' },
      status: 'draft',
      draftDefinition: feedback
        ? structuredClone(feedback.definition)
        : formSchemas.emptyDefinition,
      ownerUserId: operatorId,
    })
    .returning();
  if (!shared) throw new Error('seed could not create the shared demo form');

  await db.insert(formShares).values({
    organisationId: organisation.id,
    formId: shared.id,
    userId: adminId,
    role: 'editor',
  });

  await db.insert(forms).values({
    organisationId: organisation.id,
    eventId: null,
    slug: 'gammal-enkat',
    title: { 'sv-SE': 'Gammal enkät', 'en-GB': 'Old survey' },
    status: 'draft',
    draftDefinition: formSchemas.emptyDefinition,
    ownerUserId: adminId,
    deletedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  });

  const [version] = await db
    .insert(formVersions)
    .values({ formId: form.id, version: 1, definition: DEFINITION, publishedAt: new Date() })
    .returning();
  if (!version) throw new Error('seed could not publish the demo form');

  await db
    .update(forms)
    .set({ publishedVersionId: version.id, publishedVersion: 1 })
    .where(eq(forms.id, form.id));

  /**
   * The same rows demo mode builds, not a second set that looks like them.
   *
   * These two lists of names, organisations and meals used to be written out twice — once here and
   * once in `demo/dataset.ts` — with only the *definition* shared. So the header on that file
   * ("the two cannot drift into showing different products") was true of the form and false of the
   * answers, and adding guests to the form would have meant adding them to the answers in two
   * places, of which one would have been forgotten.
   */
  const rows = Array.from({ length: 200 }, (_unused, index) =>
    demoRegistration(index, form.id, version.id, eventId, organisation.id, new Date()),
  );

  await db.insert(submissions).values(rows);
}

/*
 * The brand kit, which `CLAUDE.md` §Demo data asks for by name and the seed did not write.
 *
 * The in-memory demo has had one all along, so `pnpm demo` and `pnpm db:seed` produced two demos
 * that did not look alike — and the seeded one fell back to the shipped neutral defaults, which is
 * precisely the thing a brand kit exists to replace. Same values as the in-memory demo, from the
 * same constant, so there is one palette rather than two that drift.
 */
await db
  .insert(brandKits)
  .values({ organisationId: organisation.id, tokens: DEMO_BRAND })
  .onConflictDoUpdate({ target: brandKits.organisationId, set: { tokens: DEMO_BRAND } });

console.log('seed complete — sign in as admin@example.com, form at /f/varmotet-2026');
await sql.end();

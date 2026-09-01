import { randomUUID } from 'node:crypto';
import { forms as formSchemas } from '@tp/shared';
import type { MemoryState } from '../db/repositories/index.js';
import { generateReference } from '../forms/public-service.js';
import { demoEventName, demoSchedule } from './schedule.js';

/**
 * The demo dataset, and the single definition of what a demonstrable Formwork looks like.
 *
 * Both `pnpm db:seed` (Postgres) and `pnpm demo` (in memory) build from this, so the two cannot
 * drift into showing different products — which is how a demo ends up being the thing nobody
 * actually tested.
 */
export const DEMO_ORGANISATION = {
  name: 'Demo AB',
  slug: 'demo',
  defaultLocale: 'sv-SE',
  supportedLocales: ['sv-SE', 'en-GB'],
} as const;

export const DEMO_USERS = [
  { email: 'admin@example.com', name: 'Alva Admin', role: 'admin' as const },
  { email: 'operator@example.com', name: 'Oskar Operatör', role: 'operator' as const },
];

export const DEMO_FORM_SLUG = 'varmotet';

/** Nordic names on purpose: the CSV export and the PDF both have to survive å ä ö. */
const FIRST_NAMES = ['Alva', 'Björn', 'Cecilia', 'Dag', 'Elsa', 'Fredrik', 'Göran', 'Hanna'];
const LAST_NAMES = ['Öberg', 'Ångström', 'Ekström', 'Lindqvist', 'Sjöberg', 'Häggkvist'];
const ORGS = ['Nordvik AB', 'Sjöström & Co', 'Ålands Bruk', 'Västra Handels'];
const MEALS = ['standard', 'veg', 'gluten'];

export const DEMO_DEFINITION: formSchemas.FormDefinition = {
  schemaVersion: 1,
  fields: [
    {
      id: 'name',
      key: 'full_name',
      type: 'short_text',
      label: { 'sv-SE': 'Namn', 'en-GB': 'Name' },
      required: true,
    },
    {
      id: 'email',
      key: 'email',
      type: 'email',
      label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
      required: true,
    },
    {
      id: 'org',
      key: 'organisation',
      type: 'short_text',
      label: { 'sv-SE': 'Organisation', 'en-GB': 'Organisation' },
      required: false,
    },
    { id: 'page', key: 'page_two', type: 'page_break' },
    {
      id: 'meal',
      key: 'meal',
      type: 'single_select',
      label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
      required: true,
      options: [
        { value: 'standard', label: { 'sv-SE': 'Standard', 'en-GB': 'Standard' } },
        { value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' } },
        { value: 'gluten', label: { 'sv-SE': 'Glutenfritt', 'en-GB': 'Gluten free' } },
      ],
    },
    {
      id: 'guests',
      key: 'guests',
      type: 'number',
      label: { 'sv-SE': 'Medföljande gäster', 'en-GB': 'Accompanying guests' },
      required: false,
      min: 0,
      max: 2,
    },
  ],
  settings: {
    submitLabel: { 'sv-SE': 'Anmäl mig', 'en-GB': 'Register me' },
    confirmationMessage: {
      'sv-SE': 'Tack för din anmälan! Vi ses snart.',
      'en-GB': 'Thank you for registering. See you soon.',
    },
    duplicateControl: 'email',
    allowSaveAndResume: true,
  },
};

export function demoRegistration(
  index: number,
  formId: string,
  versionId: string,
  eventId: string,
  organisationId: string,
  now: Date,
) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? 'Alva';
  const last = LAST_NAMES[index % LAST_NAMES.length] ?? 'Öberg';
  const email = `deltagare${index + 1}@example.com`;

  return {
    id: randomUUID(),
    organisationId,
    formId,
    formVersionId: versionId,
    eventId,
    reference: generateReference(),
    status: 'complete' as const,
    locale: index % 5 === 0 ? 'en-GB' : 'sv-SE',
    email,
    data: {
      full_name: `${first} ${last}`,
      email,
      organisation: ORGS[index % ORGS.length],
      meal: MEALS[index % MEALS.length],
      guests: index % 7 === 0 ? 1 : 0,
    },
    resumeTokenHash: null,
    resumeExpiresAt: null,
    submittedAt: new Date(now.getTime() - index * 3_600_000),
    revokedAt: null,
    createdAt: new Date(now.getTime() - index * 3_600_000),
    updatedAt: new Date(now.getTime() - index * 3_600_000),
  };
}

/**
 * A complete in-memory Formwork: organisation, users, a scheduled event, a published form and
 * registrations against it.
 *
 * Fewer registrations than the SQL seed's 200 — a demo wants a list somebody can read, and
 * generating 200 admission PDFs on a demo box is a poor first impression.
 */
export function buildDemoState(options: { registrations?: number; now?: Date } = {}): MemoryState {
  const now = options.now ?? new Date();
  const count = options.registrations ?? 40;
  const schedule = demoSchedule(now);

  const organisationId = randomUUID();
  const eventId = randomUUID();
  const formId = randomUUID();
  const versionId = randomUUID();

  return {
    organisations: [
      {
        id: organisationId,
        ...DEMO_ORGANISATION,
        supportedLocales: [...DEMO_ORGANISATION.supportedLocales],
      },
    ],

    users: DEMO_USERS.map((user) => ({
      id: randomUUID(),
      organisationId,
      email: user.email,
      name: user.name,
      role: user.role,
      disabledAt: null,
    })),

    events: [
      {
        id: eventId,
        organisationId,
        name: demoEventName(schedule),
        description: {
          'sv-SE': 'Årets viktigaste möte, med lunch och rundvandring.',
          'en-GB': 'The main meeting of the year, with lunch and a tour.',
        },
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        venueName: 'Näringslivets Hus',
        venueAddress: 'Storgatan 19, Göteborg',
        capacity: 250,
        registrationClosesAt: schedule.registrationClosesAt,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      },
    ],

    forms: [
      {
        id: formId,
        organisationId,
        eventId,
        slug: DEMO_FORM_SLUG,
        title: { 'sv-SE': 'Anmälan till Vårmötet', 'en-GB': 'Spring meeting registration' },
        status: 'published',
        draftDefinition: DEMO_DEFINITION,
        publishedVersionId: versionId,
        publishedVersion: 1,
        opensAt: null,
        closesAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],

    formVersions: [
      {
        id: versionId,
        formId,
        version: 1,
        definition: DEMO_DEFINITION,
        publishedAt: now,
        translationOverride: false,
        createdAt: now,
      },
    ],

    submissions: Array.from({ length: count }, (_, index) =>
      demoRegistration(index, formId, versionId, eventId, organisationId, now),
    ),

    checkIns: [],
    loginTokens: [],
    refreshTokens: [],
    jobs: [],
    sendingDomains: [],
    messages: [],
    audit: [],
  };
}

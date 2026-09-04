import { randomUUID } from 'node:crypto';
import { ocrForInvoice } from '@tp/shared/invoicing';
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
  /**
   * The languages this organisation publishes **content** in — not the twelve the interface is
   * available in, which is a separate list the demo does not get to choose.
   *
   * Two, because the demo has content in two. Claiming twelve put a row of ten "missing
   * translation" warnings under every seeded event and form: accurate, and entirely self-inflicted.
   */
  supportedLocales: ['sv-SE', 'en-GB'],
} as const;

export const DEMO_ADMIN_EMAIL = 'admin@example.com';
export const DEMO_OPERATOR_EMAIL = 'operator@example.com';

export const DEMO_USERS = [
  { email: DEMO_ADMIN_EMAIL, name: 'Alva Admin', role: 'admin' as const },
  { email: DEMO_OPERATOR_EMAIL, name: 'Oskar Operatör', role: 'operator' as const },
];

/**
 * The demo organisation's brand: the palette this product is being built in.
 *
 * Deep Midnight, Saddle Brown, Cognac, Parchment and Brushed Gold, roughly 60/30/10. It lives here
 * rather than in `packages/tokens/default-tokens.json` on purpose — the shipped defaults are what
 * a *new customer* starts from, and they should be neutral. This is one organisation's choice,
 * which is exactly what the brand kit is for.
 *
 * Contrast is measured, not assumed (`docs/SPEC-shared.md` §Brand direction). Cognac and Brushed
 * Gold both fail as text on Parchment, so neither is used for text: accent is decorative and gold
 * does not appear here at all.
 */
export const DEMO_BRAND = {
  colour: {
    primary: '#1b263b',
    secondary: '#8b5a2b',
    accent: '#c68b59',
    background: '#f4f1ea',
    surface: '#fbfaf6',
    text: '#1b263b',
    muted: '#5a6478',
    border: '#ddd6c8',
    success: '#1f7a45',
    warning: '#7a5e10',
    danger: '#b3261e',
  },
  typography: {
    headingFont: 'Inter, system-ui, sans-serif',
    bodyFont: 'Inter, system-ui, sans-serif',
    baseSize: '16px',
    scaleRatio: 1.25,
    lineHeight: 1.5,
    weightRegular: 400,
    weightBold: 600,
  },
  spacingUnit: '8px',
  // Flat and quiet: no gradients, and corners kept small rather than rounded off.
  radius: '4px',
  borderWidth: '1px',
  shadowLevel: 0,
  buttonStyle: 'solid',
  logoLight: null,
  logoDark: null,
  favicon: null,
} as const;

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
      width: 'half',
    },
    {
      id: 'email',
      key: 'email',
      type: 'email',
      label: { 'sv-SE': 'E-post', 'en-GB': 'Email' },
      required: true,
      width: 'half',
    },
    {
      id: 'org',
      key: 'organisation',
      type: 'short_text',
      label: { 'sv-SE': 'Organisation', 'en-GB': 'Organisation' },
      required: false,
      width: 'full',
    },
    { id: 'page', key: 'page_two', type: 'page_break' },
    {
      id: 'meal',
      key: 'meal',
      type: 'single_select',
      label: { 'sv-SE': 'Måltid', 'en-GB': 'Meal' },
      required: true,
      width: 'full',
      options: [
        { value: 'standard', label: { 'sv-SE': 'Standard', 'en-GB': 'Standard' }, image: null },
        { value: 'veg', label: { 'sv-SE': 'Vegetariskt', 'en-GB': 'Vegetarian' }, image: null },
        { value: 'gluten', label: { 'sv-SE': 'Glutenfritt', 'en-GB': 'Gluten free' }, image: null },
      ],
      // Cards rather than a dropdown: three short choices on a form that is mostly filled in on a
      // phone, and the demo should show what the builder can now do.
      appearance: 'cards',
    },
    {
      id: 'guests',
      key: 'guests',
      type: 'number',
      width: 'half',
      label: { 'sv-SE': 'Medföljande gäster', 'en-GB': 'Accompanying guests' },
      required: false,
      min: 0,
      max: 2,
    },
  ],
  // Spread from the schema's own defaults, so a new setting does not have to be remembered here.
  settings: {
    ...formSchemas.emptyDefinition.settings,
    submitLabel: { 'sv-SE': 'Anmäl mig', 'en-GB': 'Register me' },
    confirmationMessage: {
      'sv-SE': 'Tack för din anmälan! Vi ses snart.',
      'en-GB': 'Thank you for registering. See you soon.',
    },
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

/**
 * A property, and a month of rent across it.
 *
 * Three flats of different sizes in one building, on one rate per square metre, which is how
 * residential rent is actually set here. Each tenant also has the extras they happen to have —
 * which is the point of the charge model: the landlord writes their own, and nothing in the code
 * knows what cable television is.
 *
 * `CLAUDE.md` §Demo data requires the seed to leave the product demonstrable. An invoicing feature
 * with no invoices in it demonstrates nothing.
 */
function demoInvoices(organisationId: string, now: Date) {
  const batchId = randomUUID();
  const issuedOn = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dueOn = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  /** 148,00 kr per square metre per month, the same for every flat in the building. */
  const RATE = 14_800n;

  const flats = [
    { name: 'Anna Lindqvist', flat: '1201', areaThousandths: 67_500n, cable: true, parking: true },
    { name: 'Bo Ekström', flat: '1202', areaThousandths: 45_000n, cable: true, parking: false },
    { name: 'Carina Holm', flat: '1301', areaThousandths: 92_000n, cable: false, parking: true },
  ];

  const line = (
    description: Record<string, string>,
    quantityThousandths: bigint,
    unitAmountMinor: bigint,
    vatRateBasisPoints: number,
  ) => {
    const amountMinor = (quantityThousandths * unitAmountMinor + 500n) / 1000n;
    const vatMinor = (amountMinor * BigInt(vatRateBasisPoints) + 5_000n) / 10_000n;
    return {
      id: randomUUID(),
      description,
      quantityThousandths,
      unitAmountMinor,
      amountMinor,
      vatRateBasisPoints,
      vatMinor,
      position: 0,
    };
  };

  const invoices = flats.map((flat, index) => {
    const lines = [
      line({ 'sv-SE': 'Hyra', 'en-GB': 'Rent' }, flat.areaThousandths, RATE, 0),
      ...(flat.cable
        ? [line({ 'sv-SE': 'Kabel-TV', 'en-GB': 'Cable television' }, 1000n, 24_900n, 2500)]
        : []),
      ...(flat.parking
        ? [line({ 'sv-SE': 'Parkeringsplats', 'en-GB': 'Parking space' }, 1000n, 65_000n, 2500)]
        : []),
    ].map((entry, position) => ({ ...entry, position }));

    const netMinor = lines.reduce((total, entry) => total + entry.amountMinor, 0n);
    const vatMinor = lines.reduce((total, entry) => total + entry.vatMinor, 0n);
    const number = 1001 + index;

    return {
      id: randomUUID(),
      organisationId,
      batchId,
      number,
      ocr: ocrForInvoice(number, {
        method: 'bankgiro' as const,
        account: '123-4567',
        ocrLengthControl: true,
      }),
      status: 'sent' as const,
      currency: 'SEK',
      recipientName: flat.name,
      recipientEmail: `${flat.flat}@example.com`,
      recipientAddress: `Storgatan 14, lgh ${flat.flat}\n123 45 Stockholm`,
      recipientReference: flat.flat,
      subject: { 'sv-SE': 'Hyra', 'en-GB': 'Rent' },
      periodStart: issuedOn,
      periodEnd: dueOn,
      issuedOn,
      dueOn,
      netMinor,
      vatMinor,
      totalMinor: netMinor + vatMinor,
      paymentMethod: 'bankgiro',
      paymentAccount: '123-4567',
      /*
       * Fixed in the demo so the link is the same after every restart, and hex because the route
       * refuses anything that could not be a token this app issued. `demo` is not hex; `de` is.
       */
      publicToken: `de${flat.flat}`.padEnd(32, '0'),
      sentAt: now,
      paidAt: null,
      createdAt: now,
      lines,
    };
  });

  const batch = {
    id: batchId,
    organisationId,
    name: 'Hyra',
    createdBy: null,
    sentAt: now,
    lastTestAt: null,
    createdAt: now,
  };

  return { batch, invoices };
}

export function buildDemoState(options: { registrations?: number; now?: Date } = {}): MemoryState {
  const now = options.now ?? new Date();
  const count = options.registrations ?? 40;
  const schedule = demoSchedule(now);

  const organisationId = randomUUID();
  const eventId = randomUUID();
  const formId = randomUUID();
  const versionId = randomUUID();
  const demoBilling = demoInvoices(organisationId, now);

  /**
   * Stable ids for the demo people, so the forms below can actually belong to somebody.
   *
   * The workspaces are the point: a demo where every form is unowned shows the fallback path and
   * none of the feature — no "my forms", nothing under "shared with me", an empty bin.
   */
  const userIds = new Map(DEMO_USERS.map((user) => [user.email, randomUUID()]));
  const userId = (email: string): string => {
    const id = userIds.get(email);
    // Thrown rather than papered over with a fresh uuid: a form owned by a user who is not in the
    // dataset is invisible in every list, which is a confusing way to find out about a typo.
    if (!id) throw new Error(`demo dataset has no user ${email}`);
    return id;
  };
  const adminId = userId(DEMO_ADMIN_EMAIL);
  const operatorId = userId(DEMO_OPERATOR_EMAIL);

  // Oskar's own form, shared with Alva — this is what fills "shared with me" for the admin.
  const feedbackId = randomUUID();
  const feedbackTemplate = formSchemas.findTemplate('customer-feedback');
  // And one of Alva's in the bin, so the fourth tab has something in it to restore.
  const binnedId = randomUUID();

  return {
    organisations: [
      {
        id: organisationId,
        ...DEMO_ORGANISATION,
        supportedLocales: [...DEMO_ORGANISATION.supportedLocales],
      },
    ],

    users: DEMO_USERS.map((user) => ({
      id: userId(user.email),
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
        // The registration form is Alva's: she is the administrator and set the event up.
        ownerUserId: adminId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: feedbackId,
        organisationId,
        eventId: null,
        slug: 'kundfeedback',
        title: { 'sv-SE': 'Kundfeedback', 'en-GB': 'Customer feedback' },
        status: 'draft',
        draftDefinition: feedbackTemplate
          ? structuredClone(feedbackTemplate.definition)
          : formSchemas.emptyDefinition,
        publishedVersionId: null,
        publishedVersion: null,
        opensAt: null,
        closesAt: null,
        ownerUserId: operatorId,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: binnedId,
        organisationId,
        eventId: null,
        slug: 'gammal-enkat',
        title: { 'sv-SE': 'Gammal enkät', 'en-GB': 'Old survey' },
        status: 'draft',
        draftDefinition: formSchemas.emptyDefinition,
        publishedVersionId: null,
        publishedVersion: null,
        opensAt: null,
        closesAt: null,
        ownerUserId: adminId,
        // In the bin a week, so the demo shows a date rather than "just now".
        deletedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      },
    ],

    formShares: [
      {
        id: randomUUID(),
        organisationId,
        formId: feedbackId,
        userId: adminId,
        role: 'editor',
        createdAt: now,
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
    uploads: [],
    loginTokens: [],
    refreshTokens: [],
    jobs: [],
    sendingDomains: [],
    messages: [],
    brandKits: [
      {
        organisationId,
        tokens: DEMO_BRAND,
        updatedAt: now,
        updatedBy: null,
      },
    ],
    audit: [],
    // The ledger starts empty: a demo book with invented entries in it would be a book
    // somebody could mistake for an example of correct bookkeeping.
    invoiceBatches: [demoBilling.batch],
    invoices: demoBilling.invoices,
    ledgerAccounts: [],
    journalEntries: [],
    journalLines: [],
  };
}

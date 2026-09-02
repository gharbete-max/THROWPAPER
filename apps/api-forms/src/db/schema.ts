import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * v0.1 is single-organisation (START-HERE.md §In scope), but the row exists from day one so the
 * brand kit, locale config and audit rows have something to hang off.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  defaultLocale: text('default_locale').notNull().default('sv-SE'),
  supportedLocales: text('supported_locales').array().notNull().default(['sv-SE', 'en-GB']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** SPEC-forms.md §2 lists five roles; v0.1 ships two. The rest arrive with screens that need them. */
export const userRole = pgEnum('user_role', ['admin', 'operator']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('operator'),
    /** Set rather than deleted, so the audit log keeps pointing at a real row. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_org_email_idx').on(table.organisationId, table.email)],
);

/**
 * Magic links. Only the hash is stored — a leaked database must not hand anyone a working login.
 * Single use: `consumedAt` is set on exchange and a second attempt is refused.
 */
export const loginTokens = pgTable(
  'login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    redirectTo: text('redirect_to'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_tokens_user_idx').on(table.userId)],
);

/**
 * Refresh tokens rotate on every use. `familyId` ties a chain together: presenting a token that
 * has already been rotated means it leaked, and the whole family is revoked.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    rotatedFrom: uuid('rotated_from'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
  ],
);

/** SPEC-shared.md §Auth: "Full audit log: who changed what, when." Append-only by convention. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Null for system actions such as an expired-token sweep. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_org_at_idx').on(table.organisationId, table.at),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const eventStatus = pgEnum('event_status', ['draft', 'open', 'closed', 'archived']);

/**
 * Text is stored per locale from the start — `{ "sv-SE": "...", "en-GB": "..." }` — so phase 3's
 * translation tab is a UI change rather than a migration and a backfill.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    description: jsonb('description').$type<Record<string, string>>().notNull().default({}),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    /** Null means uncapped. */
    capacity: integer('capacity'),
    registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }),
    status: eventStatus('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('events_org_starts_idx').on(table.organisationId, table.startsAt)],
);

export const formStatus = pgEnum('form_status', ['draft', 'published', 'closed', 'archived']);

/**
 * A form's mutable head: identity, scheduling, and the draft the builder edits.
 * Published snapshots live in form_versions — SPEC-forms.md §7 stores definitions as versioned
 * JSON documents, never HTML strings.
 */
export const forms = pgTable(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Optional: a form can stand alone, or collect registrations for one event. */
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    slug: text('slug').notNull(),
    title: jsonb('title').$type<Record<string, string>>().notNull(),
    status: formStatus('status').notNull().default('draft'),
    /** The working copy. Autosaved, and never what the public sees. */
    draftDefinition: jsonb('draft_definition').$type<Record<string, unknown>>().notNull(),
    publishedVersionId: uuid('published_version_id'),
    /**
     * The published version's number, denormalised from form_versions.
     * Written only by the publish handler. Without it, listing forms costs a query per row just
     * to render "v3".
     */
    publishedVersion: integer('published_version'),
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('forms_org_slug_idx').on(table.organisationId, table.slug)],
);

/**
 * An immutable published snapshot. Submissions reference the version they were filled against,
 * so editing a form can never retroactively change what somebody answered.
 */
export const formVersions = pgTable(
  'form_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Recorded when an operator published despite missing required translations. */
    translationOverride: boolean('translation_override').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('form_versions_form_version_idx').on(table.formId, table.version)],
);

export const submissionStatus = pgEnum('submission_status', ['partial', 'complete']);

/**
 * One filled-in form.
 *
 * `formVersionId` binds the answers to the definition that was on screen, so editing a form later
 * can never change what somebody actually answered.
 */
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references(() => formVersions.id),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    /** Short human-quotable code. Phase 5 checks people in by reading this aloud at a door. */
    reference: text('reference').notNull(),
    status: submissionStatus('status').notNull().default('partial'),
    /** Locale the form was submitted in — the confirmation and PDF have to match it. */
    locale: text('locale').notNull(),
    /** Lower-cased, and only set once complete. Drives duplicate control. */
    email: text('email'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** Hashed like every other token: a leaked database must not resume anybody's draft. */
    resumeTokenHash: text('resume_token_hash'),
    resumeExpiresAt: timestamp('resume_expires_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /**
     * A withdrawn registration. START-HERE: the door must reject "duplicates and revoked entries".
     * Revoking is not deleting — the record and its audit trail stay, and the person is refused
     * with a reason rather than vanishing.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('submissions_org_reference_idx').on(table.organisationId, table.reference),
    uniqueIndex('submissions_resume_token_idx').on(table.resumeTokenHash),
    /**
     * Duplicate control by email (START-HERE v0.1). Partial, so drafts and withdrawn attempts do
     * not occupy the address — and so the database, not the handler, is the last word on it.
     */
    uniqueIndex('submissions_form_email_idx')
      .on(table.formId, table.email)
      .where(sql`${table.status} = 'complete' and ${table.email} is not null`),
    index('submissions_form_status_idx').on(table.formId, table.status),
    /**
     * Attendance and check-in read submissions by *event*, across whichever forms feed it.
     *
     * Without this the new `listForEvent` is a sequential scan of every submission the
     * organisation has ever taken — which would have replaced an N+1 with something slower on a
     * busy database, and is the kind of "optimisation" worth catching before it ships.
     */
    index('submissions_event_status_idx').on(table.eventId, table.status),
  ],
);

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

/**
 * The durable job queue — `SPEC-forms.md` §7: retries and idempotency keys for bulk PDFs and
 * exports, and `SPEC-mailer.md` §8: a send is never issued from a request handler.
 *
 * A table plus a polling worker rather than pg-boss or BullMQ: one fewer moving part, and the
 * repository seam already makes it testable. If throughput ever needs more than this, a real queue
 * slots in behind the same JobRepository interface.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Enqueueing the same key twice returns the first job rather than duplicating the work. */
    idempotencyKey: text('idempotency_key').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Progress for the UI: "142 of 200". */
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    /** Backoff: the worker ignores a job until this time. */
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('jobs_org_idempotency_idx').on(table.organisationId, table.idempotencyKey),
    index('jobs_claim_idx').on(table.status, table.runAfter),
  ],
);

/**
 * A domain mail may be sent from — `SPEC-mailer.md` §6.
 *
 * The verification result is stored rather than re-checked on every send: DNS on the hot path
 * would make sending depend on a resolver being up. It is refreshed on demand and on a schedule.
 */
/**
 * One brand kit per organisation: the token set every surface compiles from.
 *
 * Stored as a whole JSON document rather than a column per colour. The token set is a single
 * versioned artefact that four compilers read (web, email, PDF, native) and it gains fields as the
 * product grows; a column per token would mean a migration every time a designer wants one more
 * shade, and would still not describe the shape any better than the schema in packages/shared.
 *
 * A row is optional. No row means the organisation has not chosen, and the shipped defaults apply
 * — which is why nothing had to be backfilled when this arrived.
 */
export const brandKits = pgTable('brand_kits', {
  organisationId: uuid('organisation_id')
    .primaryKey()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  tokens: jsonb('tokens').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Kept for the audit trail; a brand change is the sort of thing people ask about later. */
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const sendingDomains = pgTable(
  'sending_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    /** The address mail is sent from, e.g. `anmalan@demo.se`. Must be on this domain. */
    fromAddress: text('from_address').notNull(),
    /** Selectors the provider issued. SES gives three. */
    dkimSelectors: text('dkim_selectors').array().notNull().default([]),
    verified: boolean('verified').notNull().default(false),
    checks: jsonb('checks').$type<unknown[]>().notNull().default([]),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('sending_domains_org_domain_idx').on(table.organisationId, table.domain)],
);

/**
 * Every message the system has sent — `SPEC-mailer.md` §5: "a per-recipient log of exactly what
 * was rendered and sent". Delivery events (B11) attach to these rows.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'set null' }),
    templateKey: text('template_key').notNull(),
    to: text('to').notNull(),
    locale: text('locale').notNull(),
    subject: text('subject').notNull(),
    /** Provider id, for correlating a bounce webhook back to this row. */
    providerMessageId: text('provider_message_id'),
    provider: text('provider'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_org_created_idx').on(table.organisationId, table.createdAt)],
);

export const checkInMethod = pgEnum('check_in_method', ['scan', 'manual']);

/**
 * One arrival.
 *
 * The unique index on `submission_id` is the idempotency guarantee: the database refuses a second
 * row, so a scanner that retries after a dropped response cannot double-admit anybody. That is
 * what START-HERE means by "idempotent, because that is what makes an offline mobile scanner
 * cheap" — the client can replay freely.
 */
export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkedInByUserId: uuid('checked_in_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    method: checkInMethod('method').notNull().default('scan'),
  },
  (table) => [
    uniqueIndex('check_ins_submission_idx').on(table.submissionId),
    index('check_ins_event_idx').on(table.eventId, table.checkedInAt),
  ],
);

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type FormVersion = typeof formVersions.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type BrandKit = typeof brandKits.$inferSelect;
export type SendingDomain = typeof sendingDomains.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type CheckIn = typeof checkIns.$inferSelect;

/**
 * A file a respondent attached, recorded beside the bytes rather than inside the answer.
 *
 * The submission's `data` holds only the storage key, because that is the one thing about a file
 * that is safe to trust: it is the hash of the content. Everything a person chose — the filename
 * above all — lives here, is never used to address anything, and is shown back only after being
 * read out of this table.
 *
 * `submissionId` is null until the form is actually submitted. That is what makes an abandoned
 * upload findable: somebody who attaches a CV and closes the tab leaves bytes behind, and without
 * a row saying when they arrived and that nothing ever claimed them, nothing could ever sweep them
 * up. It is also the check that stops one form's upload being pasted into another's answer.
 */
export const formUploads = pgTable(
  'form_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    /** `<sha256>.<ext>` — the content address, and the whole of what the answer stores. */
    storageKey: text('storage_key').notNull(),
    /** As the uploader named it. Display only, and escaped like any other untrusted string. */
    filename: text('filename').notNull(),
    /** Decided by reading the bytes, never by believing the upload's own declaration. */
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Reading a file back is "this key, in this organisation" — never the key on its own.
    index('form_uploads_org_key_idx').on(table.organisationId, table.storageKey),
    // Finding what to sweep: unclaimed rows, oldest first.
    index('form_uploads_unclaimed_idx')
      .on(table.createdAt)
      .where(sql`${table.submissionId} is null`),
  ],
);

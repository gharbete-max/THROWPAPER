import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
    /**
     * Who made it. **Nullable, and null means the organisation's.**
     *
     * Every form that existed before ownership did has no owner, and inventing one would be
     * guessing — probably wrongly, and in a column that decides who can see what. An unowned form
     * stays visible to everyone in the organisation, exactly as it was; new ones get an owner.
     */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * In the bin. Separate from `status: 'archived'` on purpose.
     *
     * Archived means retired but kept — a form that ran last year and should not be listed with
     * the live ones. Trashed means on its way out, restorable for now. Folding the two together
     * would make "restore from the bin" and "un-retire" the same button, and they are not.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('forms_org_slug_idx').on(table.organisationId, table.slug),
    /** "My forms" is this query, and it is the first thing anybody loads after signing in. */
    index('forms_owner_idx').on(table.organisationId, table.ownerUserId),
  ],
);

/**
 * Who else may see a form, and how much they may do with it.
 *
 * A row per person rather than a list on the form: sharing with someone has to survive them being
 * renamed, and revoking a share should be a delete rather than rewriting an array that two people
 * might be editing at once.
 *
 * `viewer` can open the form and read its responses; `editor` can also change it. Neither can
 * delete it or share it onward — those stay with the owner and with an administrator, because a
 * share that can reshare is a permission nobody can reason about after the third hop.
 */
export const formShareRole = pgEnum('form_share_role', ['viewer', 'editor']);

export const formShares = pgTable(
  'form_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: formShareRole('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One share per person per form: sharing twice is changing the role, not adding a row. */
    uniqueIndex('form_shares_form_user_idx').on(table.formId, table.userId),
    /** "Shared with me" reads this way round. */
    index('form_shares_user_idx').on(table.userId),
  ],
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

/* ==========================================================================
 * The ledger.
 *
 * Double-entry bookkeeping, and the table definitions carry the rule the whole thing rests on:
 * **a posted entry is never edited and never deleted.** There is no `updatedAt` on an entry or a
 * line, because there is no update; there is no `deletedAt`, because there is no delete. A
 * mistake is corrected by posting a reversing entry and both stay in the book for ever, which is
 * what a ledger is — the paper version is a bound book in ink, struck through and rewritten
 * beside, precisely so a later reader can see that a mistake was made and what was done about it.
 *
 * The repository behind these tables offers no update or delete either. Not guarded — absent.
 * ========================================================================== */

export const accountType = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /**
     * The account number an accountant would recognise — 1910, 3001, and so on.
     *
     * Text rather than an integer: chart-of-accounts codes are identifiers that happen to look
     * like numbers, they are sorted as text, and some plans use letters. Nobody adds two of them.
     */
    code: text('code').notNull(),
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    type: accountType('type').notNull(),
    /**
     * Retired, but kept. An account with entries against it can never be deleted — the entries
     * reference it and the book must stay readable — so retiring it is the only thing "removing"
     * an account can honestly mean.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One 1910 per organisation. A duplicated code is a chart nobody can reconcile. */
    uniqueIndex('ledger_accounts_org_code_idx').on(table.organisationId, table.code),
  ],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Human-facing, sequential per organisation, and never reused. */
    reference: text('reference').notNull(),
    description: text('description').notNull(),
    /**
     * When the thing happened, which is not when it was written down.
     *
     * An invoice dated the 31st entered on the 3rd belongs in the earlier period. Keeping both
     * dates is the difference between a book you can close and one you can only sort.
     */
    occurredOn: date('occurred_on').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    postedByUserId: uuid('posted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set on a reversal, pointing at what it undoes. Null on an ordinary entry. */
    reversesEntryId: uuid('reverses_entry_id'),
    /**
     * Set on the original when its reversal is posted.
     *
     * Denormalised on purpose: "has this been reversed" is asked on every row of every listing,
     * and answering it by searching for a reversal pointing back would be a second query per row.
     * Written in the same transaction as the reversal, so the two cannot disagree.
     */
    reversedByEntryId: uuid('reversed_by_entry_id'),
    currency: text('currency').notNull(),
  },
  (table) => [
    uniqueIndex('journal_entries_org_reference_idx').on(table.organisationId, table.reference),
    /** The book is read in date order, always. */
    index('journal_entries_org_date_idx').on(table.organisationId, table.occurredOn),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    /**
     * Minor units, as a **bigint** — CLAUDE.md rule 5.
     *
     * `numeric` would also be exact and would come back from the driver as a string that
     * everything downstream would have to remember to parse. A count of öre is a whole number by
     * construction, so the integer type says what is true and needs no parsing discipline.
     *
     * A line carries one side. Both would make "credit 50" and "debit −50" two spellings of one
     * fact, and a book where a fact has two spellings cannot be summed with confidence. The check
     * constraint below is what makes that structural rather than hopeful.
     */
    // The default is written in SQL rather than as `0n`, because drizzle-kit serialises its
    // snapshot as JSON and JSON has no bigint. The column is still a bigint either way.
    debitMinor: bigint('debit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    creditMinor: bigint('credit_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    memo: text('memo'),
    /** Position in the entry, so it reads back the way it was written. */
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('journal_lines_entry_idx').on(table.entryId),
    index('journal_lines_account_idx').on(table.accountId),
    /**
     * One side, non-negative, and never both.
     *
     * In the database rather than only in the domain: the domain is what every ordinary write
     * goes through, and this is what a migration, a repair script or a future bug goes through.
     */
    check(
      'journal_lines_one_side',
      sql`${table.debitMinor} >= 0 AND ${table.creditMinor} >= 0
          AND (${table.debitMinor} = 0) <> (${table.creditMinor} = 0)`,
    ),
  ],
);

export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'issued',
  'sent',
  'paid',
  'cancelled',
]);

/**
 * A run that produces many invoices at once: a month's rent across a property.
 *
 * Separate from the invoices themselves because the run is a thing an operator manages — they name
 * it, check it, send it, and look at what happened afterwards. Forty invoices with no record of
 * having been issued together is forty rows nobody can reason about the morning a tenant calls.
 */
export const invoiceBatches = pgTable(
  'invoice_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * When the run was actually sent, and never before it was.
     *
     * Null means issued but not sent, which is the state rule 7 requires to exist: creating and
     * sending are two decisions, and forty emails with a wrong amount is not a mistake anybody can
     * take back.
     */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** A send that went to the operator instead of to the tenants. Rule 7's test mode. */
    lastTestAt: timestamp('last_test_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invoice_batches_org_idx').on(table.organisationId)],
);

/**
 * An invoice.
 *
 * ## Why the recipient is copied rather than referenced
 *
 * The name and address are held on the row, not looked up. An invoice is a record of what was sent
 * on a day. A tenant who moves in March must not silently rewrite the address on January's
 * invoice, and a name corrected today must not change what the books say was issued.
 *
 * ## Why the OCR is a column with a unique index
 *
 * The reference is what a bank matches a payment on. Two invoices sharing one is two payments
 * nobody can tell apart, and the failure surfaces weeks later in a reconciliation that will not
 * balance. `ocr.ts` builds a well-formed reference; only this index can promise it has never been
 * used before, so the promise lives here rather than in the code that generates it.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => invoiceBatches.id, { onDelete: 'set null' }),
    /** Sequential per organisation, never reused, and what the OCR is built from. */
    number: integer('number').notNull(),
    ocr: text('ocr').notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    currency: text('currency').notNull().default('SEK'),

    recipientName: text('recipient_name').notNull(),
    recipientEmail: text('recipient_email'),
    recipientAddress: text('recipient_address'),
    /** The issuer's own reference: an apartment number, a member number, a customer number. */
    recipientReference: text('recipient_reference'),

    subject: jsonb('subject').$type<Record<string, string>>().notNull(),
    /** Inclusive, and only where the charge covers a period. Rent does; a repair does not. */
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    issuedOn: date('issued_on').notNull(),
    dueOn: date('due_on').notNull(),

    /**
     * Minor units, as bigint. Rule 5.
     *
     * Stored as well as derivable, because an invoice is a record: recomputing a total from the
     * lines years later, under whatever rounding the code has by then, is not the same as reading
     * what was actually billed.
     */
    netMinor: bigint('net_minor', { mode: 'bigint' }).notNull(),
    vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),

    paymentMethod: text('payment_method').notNull(),
    paymentAccount: text('payment_account').notNull(),

    /**
     * The token in the public link, which is deliberately not the OCR.
     *
     * The OCR is printed on the invoice, quoted on bank statements and readable by anyone who
     * handles the payment. Using it to open a web page would mean everybody in that chain can read
     * the invoice behind it. This is separate, random and long.
     */
    publicToken: text('public_token').notNull(),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The promise `ocr.ts` cannot make: this reference belongs to exactly one invoice. */
    uniqueIndex('invoices_org_ocr_idx').on(table.organisationId, table.ocr),
    /** And the number it was built from, so a repeat is impossible rather than unlikely. */
    uniqueIndex('invoices_org_number_idx').on(table.organisationId, table.number),
    /** The public link is looked up by token alone, so it is unique across every organisation. */
    uniqueIndex('invoices_public_token_idx').on(table.publicToken),
    index('invoices_org_status_idx').on(table.organisationId, table.status),
    index('invoices_batch_idx').on(table.batchId),
    /**
     * The totals have to agree in the database, not only in the code that wrote them. A migration
     * or a repair script does not go through the domain.
     */
    check(
      'invoices_total_is_net_plus_vat',
      sql`${table.totalMinor} = ${table.netMinor} + ${table.vatMinor}`,
    ),
    check('invoices_due_not_before_issue', sql`${table.dueOn} >= ${table.issuedOn}`),
  ],
);

/**
 * One line on an invoice: rent, cable television, a parking space.
 *
 * The line's own amount is stored rather than recomputed, for the same reason the invoice total is.
 * What a tenant was billed for their parking space in March is a fact about March.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    /** Localised: a tenant reads their invoice in their own language. */
    description: jsonb('description').$type<Record<string, string>>().notNull(),
    /** Thousandths, so half a month and a third of a shared meter stay exact. */
    quantityThousandths: bigint('quantity_thousandths', { mode: 'bigint' }).notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /** Basis points: 2500 is 25%. Rent is usually exempt, which is why zero is ordinary here. */
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull().default(0),
    vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => [index('invoice_lines_invoice_idx').on(table.invoiceId)],
);

/**
 * A cost the issuer defines once and puts on invoices.
 *
 * There is no list of charge types in this product. Rent is one of these, cable television is one
 * of these, a storage cupboard and a second parking space are two more, and a gym's joining fee is
 * one as well. The landlord writes their own, because the alternative is a fixed set that is wrong
 * for the second customer and every customer after them.
 *
 * The amount here is a **default**, not the amount. Rent differs per tenant and is set on the
 * tenancy; cable television is usually the same for everybody and is not. Both cases fall out of
 * the same table without a flag saying which one this is.
 */
export const chargeTypes = pgTable(
  'charge_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Localised, because it is printed on an invoice somebody reads in their own language. */
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    /** Minor units. What this costs unless a recipient has their own figure. */
    defaultUnitAmountMinor: bigint('default_unit_amount_minor', { mode: 'bigint' }).notNull(),
    /** Basis points: 2500 is 25%. Residential rent is exempt in Sweden, so zero is ordinary. */
    vatRateBasisPoints: integer('vat_rate_basis_points').notNull().default(0),
    /**
     * Retired, not deleted.
     *
     * Invoices copy their lines, so removing a charge type cannot corrupt an issued invoice — but
     * it can make last year's book unreadable to somebody trying to work out what a line was.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('charge_types_org_idx').on(table.organisationId)],
);

/**
 * Somebody who gets invoiced, month after month: a tenant, a member, a client on a retainer.
 *
 * Kept because rent recurs. Retyping forty names, addresses and amounts every month is not a
 * workflow, and the batch endpoint accepting them inline is only reasonable for a one-off run.
 *
 * An invoice still copies the name and address at the moment it is issued. This row is who they
 * are now; the invoice is who they were in March.
 */
export const billingRecipients = pgTable(
  'billing_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    address: text('address'),
    /** The issuer's own handle for them: an apartment number, a member number, a customer number. */
    reference: text('reference'),
    /**
     * Which language their invoice is written in.
     *
     * Held on the recipient rather than guessed from the organisation, because a property has
     * tenants who do not all read Swedish and an invoice is the wrong document to make somebody
     * puzzle over.
     */
    locale: text('locale'),
    /** Moved out, left the club. Their invoices stay; they stop appearing in new runs. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('billing_recipients_org_idx').on(table.organisationId),
    /**
     * One apartment number per organisation, when one is given.
     *
     * Partial, because a reference is optional: a landlord numbers flats, a gym may not number
     * members at all, and a unique index over nulls would refuse the second member with none.
     */
    uniqueIndex('billing_recipients_org_reference_idx')
      .on(table.organisationId, table.reference)
      .where(sql`reference is not null`),
  ],
);

/**
 * A charge that applies to this recipient every time an invoice is made for them.
 *
 * This is the standing arrangement: this tenant pays this rent, has cable television, and rents the
 * second parking space. A run over forty tenants reads these and needs nothing typed.
 *
 * ## Why the amount can be null
 *
 * Null means "whatever the charge type currently says". That is what makes raising cable television
 * for every tenant one edit instead of forty. Rent, which differs per tenant, carries its own
 * figure here and ignores the default.
 *
 * The risk is real and worth stating: changing a default silently changes what every recipient
 * relying on it will be billed next time. It cannot alter an invoice that has already been issued,
 * because invoices copy their lines — so the blast radius is the next run, which is a run somebody
 * has to confirm before it sends.
 */
export const recipientCharges = pgTable(
  'recipient_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => billingRecipients.id, { onDelete: 'cascade' }),
    chargeTypeId: uuid('charge_type_id')
      .notNull()
      .references(() => chargeTypes.id, { onDelete: 'restrict' }),
    /** Null defers to the charge type's default. See above for what that costs. */
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }),
    /**
     * Thousandths, so half a parking space between two flats is expressible.
     *
     * The default is written as SQL rather than as `1000n`: drizzle-kit serialises its schema
     * snapshot to JSON, and `JSON.stringify` refuses a bigint outright. The literal below is what
     * reaches the column definition either way.
     */
    quantityThousandths: bigint('quantity_thousandths', { mode: 'bigint' })
      .notNull()
      .default(sql`1000`),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('recipient_charges_recipient_idx').on(table.recipientId),
    /** The same charge twice on one recipient is a duplicate line nobody meant to add. */
    uniqueIndex('recipient_charges_unique_idx').on(table.recipientId, table.chargeTypeId),
  ],
);

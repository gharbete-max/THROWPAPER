import {
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

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;

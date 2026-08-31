import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * First migration. v0.1 is single-organisation (START-HERE.md §In scope) but the row exists from
 * day one so brand kit, locale config and audit rows have something to hang off.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  defaultLocale: text('default_locale').notNull().default('sv-SE'),
  supportedLocales: text('supported_locales').array().notNull().default(['sv-SE', 'en-GB']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;

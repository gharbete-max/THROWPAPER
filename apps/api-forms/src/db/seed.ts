import { db, sql } from './client.js';
import { organisations } from './schema.js';

/**
 * CLAUDE.md §Demo data — a broken seed blocks demos. v0.1 grows this to a demo event with
 * ~200 registrations (START-HERE.md §In scope); right now it is the single organisation.
 */
await db
  .insert(organisations)
  .values({ name: 'Demo AB', slug: 'demo', defaultLocale: 'sv-SE' })
  .onConflictDoNothing({ target: organisations.slug });

console.log('seed complete');
await sql.end();

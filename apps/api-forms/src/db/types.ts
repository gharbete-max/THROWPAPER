import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

/**
 * The database the repositories run against, whichever driver carries it.
 *
 * It was `typeof db` from `client.ts`, which is postgres.js specifically. The repositories never
 * needed that: every query is Drizzle's Postgres dialect, and the one raw `execute` takes a row
 * lock and reads nothing back. Widening it to the dialect is what lets the desktop edition run the
 * same repositories on an embedded Postgres (`pglite.ts`, ADR 0016) — one implementation, two
 * drivers, and no second set of queries to keep in step.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

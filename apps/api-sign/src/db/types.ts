import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

/**
 * Sign's database, whichever driver carries it: postgres.js on a server, PGlite in the desktop
 * edition (`pglite.ts`). Every query is Drizzle's Postgres dialect, so the store, the routes and
 * the append-only triggers are one implementation on both — the same widening api-forms made.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

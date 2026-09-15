import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createMaintenanceClient } from './client.js';

/*
 * Its own connection, not the serving pool.
 *
 * The pool carries a statement timeout, and a migration that adds an index to a table with real
 * data in it runs for minutes. Sharing the pool would have meant that migration being cancelled
 * halfway on the first deployment large enough to matter — having passed every test, because the
 * database the tests run against is empty.
 */
const { db, sql } = createMaintenanceClient();

await migrate(db, { migrationsFolder: 'drizzle' });
console.log('migrations applied');
await sql.end();

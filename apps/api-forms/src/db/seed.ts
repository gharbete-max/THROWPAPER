import { createMaintenanceClient } from './client.js';
import { seedDemo } from './seed-demo.js';

/*
 * Its own connection rather than the serving pool: seeding inserts ~200 registrations in one
 * sequential script, which is maintenance work and not a request to be timed out.
 */
const { db, sql } = createMaintenanceClient();

const { formSlug } = await seedDemo(db);
console.log(`seed complete — sign in as admin@example.com, form at /f/${formSlug}`);
await sql.end();

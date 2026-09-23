import { env } from '../env.js';
import { connect, migrateDatabase } from './client.js';
import { declarations } from './schema.js';

/**
 * Sign's demo data: one declaration, and it is a placeholder.
 *
 * Signing is blocked without a human-authored declaration (ADR 0012), and CLAUDE.md rule 8 forbids
 * writing one here. So the seed ships the proxy template's pattern — structure, with the operative
 * sentence as an explicit bracketed placeholder — marked `testOnly`, which a production envelope
 * refuses. A test-mode envelope can be demonstrated end to end; nothing real can be signed
 * against text nobody wrote.
 */
await migrateDatabase(env.SIGN_DATABASE_URL);
const { db, sql } = connect(env.SIGN_DATABASE_URL, 1);

await db
  .insert(declarations)
  .values({
    key: 'demo',
    version: 1,
    testOnly: true,
    texts: {
      'sv-SE': '[Försäkran skrivs av en människa — endast testläge]',
      'en-GB': '[Declaration to be written by a person — test mode only]',
    },
  })
  .onConflictDoNothing();

console.log('sign: seed complete — declaration "demo" (test-mode placeholder)');
await sql.end();

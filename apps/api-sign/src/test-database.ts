import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import {
  connect,
  DEFAULT_SIGN_DATABASE_URL,
  MIGRATIONS,
  migrateDatabase,
  type Db,
} from './db/client.js';
import { openLocalSignDatabase } from './db/pglite.js';

let driver: 'postgres' | 'pglite' = 'postgres';

/**
 * Runs the calling file's suite on PGlite instead — the desktop edition's database. Set before
 * the suite is imported (`envelopes-pglite.test.ts`); module state, so it stays in that file.
 */
export function usePglite(): void {
  driver = 'pglite';
}

/**
 * A throwaway Sign database for one test file: created, migrated, dropped.
 *
 * Sign's tables refuse DELETE and TRUNCATE by design, so a test cannot clean up after itself the
 * usual way — and should not have to share state with the next run anyway. A fresh database per
 * file needs nothing seeded and leaves nothing behind.
 *
 * **Skips only where no database was asked for.** When `SIGN_DATABASE_URL` or `DATABASE_URL` is
 * set (CI's verify job sets it), an unreachable server is a failure, not a skip: the guarantees
 * these tests hold — append-only, the hash chain — exist only in Postgres, and a skipped proof of
 * them printed green once already (CLAUDE.md, "Never mistake a proxy for the thing").
 */
export async function testDatabase(): Promise<{ db: Db; drop: () => Promise<void> } | null> {
  if (driver === 'pglite') {
    // In memory, so there is nothing to drop and nothing that could be unreachable.
    const local = await openLocalSignDatabase({ migrationsFolder: MIGRATIONS });
    return { db: local.db, drop: local.close };
  }
  const configured = process.env['SIGN_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  const url = new URL(configured ?? DEFAULT_SIGN_DATABASE_URL);
  const name = `throwpaper_sign_test_${randomBytes(4).toString('hex')}`;
  url.pathname = `/${name}`;

  try {
    await migrateDatabase(url.toString());
  } catch (error) {
    if (configured) throw error;
    return null;
  }

  const { db, sql } = connect(url.toString(), 5);
  return {
    db,
    drop: async () => {
      await sql.end();
      const admin = new URL(url);
      admin.pathname = '/postgres';
      const server = postgres(admin.toString(), { max: 1, onnotice: () => {} });
      await server.unsafe(`drop database if exists ${name} with (force)`);
      await server.end();
    },
  };
}

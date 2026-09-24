import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';
import type { Db } from './types.js';

/**
 * Sign's database inside the process, for the desktop edition (ADR 0016).
 *
 * PGlite is Postgres compiled to WebAssembly, so the same migrations run on it — including the
 * plpgsql triggers that make the evidence append-only (`drizzle/0001`, `0002`). The guarantee does
 * not weaken because the database moved onto a laptop. It is a directory of its own, never the
 * Forms workspace's database: Sign's data stays Sign's (ADR 0009).
 */
export interface LocalSignDatabase {
  db: Db;
  close(): Promise<void>;
}

export async function openLocalSignDatabase(options: {
  /** Omitted: in memory, for tests. */
  dataDir?: string;
  migrationsFolder: string;
}): Promise<LocalSignDatabase> {
  const client = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  // Every start, as the Forms workspace does: one process owns the directory, and a desktop user
  // has no shell to run a migration from.
  await migrate(db, { migrationsFolder: options.migrationsFolder });
  return { db, close: () => client.close() };
}

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createDrizzleRepositories } from './repositories/index.js';
import type { Repositories } from './repositories/index.js';
import * as schema from './schema.js';
import type { Db } from './types.js';

/**
 * Postgres inside the process, for the desktop edition (ADR 0016).
 *
 * PGlite is real Postgres compiled to WebAssembly: the same planner, the same types, the same
 * `for update` and check constraints. That is why it was chosen over SQLite — the sixteen
 * migrations in `drizzle/` run on it unchanged, and so do the Drizzle repositories, so the desktop
 * is not a second implementation of the product that could quietly disagree with the server.
 *
 * What it is not: a server. One process owns the data directory; there is no pool and no second
 * connection. The desktop is one person on one machine, which is the shape it fits. A second
 * process opening the same directory is refused by the desktop shell's single-instance lock, not
 * by this file.
 */
export interface LocalDatabase {
  db: Db;
  repos: Repositories;
  /** Cheap liveness query for `/health`, the same shape as the server's Postgres ping. */
  ping(): Promise<unknown>;
  close(): Promise<void>;
}

export interface OpenLocalDatabaseOptions {
  /**
   * A directory on disk, created if absent. Omitted, the database lives in memory and vanishes
   * with the process — which is what the tests want and nothing else should.
   */
  dataDir?: string;
  /** Where the SQL migrations are. The desktop bundle carries them beside its entry point. */
  migrationsFolder: string;
}

export async function openLocalDatabase(options: OpenLocalDatabaseOptions): Promise<LocalDatabase> {
  const client = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  const db = drizzle(client, { schema });

  /*
   * Migrations run at every start, which `DEPLOY.md` deliberately does not do for the server. The
   * reason there — two containers racing — cannot happen here: one process owns the directory.
   * And a desktop user has no shell to run `db:migrate` from, so an update that needed one would
   * be an update that broke their data.
   */
  await migrate(db, { migrationsFolder: options.migrationsFolder });

  return {
    db,
    repos: createDrizzleRepositories(db),
    ping: () => client.query('select 1'),
    close: () => client.close(),
  };
}

import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';
import type { Db } from './types.js';

export type { Db } from './types.js';

export const DEFAULT_SIGN_DATABASE_URL =
  'postgres://throwpaper:throwpaper@localhost:5432/throwpaper_sign';

export const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function connect(url: string, max = 10): { db: Db; sql: postgres.Sql } {
  const sql = postgres(url, {
    max,
    connect_timeout: 10,
    onnotice: () => {},
    // Same limits as api-forms' pool, for the same reason: fail a pathological query, never hang.
    connection: { statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000 },
  });
  return { db: drizzle(sql, { schema }), sql };
}

/**
 * Creates Sign's database when it does not exist, then migrates it.
 *
 * Sign's data lives in a database of its own (ADR 0009), so a machine that already runs Forms has
 * the server but not the database. Creating it here keeps `pnpm db:migrate` one command on a fresh
 * laptop and on CI, rather than a manual `createdb` somebody has to know about.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected database name "${name}"`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const server = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await server`select 1 from pg_database where datname = ${name}`;
    if (!exists) await server.unsafe(`create database ${name}`);
  } finally {
    await server.end();
  }

  // Its own connection without a statement timeout: a migration on real data may take minutes.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end();
  }
}

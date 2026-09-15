import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * The pool the server serves requests from.
 *
 * It was `postgres(env.DATABASE_URL, { max: 10 })` — a connection count and nothing else. No
 * statement timeout, so one query with a bad plan holds a connection until the database or the
 * client gives up, which by default is never; no connect timeout, so a database that accepts TCP
 * and then stops answering leaves a request hanging rather than failing; no idle timeout, so ten
 * connections are held open against a host that may bill for them and may be a pooler with its own
 * opinion about that.
 *
 * All four are environment variables rather than constants because the right values depend on a
 * decision that has not been made — see `LAUNCH-CHECKLIST.md` §3, hosting provider and region.
 * A VM wants a real pool; a serverless runtime wants `max: 1` per instance in front of PgBouncer
 * or similar. The defaults below are sane for a long-lived container, which is what the Dockerfile
 * builds today, and none of them needs a code change to become right for something else.
 */
const poolOptions = {
  max: env.DATABASE_POOL_MAX,
  /** Seconds a connection may sit unused before it is closed. */
  idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
  /** Seconds to wait for a new connection before failing the request rather than hanging on it. */
  connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
  connection: {
    /**
     * Postgres cancels a query that runs longer than this, in milliseconds.
     *
     * Set on the connection rather than per query so it covers every statement the app will ever
     * issue, including ones written after this line. The value is a limit on the pathological
     * case, not a target: the queries this product runs are indexed lookups that return in
     * milliseconds, and anything approaching fifteen seconds is a bug worth failing on rather
     * than a slow request worth waiting for.
     */
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    /**
     * And a transaction left open by a handler that threw between `BEGIN` and `COMMIT`.
     *
     * A statement timeout does not catch that: the session is idle, not running anything. It is
     * still holding its locks, and the rows it touched stay locked for every other request until
     * something closes it.
     */
    idle_in_transaction_session_timeout: env.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
  },
} as const;

export const sql = postgres(env.DATABASE_URL, poolOptions);
export const db = drizzle(sql, { schema });
export type Db = typeof db;

/**
 * A separate connection for migrations and seeding, deliberately without the serving limits.
 *
 * `db:migrate` and `db:seed` shared the pool above, which would have made the statement timeout
 * apply to them — and a migration that adds an index to a table with real data in it runs for
 * minutes, not seconds. It would have been cancelled halfway, on the first deployment big enough
 * to matter, having passed every test on an empty database.
 *
 * `max: 1` because both are a single sequential script, and because a migration holding locks on
 * more than one connection is a way to deadlock against itself.
 */
export function createMaintenanceClient() {
  const maintenanceSql = postgres(env.DATABASE_URL, {
    max: 1,
    connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
  });
  return { sql: maintenanceSql, db: drizzle(maintenanceSql, { schema }) };
}

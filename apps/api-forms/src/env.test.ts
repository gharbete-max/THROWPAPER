import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The database limits, as the environment actually parses them.
 *
 * `env.ts` reads `process.env` once at import, so each case resets the module registry and
 * re-imports rather than mutating a value already parsed.
 *
 * There is no Postgres in this environment to point these at, so what is proven here is the half
 * that is ours: the defaults are the numbers the comments claim, and an operator's override
 * arrives as a number rather than a string. That the option *names* are right is proven by the
 * driver's own types — `idle_timeout`, `connect_timeout`, `connection.statement_timeout` and
 * `connection.idle_in_transaction_session_timeout` are all declared in `postgres@3.4.9`, and
 * `client.ts` does not typecheck without them.
 */
async function loadEnv() {
  vi.resetModules();
  const module = await import('./env.js');
  return module.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('database limits', () => {
  it('defaults to a pool suited to a long-lived container', async () => {
    const env = await loadEnv();

    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_IDLE_TIMEOUT_SECONDS).toBe(30);
    expect(env.DATABASE_CONNECT_TIMEOUT_SECONDS).toBe(10);
  });

  /**
   * A limit on the pathological case, not a target. The queries this product runs are indexed
   * lookups that return in milliseconds.
   */
  it('cancels a query that runs for fifteen seconds', async () => {
    expect((await loadEnv()).DATABASE_STATEMENT_TIMEOUT_MS).toBe(15_000);
  });

  /**
   * The one a statement timeout does not catch: a transaction left open by a handler that threw
   * between `BEGIN` and `COMMIT` is idle, not running anything, and still holding its locks.
   */
  it('closes a transaction left open for thirty seconds', async () => {
    expect((await loadEnv()).DATABASE_IDLE_TRANSACTION_TIMEOUT_MS).toBe(30_000);
  });

  /**
   * The case the variables exist for: hosting is undecided, and a serverless runtime wants one
   * connection per instance in front of a pooler rather than ten of its own.
   */
  it('takes an operator’s override as a number, not a string', async () => {
    vi.stubEnv('DATABASE_POOL_MAX', '1');
    vi.stubEnv('DATABASE_STATEMENT_TIMEOUT_MS', '5000');

    const env = await loadEnv();

    expect(env.DATABASE_POOL_MAX).toBe(1);
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(5000);
  });

  /** Zero is how an operator disables a timeout; a pool of zero connections serves nobody. */
  it('allows a timeout to be switched off but not an empty pool', async () => {
    vi.stubEnv('DATABASE_STATEMENT_TIMEOUT_MS', '0');
    await expect(loadEnv()).resolves.toMatchObject({ DATABASE_STATEMENT_TIMEOUT_MS: 0 });

    vi.resetModules();
    vi.stubEnv('DATABASE_POOL_MAX', '0');
    await expect(loadEnv()).rejects.toThrow();
  });
});

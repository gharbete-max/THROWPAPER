import { config } from 'dotenv';
import { z } from 'zod';

config({ path: ['.env', '../../.env'] });

const Env = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://throwpaper:throwpaper@localhost:5432/throwpaper'),
  API_FORMS_PORT: z.coerce.number().int().default(4001),
  /**
   * Which interface to listen on. Every interface by default, because the Docker image needs it;
   * `127.0.0.1` on a laptop, so that trusting a loopback forwarder (`TRUST_PROXY=loopback`) does
   * not sit beside a port the whole LAN can reach directly.
   */
  API_FORMS_HOST: z.string().default('0.0.0.0'),
  /**
   * Connection pool and query limits. See `db/client.ts` for what each one prevents.
   *
   * Environment variables rather than constants because the right values depend on the hosting
   * decision that is still open (`LAUNCH-CHECKLIST.md` §3): a long-lived container wants a real
   * pool, a serverless runtime wants one connection per instance in front of a pooler. The
   * defaults suit the container the Dockerfile builds today.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** Seconds a pooled connection may sit unused before it is closed. */
  DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Seconds to wait for a connection before failing, rather than hanging on it. */
  DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(10),
  /**
   * Milliseconds after which Postgres cancels a query. A limit on the pathological case, not a
   * target — the queries here are indexed lookups that return in milliseconds.
   */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
  /**
   * Milliseconds after which a transaction left open — by a handler that threw between `BEGIN`
   * and `COMMIT` — is closed. A statement timeout does not catch it: the session is idle, and
   * still holding every lock it took.
   */
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Signs access tokens. No default — a predictable secret mints admin sessions.
   * Optional here so db:migrate and db:seed, which never sign anything, do not need one;
   * main.ts refuses to start the server without it.
   */
  JWT_SECRET: z.string().min(32).optional(),
  /** Base URL of apps/forms, used to build magic links and to scope CORS. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /**
   * Which proxies in front of this server may be believed. **Empty is wrong once deployed.**
   *
   * Every rate limit keys on `request.ip`, which without this is the socket address. Behind a TLS
   * terminator that is the *proxy's* address for every visitor, so they all share one bucket — and
   * `POST /v1/auth/magic-link` is capped at 5 per 15 minutes. Six requests from anywhere would
   * disable sign-in for the whole tenant, and magic link is the only door. It also makes every
   * `auditLog.ip` the proxy's rather than the actor's.
   *
   * **A list of addresses, deliberately not `true`.** `trustProxy: true` believes the entire
   * `X-Forwarded-For` header including the part the client wrote, so anyone could forge their own
   * address and walk around every limit — trading a denial-of-service for a bypass. Naming the
   * proxies means only a hop that really is yours is believed.
   *
   * Comma-separated. Takes an address, a CIDR range, or one of proxy-addr's names: `loopback`,
   * `linklocal`, `uniquelocal`. Example: `10.0.0.0/8,uniquelocal`.
   *
   * Empty is today's behaviour and is correct on localhost. See `PRE-LAUNCH-AUDIT.md`.
   */
  TRUST_PROXY: z.string().default(''),
});

export const env = Env.parse(process.env);

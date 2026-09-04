/**
 * Demo mode: the whole product, in memory, with no database.
 *
 * This exists for two reasons. It lets anyone run the stack without Docker — which is how it gets
 * evaluated, demonstrated and developed on a machine that has no Postgres. And it makes a
 * deployable demo somebody can be pointed at.
 *
 * It is not a second implementation. The repository seam from phase 2 means demo mode is the
 * in-memory repositories that already back the tests, wired to the same server, with the dataset
 * the SQL seed uses. Nothing here forks the product.
 */
import { randomBytes } from 'node:crypto';
import { buildServer } from '../server.js';
import { createMemoryMailProvider } from '../mail/provider.js';
import { createMemoryRepositories } from '../db/repositories/index.js';
import { createMemoryDocumentStore } from '../documents/store.js';
import { createMemoryAssetStore } from '../uploads/store.js';
import { createPdfRenderer } from '../documents/render.js';
import { buildDemoState, DEMO_FORM_SLUG, DEMO_USERS } from './dataset.js';

const PORT = Number(process.env['API_FORMS_PORT'] ?? 4001);
const APP_URL = process.env['APP_URL'] ?? 'http://localhost:5173';
/**
 * A fresh secret every boot, rather than one written down here.
 *
 * This used to fall back to a constant string. That string is in a public repository, and the
 * guard below only refuses to start when `NODE_ENV` is exactly `production` — which is unset on
 * plenty of real deployments. Anyone who had read the source could have minted an admin session
 * against any demo running without an explicit `JWT_SECRET`.
 *
 * Random costs nothing here: demo data lives in memory and is lost on restart, so a session that
 * does not survive a restart either is not a regression. It is the data's own lifetime.
 */
const JWT_SECRET = process.env['JWT_SECRET'] ?? randomBytes(32).toString('base64url');

/**
 * A demo binary that boots as production with no database and no real mail would be a quiet
 * disaster. It has to be asked for twice.
 */
if (process.env['NODE_ENV'] === 'production' && process.env['DEMO_ALLOW_PRODUCTION'] !== 'true') {
  throw new Error(
    'Refusing to start demo mode with NODE_ENV=production. Demo data is in memory and is lost on ' +
      'restart, and mail is never sent. Set DEMO_ALLOW_PRODUCTION=true if a public demo really is ' +
      'what you want.',
  );
}

const repos = createMemoryRepositories(buildDemoState());

/**
 * Hard-wired, not configured. Demo mode cannot construct the SES provider, so no demo can ever
 * send to a real address however the environment is set.
 */
const mail = createMemoryMailProvider();

const app = await buildServer({
  repos,
  mail,
  store: createMemoryDocumentStore(JWT_SECRET),
  // In memory too, so a demo cannot leave uploaded files behind on whatever it is running on.
  assets: createMemoryAssetStore(),
  // The real renderer: admission PDFs are half the point of a demo.
  renderer: createPdfRenderer(),
  jwtSecret: JWT_SECRET,
  appUrl: APP_URL,
  probeDatabase: false,
  startWorker: true,
  demo: {
    reset: () => {
      const fresh = buildDemoState();
      for (const key of Object.keys(repos.state) as Array<keyof typeof repos.state>) {
        (repos.state[key] as unknown[]).length = 0;
        (repos.state[key] as unknown[]).push(...(fresh[key] as unknown[]));
      }
      mail.sent.length = 0;
    },
    /** So the app can show a sign-in shortcut instead of a magic link nobody can read. */
    users: DEMO_USERS.map((user) => ({ email: user.email, role: user.role })),
    formSlug: DEMO_FORM_SLUG,
  },
});

await app.listen({ port: PORT, host: '0.0.0.0' });

app.log.info(
  `\n  Demo mode — in memory, no database.\n` +
    `  Public form:  ${APP_URL}/f/${DEMO_FORM_SLUG}\n` +
    `  Sign in as:   ${DEMO_USERS.map((u) => u.email).join(' or ')}\n` +
    `  Mail is never sent. Data resets on restart or POST /demo/reset.\n`,
);

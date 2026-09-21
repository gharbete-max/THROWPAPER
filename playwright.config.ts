import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: a real browser against a real server against a real Postgres.
 *
 * Everything else in this repo tests handlers against in-memory repositories, which is what keeps
 * `pnpm verify` meaningful without Docker. This suite exists for what that cannot reach — the
 * built bundle, the code-split routes, the browser's own behaviour, and the wiring between the
 * two apps.
 *
 * It drives the **built** app rather than the dev server, because two of the routes it exercises
 * are code-split (the public form and the check-in screen) and a dev server would not prove those
 * chunks load.
 *
 * `pnpm test:e2e` probes for a database first and skips loudly when there is none, so this never
 * silently passes on a machine without Docker.
 */
const API_PORT = 4001;
const APP_PORT = 4173;
const APP_URL = `http://localhost:${APP_PORT}`;

/**
 * Drive an app that is already running somewhere else — the ngrok tunnel in front of the built
 * app served by the API, for the local track's proof. When set, no server is started here; the
 * database helpers in `e2e/support.ts` still need `DATABASE_URL` to reach the same Postgres that
 * server is using. Unset, everything below is exactly as before, which is what CI runs.
 */
const EXTERNAL_URL = process.env['E2E_BASE_URL'];

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'e2e-only-secret-at-least-thirty-two-characters';
const DOCUMENT_SIGNING_SECRET =
  process.env['DOCUMENT_SIGNING_SECRET'] ?? 'e2e-only-document-secret-at-least-thirty-two';

export default defineConfig({
  testDir: './e2e',
  // A door and a public form are not places to tolerate flake, so a failure is a failure.
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The HTML report is what CI uploads on failure; it carries the traces and screenshots with it.
  reporter: process.env['CI'] ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: EXTERNAL_URL ?? APP_URL,
    // ngrok's free tier answers a browser with an interstitial first; this header skips it.
    ...(EXTERNAL_URL && { extraHTTPHeaders: { 'ngrok-skip-browser-warning': '1' } }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Chromium only: it is what the PDF pipeline already installs, and adding two more browser
    // downloads to CI buys little for an internal admin tool.
    ...devices['Desktop Chrome'],
  },

  webServer: EXTERNAL_URL
    ? []
    : [
        {
          command: 'pnpm --filter @tp/api-forms exec tsx src/main.ts',
          port: API_PORT,
          reuseExistingServer: !process.env['CI'],
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            DATABASE_URL,
            JWT_SECRET,
            DOCUMENT_SIGNING_SECRET,
            API_FORMS_PORT: String(API_PORT),
            APP_URL,
            // Console, so nothing is ever sent from a test run.
            MAIL_PROVIDER: 'console',
            NODE_ENV: 'development',
          },
        },
        {
          command: 'pnpm --filter @tp/forms build && pnpm --filter @tp/forms exec vite preview',
          port: APP_PORT,
          reuseExistingServer: !process.env['CI'],
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
      ],
});

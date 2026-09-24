/**
 * The desktop edition without its window: `pnpm --filter @tp/api-forms desktop`.
 *
 * The same `startDesktopServer` the Electron shell runs, from a terminal, on any OS. It is how the
 * edition is exercised where there is no display — CI, a Linux box, this repository's own e2e —
 * and a way in for anyone who would rather use their own browser than a window.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDesktopServer } from './start.js';

const here = import.meta.dirname;
const dataDir = process.env['LOPPA_DATA_DIR'] ?? join(homedir(), '.loppa');
const server = await startDesktopServer({
  dataDir,
  webDir: process.env['LOPPA_WEB_DIR'] ?? resolve(here, '..', '..', '..', 'forms', 'dist'),
  migrationsFolder: process.env['LOPPA_MIGRATIONS'] ?? resolve(here, '..', '..', 'drizzle'),
  ...(process.env['LOPPA_PORT'] ? { port: Number(process.env['LOPPA_PORT']) } : {}),
});

if (!(await server.isSetUp()) && process.argv.includes('--demo')) await server.loadDemo();

const link = await server.signInLink();
console.log(
  `\n  Loppa is running on this machine only: ${server.url}\n` +
    `  Data folder:  ${dataDir}\n` +
    `  Mail:         ${server.settings.mail.mode === 'outbox' ? `test mode — written to ${server.paths.outbox}` : 'SMTP'}\n` +
    (link
      ? `  Sign in:      ${link}\n                (single use, 15 minutes; restart for another)\n`
      : '  Not set up yet. Run again with --demo for the demo data, or use the desktop app.\n'),
);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

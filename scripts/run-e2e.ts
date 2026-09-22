/**
 * Runs the end-to-end suite, or says clearly why it did not.
 *
 * The suite needs a database. Rather than let Playwright start two servers and fail with a
 * connection error thirty seconds later, this probes first and skips with the command that fixes
 * it — the same pattern as the database smoke test in apps/api-forms.
 *
 * **Skipping fails.** It used to exit 0, so that `pnpm verify` on a machine without Docker would
 * not fail — but an exit code is what scripts and agents read, and a skipped suite that exits 0 is
 * indistinguishable from nineteen passing tests. It reports exit 2, distinct from Playwright's
 * own 1, so "the suite did not run" is never mistaken for "the suite passed". Pass `--allow-skip`
 * to get the old lenient behaviour deliberately. CI always has a database and never reaches here.
 */
import { spawn } from 'node:child_process';
import postgres from 'postgres';

// Consumed here, never forwarded: `playwright test` would reject an unknown flag.
const args = process.argv.slice(2).filter((arg) => arg !== '--allow-skip');
const allowSkip = process.argv.slice(2).includes('--allow-skip');

const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const redacted = url.replace(/:[^:@]*@/, ':***@');

/** Exit 2, or 0 when the caller explicitly asked to tolerate a skip. */
function skip(why: string, remedy: string): never {
  console.log(`E2E SKIPPED: ${why}. ${remedy}`);
  if (!allowSkip) {
    console.log('E2E SKIPPED: exiting 2 — the suite did not run. Pass --allow-skip to allow this.');
  }
  process.exit(allowSkip ? 0 : 2);
}

const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });

const reachable = await sql`select 1`.then(
  () => true,
  () => false,
);

// Present but unmigrated is a different problem from absent, and deserves a different message.
const seeded = reachable
  ? await sql`select 1 from forms where published_version_id is not null limit 1`.then(
      (rows) => rows.length > 0,
      () => false,
    )
  : false;

await sql.end();

if (!reachable) {
  skip(`no Postgres at ${redacted}`, 'Run pnpm db:up && pnpm db:migrate && pnpm db:seed');
}

if (!seeded) {
  skip('the database has no published form', 'Run pnpm db:migrate && pnpm db:seed');
}

const child = spawn('pnpm', ['exec', 'playwright', 'test', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));

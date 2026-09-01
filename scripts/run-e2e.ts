/**
 * Runs the end-to-end suite, or says clearly why it did not.
 *
 * The suite needs a database. Rather than let Playwright start two servers and fail with a
 * connection error thirty seconds later, this probes first and skips with the command that fixes
 * it — the same pattern as the database smoke test in apps/api-forms.
 *
 * Skipping exits 0 on purpose: `pnpm verify` on a machine without Docker should not fail, but it
 * must not pretend the suite ran either. CI always has a database, so it always runs there.
 */
import { spawn } from 'node:child_process';
import postgres from 'postgres';

const url =
  process.env['DATABASE_URL'] ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper';
const redacted = url.replace(/:[^:@]*@/, ':***@');

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
  console.log(
    `SKIPPED: no Postgres at ${redacted}. Run pnpm db:up && pnpm db:migrate && pnpm db:seed`,
  );
  process.exit(0);
}

if (!seeded) {
  console.log('SKIPPED: the database has no published form. Run pnpm db:migrate && pnpm db:seed');
  process.exit(0);
}

const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));

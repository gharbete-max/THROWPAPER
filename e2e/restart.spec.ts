import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  DATABASE_URL,
  db,
  deleteSubmission,
  plantRefreshToken,
  seededForm,
  uniqueEmail,
} from './support.js';

/**
 * The application dies and comes back, and everything it was asked to keep is still there.
 *
 * Rows in Postgres surviving a restart is not in doubt. What nobody had shown is the rest of a
 * customer's dataset: the bytes of a generated ZIP, the bytes of an uploaded logo, and a job that
 * was in flight at the moment the process was killed. So this spec runs its own API — not the
 * one Playwright starts for the browser specs — against the same database, creates one of each,
 * kills it with SIGKILL (the honest crash: no shutdown hook runs), starts it again, and asks for
 * all of them back.
 *
 * It shares the document directory with the API Playwright started, deliberately: both processes
 * poll the same `jobs` table, so either worker may take the export, and a file written by one
 * instance onto a disk the other cannot see is a 404 — which is the whole case for an object
 * store the day there are two instances. Today there is one, and one directory.
 *
 * A job "running" when a worker dies is the interesting case. `claim()` only takes `queued`
 * rows, so without recovery such a job stays `running` forever and its export never arrives.
 */
const PORT = 4102;
const BASE = `http://localhost:${PORT}`;
const API_DIR = resolve('apps/api-forms');
/** The server's default, relative to its cwd — the same place the other API writes. */
const DOCUMENT_DIR = resolve(API_DIR, '.documents');
const LOGO = readFileSync(resolve('apps/forms/public/icon-192.png'));

const sql = db();
let api: ChildProcess | null = null;
const created: string[] = [];
const jobIds: string[] = [];

async function start(): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL,
      JWT_SECRET: process.env['JWT_SECRET'] ?? 'e2e-only-secret-at-least-thirty-two-characters',
      DOCUMENT_SIGNING_SECRET:
        process.env['DOCUMENT_SIGNING_SECRET'] ?? 'e2e-only-document-secret-at-least-thirty-two',
      API_FORMS_PORT: String(PORT),
      API_FORMS_HOST: '127.0.0.1',
      APP_URL: BASE,
      DOCUMENT_DIR,
      MAIL_PROVIDER: 'console',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  api = child;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited with ${child.exitCode}:\n${output}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`API did not answer /health within 30s:\n${output}`);
}

/**
 * SIGKILL: nothing in the process gets to run — the failure a pulled plug produces. SIGTERM is
 * what `docker stop` sends, and the entry point is expected to close cleanly on it.
 */
async function stop(signal: 'SIGKILL' | 'SIGTERM' = 'SIGKILL'): Promise<number | null> {
  const child = api;
  api = null;
  if (!child || child.exitCode !== null) return child?.exitCode ?? null;
  return new Promise((done) => {
    child.once('exit', (code) => done(code));
    child.kill(signal);
  });
}

async function signIn(request: APIRequestContext): Promise<string> {
  const refreshToken = await plantRefreshToken(sql, 'admin@example.com');
  const response = await request.post(`${BASE}/v1/auth/refresh`, { data: { refreshToken } });
  expect(response.status()).toBe(200);
  return (await response.json()).accessToken as string;
}

async function waitForJob(
  request: APIRequestContext,
  token: string,
  id: string,
  timeoutMs = 60_000,
): Promise<{ status: string; result: { downloadPath?: string } | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request.get(`${BASE}/v1/jobs/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const job = await response.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`job ${id} did not finish within ${timeoutMs}ms`);
}

test.beforeAll(async () => {
  await start();
});

test.afterAll(async () => {
  await stop();
  for (const reference of created) await deleteSubmission(sql, reference);
  if (jobIds.length > 0) await sql`delete from jobs where id in ${sql(jobIds)}`;
  await sql.end();
});

test('data, a document, an asset and an in-flight job all survive a hard restart', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const form = await seededForm(sql);
  let token = await signIn(request);
  const auth = { authorization: `Bearer ${token}` };

  // 1. Data: a registration on the seeded form.
  const registered = await request.post(`${BASE}/public/forms/${form.slug}`, {
    data: {
      locale: 'sv-SE',
      values: { full_name: 'Restart Persson', email: uniqueEmail('restart'), meal: 'standard' },
    },
  });
  expect(registered.status()).toBe(201);
  const reference = (await registered.json()).reference as string;
  created.push(reference);

  // 2. An asset: bytes on disk, a path in the response.
  const uploaded = await request.post(`${BASE}/v1/uploads`, {
    headers: auth,
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: LOGO } },
  });
  expect(uploaded.status()).toBe(201);
  const assetPath = (await uploaded.json()).path as string;
  expect((await request.get(`${BASE}${assetPath}`)).status()).toBe(200);

  // 3. A generated document: the bulk admission export, through the job queue. The export is
  //    keyed on the form and its version, so an earlier run's finished job would be handed back
  //    with a link into a directory that no longer exists; start from none.
  await sql`
    delete from jobs where kind = 'admission.bulk' and payload->>'formId' = ${form.formId}
  `;
  const queued = await request.post(`${BASE}/v1/forms/${form.formId}/admission-documents`, {
    headers: auth,
  });
  expect(queued.status()).toBe(202);
  const jobId = (await queued.json()).id as string;
  jobIds.push(jobId);
  const finished = await waitForJob(request, token, jobId);
  expect(finished.status).toBe('done');
  const downloadPath = finished.result?.downloadPath;
  expect(downloadPath).toBeTruthy();
  const zip = await request.get(`${BASE}${downloadPath}`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toContain('application/zip');

  // 4. Work in flight: the same job, as the worker left it when the plug was pulled mid-run —
  //    and one that was queued and never reached.
  await sql`
    update jobs set status = 'running', started_at = now() - interval '1 hour', result = null,
      finished_at = null
    where id = ${jobId}
  `;
  const [again] = await sql`
    insert into jobs (organisation_id, kind, idempotency_key, payload, progress_total)
    select organisation_id, kind, idempotency_key || ':restart', payload, progress_total
    from jobs where id = ${jobId}
    returning id
  `;
  const queuedId = String(again!['id']);
  jobIds.push(queuedId);

  // 5. The crash, and the restart.
  await stop('SIGKILL');
  await start();
  token = await signIn(request);

  // 6. Everything is still there.
  const rows = await sql`select 1 from submissions where reference = ${reference}`;
  expect(rows).toHaveLength(1);
  expect((await request.get(`${BASE}${assetPath}`)).status()).toBe(200);
  expect((await request.get(`${BASE}${downloadPath}`)).status()).toBe(200);

  const resumed = await waitForJob(request, token, queuedId, 60_000);
  expect(resumed.status).toBe('done');
  const recovered = await waitForJob(request, token, jobId, 60_000);
  expect(recovered.status).toBe('done');
  expect((await request.get(`${BASE}${recovered.result?.downloadPath}`)).status()).toBe(200);

  // 7. And a polite stop is a clean exit. Not on Windows, where a signal to a child is always a
  //    hard kill and there is nothing to observe; CI runs on Linux.
  if (process.platform !== 'win32') {
    expect(await stop('SIGTERM')).toBe(0);
  }
});

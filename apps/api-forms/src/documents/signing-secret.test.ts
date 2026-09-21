import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { createMemoryRepositories } from '../db/repositories/memory.js';
import { createLocalDocumentStore } from './store.js';

/**
 * Two secrets, two jobs.
 *
 * The download link on a bulk export is signed with an HMAC, and the key for that HMAC used to
 * be `JWT_SECRET` verbatim — the same string that mints an administrator's access token. Whoever
 * learnt the download key learnt the session key, and rotating the session key silently killed
 * every outstanding link. The admission QR already derives its own key; this is the store
 * getting one too: `DOCUMENT_SIGNING_SECRET`, required, and refused if it equals `JWT_SECRET`.
 *
 * These build the server *without* handing it a store, so the wiring is what is under test —
 * the other document tests pass a memory store in and would not notice which secret the real
 * one was built with.
 */
const JWT = 'jwt-secret-for-this-test-at-least-thirty-two';
const DOCUMENT = 'document-secret-for-this-test-at-least-thirty-two';

let app: FastifyInstance | undefined;
let directory: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  vi.unstubAllEnvs();
});

async function serverWithRealStore(options: { documentSigningSecret?: string } = {}) {
  directory = mkdtempSync(join(tmpdir(), 'tp-documents-'));
  vi.stubEnv('DOCUMENT_DIR', directory);
  app = await buildServer({
    repos: createMemoryRepositories(),
    jwtSecret: JWT,
    probeDatabase: false,
    startWorker: false,
    ...options,
  });
  await app.ready();
  return { app, directory };
}

const expires = () => String(Math.floor(Date.now() / 1000) + 600);
const sign = (secret: string, key: string, at: string) =>
  createHmac('sha256', secret).update(`${key}:${at}`).digest('hex');

describe('the download link', () => {
  it('is not honoured when signed with the session secret', async () => {
    const { app } = await serverWithRealStore({ documentSigningSecret: DOCUMENT });
    const at = expires();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/documents/download?key=x/export.zip&expires=${at}&signature=${sign(JWT, 'x/export.zip', at)}`,
    });
    // 403, not 404: the signature is wrong before the file is ever looked for.
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('link-expired');
  });

  it('is honoured when signed with the document secret', async () => {
    const { app, directory } = await serverWithRealStore({ documentSigningSecret: DOCUMENT });
    // The same store the server built, by contract: same directory, same secret.
    const twin = createLocalDocumentStore({ directory, signingSecret: DOCUMENT });
    const stored = await twin.put('export.zip', Buffer.from('PK'));

    const response = await app.inject({ method: 'GET', url: twin.signedPath(stored.key) });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
  });
});

describe('the secret itself', () => {
  it('may not be the session secret', async () => {
    await expect(serverWithRealStore({ documentSigningSecret: JWT })).rejects.toThrow(
      /DOCUMENT_SIGNING_SECRET/,
    );
  });

  it('is required', async () => {
    vi.stubEnv('DOCUMENT_SIGNING_SECRET', '');
    await expect(serverWithRealStore()).rejects.toThrow(/DOCUMENT_SIGNING_SECRET/);
  });

  it('is read from the environment when not passed in', async () => {
    vi.stubEnv('DOCUMENT_SIGNING_SECRET', DOCUMENT);
    const { app, directory } = await serverWithRealStore();
    const twin = createLocalDocumentStore({ directory, signingSecret: DOCUMENT });
    const stored = await twin.put('export.zip', Buffer.from('PK'));
    expect((await app.inject({ method: 'GET', url: twin.signedPath(stored.key) })).statusCode).toBe(
      200,
    );
  });
});

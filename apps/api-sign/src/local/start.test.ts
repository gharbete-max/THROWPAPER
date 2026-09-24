import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../db/client.js';
import { startLocalSign, type LocalSign } from './start.js';

/**
 * Sign on the desktop: its own PGlite directory, its own per-install secrets, the same server.
 * What must hold across a restart is what signers and Forms already hold: the links and the token.
 */
const running: LocalSign[] = [];
const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tp-local-sign-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const sign of running.splice(0)) await sign.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Sign on one computer', () => {
  it('starts on loopback, keeps its secrets private, and hands one token per organisation', async () => {
    const dir = workspace();
    const sign = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    running.push(sign);
    expect(sign.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${sign.url}/health`)).status).toBe(200);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'secrets.json')).mode & 0o077).toBe(0);
    }

    const org = '11111111-1111-4111-8111-111111111111';
    const token = await sign.tokenFor(org, ['http://127.0.0.1:47017']);
    expect(await sign.tokenFor(org, ['http://127.0.0.1:47017'])).toBe(token);
    const status = await fetch(`${sign.url}/v1/envelopes/${crypto.randomUUID()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    // Authenticated (404, not 401): the token is real at Sign.
    expect(status.status).toBe(404);
  });

  it('keeps the same token and the same seal certificate across a restart', async () => {
    const dir = workspace();
    const org = '22222222-2222-4222-8222-222222222222';
    const first = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    const token = await first.tokenFor(org, ['http://127.0.0.1:47017']);
    const before = (await import('node:fs')).readFileSync(join(dir, 'secrets.json'), 'utf8');
    await first.close();

    const second = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    running.push(second);
    expect(await second.tokenFor(org, ['http://127.0.0.1:47017'])).toBe(token);
    const after = (await import('node:fs')).readFileSync(join(dir, 'secrets.json'), 'utf8');
    expect(JSON.parse(after).sealCertPem).toBe(JSON.parse(before).sealCertPem);
  });
});

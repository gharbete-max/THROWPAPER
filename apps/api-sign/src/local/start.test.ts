import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../db/client.js';
import { readableCertificate } from '../sealing/certificate.js';
import { withPaddedSerial } from '../test-certificate.js';
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

  /**
   * A workspace from before serials were kept minimal may hold a seal certificate OpenSSL cannot
   * read (one in 256), saved for good. It is replaced on the next start — only it: the link secret
   * and the callers' tokens are what signers and Forms already hold.
   */
  it('replaces a stored seal certificate OpenSSL cannot read, and keeps everything else', async () => {
    const dir = workspace();
    const path = join(dir, 'secrets.json');
    const org = '11111111-1111-4111-8111-111111111111';
    const first = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    const token = await first.tokenFor(org, ['http://127.0.0.1:47017']);
    await first.close();

    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> & {
      sealCertPem: string;
    };
    const spoiled = { ...saved, sealCertPem: withPaddedSerial(saved.sealCertPem) };
    expect(readableCertificate(spoiled.sealCertPem)).toBe(false);
    writeFileSync(path, JSON.stringify(spoiled));

    const second = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    running.push(second);
    const repaired = JSON.parse(readFileSync(path, 'utf8')) as typeof saved;
    expect(readableCertificate(repaired.sealCertPem)).toBe(true);
    expect(repaired.sealKeyPem).not.toBe(saved.sealKeyPem);
    expect(repaired['linkSecret']).toBe(saved['linkSecret']);
    expect(repaired['callers']).toEqual(saved['callers']);
    expect(await second.tokenFor(org, ['http://127.0.0.1:47017'])).toBe(token);

    // A readable certificate is left exactly as it is.
    await second.close();
    running.pop();
    const third = await startLocalSign({ dataDir: dir, migrationsFolder: MIGRATIONS, port: 0 });
    running.push(third);
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(repaired, null, 2));
  });

  it('answers only to its own loopback name, so a rebinding web page cannot drive it', async () => {
    const sign = await startLocalSign({
      dataDir: workspace(),
      migrationsFolder: MIGRATIONS,
      port: 0,
    });
    running.push(sign);
    const port = Number(new URL(sign.url).port);
    const { request } = await import('node:http');
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { host: '127.0.0.1', port, path: '/health', headers: { host } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await status(`evil.example:${port}`)).toBe(421);
    expect(await status(`127.0.0.1:${port}`)).toBe(200);
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

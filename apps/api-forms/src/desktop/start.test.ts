import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { browserChoices, mailProviderFor, startDesktopServer } from './start.js';
import { defaultSettings, readSettings, writeSettings } from './settings.js';
import { loadOrCreateSecrets, workspacePaths } from './workspace.js';
import type { PdfRenderer } from '../documents/render.js';

const migrationsFolder = join(import.meta.dirname, '..', '..', 'drizzle');
const scratch = await mkdtemp(join(tmpdir(), 'loppa-desktop-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** No Chromium in a unit test; the PDF path has its own tests. */
const fakeRenderer: PdfRenderer = {
  render: async () => Buffer.from('%PDF-fake'),
  renderPages: async () => Buffer.from('%PDF-fake'),
  close: async () => {},
};

async function webDir(): Promise<string> {
  const dir = join(scratch, 'web');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'index.html'),
    '<!doctype html><title>Loppa</title><div id="root"></div>',
  );
  return dir;
}

describe('the desktop server', { timeout: 60_000 }, () => {
  it('boots on 127.0.0.1 from an empty folder, sets up, and signs in through the real exchange', async () => {
    const dataDir = join(scratch, 'first-run');
    const server = await startDesktopServer({
      dataDir,
      webDir: await webDir(),
      migrationsFolder,
      port: 0,
      renderer: fakeRenderer,
    });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const health = await fetch(`${server.url}/health`);
      expect(health.status).toBe(200);

      // First run: nobody to sign in as, and the shell shows its set-up screen instead.
      expect(await server.isSetUp()).toBe(false);
      expect(await server.signInLink()).toBeNull();

      expect(
        await server.bootstrap({
          organisationName: 'Byalaget Östra',
          name: 'Åke',
          email: 'ake@example.com',
        }),
      ).toBe(true);
      expect(await server.loadDemo()).toBe(false);

      const link = await server.signInLink();
      const token = new URL(link!).searchParams.get('token');
      const exchanged = await fetch(`${server.url}/v1/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(exchanged.status).toBe(200);
      const session = (await exchanged.json()) as { user: { email: string } };
      expect(session.user.email).toBe('ake@example.com');

      // The built app is served by the same process: one origin, no second server.
      const page = await fetch(`${server.url}/app`);
      expect(await page.text()).toContain('<div id="root">');

      // Everything the user owns is under one folder.
      expect((await readdir(dataDir)).sort()).toEqual(
        ['database', 'documents', 'outbox', 'secrets.json'].sort(),
      );
    } finally {
      await server.close();
    }
  });

  it('keeps its secrets across restarts, so sessions and download links survive them', async () => {
    const path = join(scratch, 'secrets.json');
    const first = await loadOrCreateSecrets(path);
    const second = await loadOrCreateSecrets(path);
    expect(second).toEqual(first);
    expect(first.jwtSecret).not.toBe(first.documentSigningSecret);
    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('desktop settings', () => {
  it('defaults to test-mode mail, AI off and local signing', () => {
    const settings = defaultSettings();
    expect(settings.mail.mode).toBe('outbox');
    expect(settings.ai.mode).toBe('off');
    expect(settings.signing.mode).toBe('local');
  });

  it('round-trips through the file, and refuses a file it cannot read rather than resetting it', async () => {
    const path = join(scratch, 'settings.json');
    await writeSettings(path, {
      ai: { mode: 'cloud' },
      signing: { mode: 'online', endpoint: 'https://sign.example.com' },
    });
    const read = await readSettings(path);
    expect(read.ai.mode).toBe('cloud');
    expect(read.signing.endpoint).toBe('https://sign.example.com');

    await writeFile(path, '{"ai":{"mode":"telepathy"}}');
    await expect(readSettings(path)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toContain('telepathy');
  });

  it('sends nothing when SMTP is chosen but never filled in', () => {
    const paths = workspacePaths(scratch);
    const settings = defaultSettings();
    settings.mail.mode = 'smtp';
    expect(mailProviderFor(settings, paths).name).toBe('outbox');

    settings.mail.smtp = { host: 'smtp.example.com', port: 587, secure: false };
    expect(mailProviderFor(settings, paths).name).toBe('smtp');
  });

  it('asks for Edge first, and an explicit browser path beats every channel', () => {
    expect(browserChoices(defaultSettings())[0]).toEqual({ channel: 'msedge' });
    const settings = { ...defaultSettings(), pdfBrowserPath: 'C:\\Chromium\\chrome.exe' };
    expect(browserChoices(settings)).toEqual([{ executablePath: 'C:\\Chromium\\chrome.exe' }]);
  });
});

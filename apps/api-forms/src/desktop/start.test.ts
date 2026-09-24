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
        ['database', 'documents', 'outbox', 'secrets.json', 'tmp'].sort(),
      );
    } finally {
      await server.close();
    }
  });

  it('lets a phone reach the scan page, and nothing else, only while a scan is open', async () => {
    const server = await startDesktopServer({
      dataDir: join(scratch, 'phone'),
      webDir: await webDir(),
      migrationsFolder,
      port: 0,
      renderer: fakeRenderer,
      // Loopback stands in for the Wi-Fi address this container may not have.
      phoneAddress: () => '127.0.0.1',
    });
    try {
      await server.bootstrap({
        organisationName: 'Skanna AB',
        name: 'Siv',
        email: 'siv@example.com',
      });
      const token = new URL((await server.signInLink())!).searchParams.get('token');
      const { accessToken } = (await (
        await fetch(`${server.url}/v1/auth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
      ).json()) as { accessToken: string };

      const opened = await fetch(`${server.url}/v1/phone-scans`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(opened.status).toBe(201);
      const { phoneUrl } = (await opened.json()) as { phoneUrl: string };
      const relay = new URL(phoneUrl);
      // Not the app's own port: the relay's.
      expect(relay.origin).not.toBe(server.url);

      // The phone gets the app's page, and the scan's own endpoint…
      expect(await (await fetch(phoneUrl)).text()).toContain('<div id="root">');
      const status = await fetch(
        `${relay.origin}/api/v1/phone-scan${relay.pathname.slice('/phone-scan'.length)}`,
      );
      expect(status.status).toBe(200);
      // …and nothing else, even carrying a valid session.
      for (const path of ['/', '/health', '/api/v1/forms', '/v1/forms', '/api/v1/auth/me']) {
        const other = await fetch(`${relay.origin}${path}`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(other.status, path).toBe(404);
      }
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

  it('hands mail to Outlook when that is chosen, on the platforms that have it', () => {
    const paths = workspacePaths(scratch);
    const settings = defaultSettings();
    settings.mail.mode = 'outlook';
    expect(mailProviderFor(settings, paths, undefined, 'win32').name).toBe('outlook');
    expect(mailProviderFor(settings, paths, undefined, 'darwin').name).toBe('outlook');

    settings.mail.mode = 'apple-mail';
    expect(mailProviderFor(settings, paths, undefined, 'darwin').name).toBe('apple-mail');
    // A Mac setting restored onto Windows: test mode, not a program that will not start.
    expect(mailProviderFor(settings, paths, undefined, 'win32').name).toBe('outbox');
  });

  it('asks for Edge first, and an explicit browser path beats every channel', () => {
    expect(browserChoices(defaultSettings())[0]).toEqual({ channel: 'msedge' });
    const settings = { ...defaultSettings(), pdfBrowserPath: 'C:\\Chromium\\chrome.exe' };
    expect(browserChoices(settings)).toEqual([{ executablePath: 'C:\\Chromium\\chrome.exe' }]);
  });
});

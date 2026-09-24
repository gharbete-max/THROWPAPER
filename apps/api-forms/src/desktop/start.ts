import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { openLocalDatabase, type LocalDatabase } from '../db/pglite.js';
import { seedDemo } from '../db/seed-demo.js';
import { createLocalDocumentStore } from '../documents/store.js';
import { createLocalAssetStore } from '../uploads/store.js';
import { createLocalUploadStore } from '../uploads/private-store.js';
import { createPdfRenderer, type BrowserChoice, type PdfRenderer } from '../documents/render.js';
import type { MailProvider } from '../mail/provider.js';
import { createOutboxMailProvider, createSmtpMailProvider } from '../mail/smtp.js';
import { createMailProgramProvider } from '../mail/outlook.js';
import { readSettings, type DesktopSettings } from './settings.js';
import type { SignConnection } from '../signing/client.js';
import {
  bootstrapWorkspace,
  ensureWorkspace,
  loadOrCreateSecrets,
  mintLocalSignInLink,
  workspacePaths,
  type WorkspaceOwner,
  type WorkspacePaths,
} from './workspace.js';

/**
 * The desktop edition's server: the whole Forms product, on this machine, for this person.
 *
 * It is `buildServer` — the function the container and the tests call — with local parts plugged
 * into the seams that already exist: repositories on an embedded Postgres, documents and uploads
 * in the data folder, mail to an outbox or the user's own SMTP server, PDFs through the Chromium
 * the operating system already has. Nothing here forks a route.
 *
 * Listens on **127.0.0.1 only**. A public form served from somebody's laptop to the internet is a
 * hosting decision this edition does not make on their behalf (ADR 0016, "Not in D1").
 */
export interface StartDesktopOptions {
  /** The data folder. `%APPDATA%\\Loppa` from the shell; anywhere from a test. */
  dataDir: string;
  /** The built `apps/forms` bundle (`dist/`), served by this same server. */
  webDir: string;
  /** The SQL migrations, shipped beside the bundle. */
  migrationsFolder: string;
  /** Overrides the port from settings — the tests use 0 to take any free port. */
  port?: number;
  /** Turns an encrypted SMTP password back into text. Supplied by the Electron shell. */
  unprotect?: (protectedValue: string) => string;
  /** Injected by tests, and used whatever the settings say. */
  renderer?: PdfRenderer;
  /**
   * The renderer to use unless Settings names a browser. The Electron shell passes one that
   * prints with its own Chromium; without it (headless, any OS) the fallback is Edge → Chrome →
   * Playwright's own, through Playwright.
   */
  defaultRenderer?: PdfRenderer;
  /**
   * Where this workspace sends documents for signing: the shell's local Sign (CONTRACT §5 over
   * loopback). Asked once the workspace has an organisation, because a service token belongs to
   * one; `origin` is this server's, which Sign must allow to fetch documents from and post hooks
   * to. Absent, or answering null, the Signing screen says signing is not set up.
   */
  signing?: (organisationId: string, origin: string) => Promise<SignConnection | null>;
}

export interface DesktopServer {
  url: string;
  paths: WorkspacePaths;
  settings: DesktopSettings;
  app: FastifyInstance;
  /** Whether an organisation exists yet. False on first run, until `bootstrap` or `loadDemo`. */
  isSetUp(): Promise<boolean>;
  bootstrap(owner: WorkspaceOwner): Promise<boolean>;
  /** The demo dataset from `pnpm db:seed`, into this workspace. Only ever on an empty one. */
  loadDemo(): Promise<boolean>;
  signInLink(): Promise<string | null>;
  /** Whether this start found an organisation and connected it to Sign. */
  signingConnected: boolean;
  close(): Promise<void>;
}

export function mailProviderFor(
  settings: DesktopSettings,
  paths: WorkspacePaths,
  unprotect?: (value: string) => string,
  platform: NodeJS.Platform = process.platform,
): MailProvider {
  const { mail } = settings;
  if (mail.mode === 'smtp' && mail.smtp) {
    const { smtp } = mail;
    return createSmtpMailProvider({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user ? { user: smtp.user } : {}),
      ...(smtp.passwordProtected && unprotect
        ? { password: unprotect(smtp.passwordProtected) }
        : {}),
      from: mail.from,
    });
  }
  if (mail.mode === 'outlook' || mail.mode === 'apple-mail') {
    try {
      return createMailProgramProvider({ program: mail.mode, platform, scratchDir: paths.tmp });
    } catch {
      /*
       * A mail program this machine cannot drive — Apple Mail in a backup restored onto Windows,
       * say. Refusing to start would lock the user out of their own data over a mail setting;
       * test mode sends nothing, which is the one safe way to be wrong.
       */
    }
  }
  // Test mode is the default and the fallback: `smtp` chosen but never filled in sends nothing.
  return createOutboxMailProvider({ directory: paths.outbox, from: mail.from });
}

/**
 * Edge first, because every supported Windows has it; then Chrome; then Playwright's own.
 * An explicit path from settings beats all three.
 */
export function browserChoices(settings: DesktopSettings): BrowserChoice[] {
  if (settings.pdfBrowserPath) return [{ executablePath: settings.pdfBrowserPath }];
  return [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
}

/** A renderer that tries each browser in turn and remembers the first that launches. */
export function fallbackRenderer(choices: BrowserChoice[]): PdfRenderer {
  let chosen: PdfRenderer | null = null;

  async function withRenderer<T>(use: (renderer: PdfRenderer) => Promise<T>): Promise<T> {
    if (chosen) return use(chosen);
    const failures: string[] = [];
    for (const choice of choices) {
      const candidate = createPdfRenderer(undefined, choice);
      try {
        const result = await use(candidate);
        chosen = candidate;
        return result;
      } catch (error) {
        await candidate.close().catch(() => {});
        const message = (error as Error).message;
        // Only a browser that would not start moves on; a failure inside a render is real.
        if (!/Executable doesn't exist|is not found|Failed to launch|ENOENT/i.test(message)) {
          throw error;
        }
        failures.push(
          `${choice.channel ?? choice.executablePath ?? 'bundled'}: ${message.split('\n')[0]}`,
        );
      }
    }
    throw new Error(
      `No browser to render PDFs with. Install Microsoft Edge or Google Chrome, or set a browser path in Settings.\n${failures.join('\n')}`,
    );
  }

  return {
    render: (html, options) => withRenderer((renderer) => renderer.render(html, options)),
    renderPages: (html) => withRenderer((renderer) => renderer.renderPages(html)),
    close: async () => {
      await chosen?.close();
      chosen = null;
    },
  };
}

export async function startDesktopServer(options: StartDesktopOptions): Promise<DesktopServer> {
  const paths = workspacePaths(options.dataDir);
  await ensureWorkspace(paths);

  const settings = await readSettings(paths.settings);
  const secrets = await loadOrCreateSecrets(paths.secrets);
  const port = options.port ?? settings.port;

  const local: LocalDatabase = await openLocalDatabase({
    dataDir: paths.database,
    migrationsFolder: options.migrationsFolder,
  });

  // Port 0 is resolved only after listening, so the URL is built twice: once to configure, once
  // to report. With a fixed port — the shell's case — the two are the same string.
  let url = `http://127.0.0.1:${port}`;
  const organisation = await local.repos.organisations.first();
  let signing: SignConnection | null = null;
  try {
    signing = organisation && options.signing ? await options.signing(organisation.id, url) : null;
  } catch (error) {
    await local.close();
    throw error;
  }
  let app: FastifyInstance;
  try {
    app = await buildServer({
      repos: local.repos,
      mail: mailProviderFor(settings, paths, options.unprotect),
      store: createLocalDocumentStore({
        directory: paths.documents,
        signingSecret: secrets.documentSigningSecret,
      }),
      assets: createLocalAssetStore({ directory: paths.assets }),
      uploadStore: createLocalUploadStore(paths.uploads),
      renderer:
        options.renderer ??
        (settings.pdfBrowserPath ? undefined : options.defaultRenderer) ??
        fallbackRenderer(browserChoices(settings)),
      jwtSecret: secrets.jwtSecret,
      documentSigningSecret: secrets.documentSigningSecret,
      appUrl: url,
      serveAppFrom: options.webDir,
      probeDatabase: false,
      startWorker: true,
      signing,
    });
    await app.listen({ port, host: '127.0.0.1' });
  } catch (error) {
    await local.close();
    throw error;
  }
  const address = app.server.address();
  if (address && typeof address === 'object') url = `http://127.0.0.1:${address.port}`;

  async function isSetUp(): Promise<boolean> {
    return (await local.repos.organisations.first()) !== null;
  }

  return {
    url,
    paths,
    settings,
    app,
    isSetUp,
    bootstrap: (owner) => bootstrapWorkspace(local.db, owner),
    async loadDemo() {
      if (await isSetUp()) return false;
      await seedDemo(local.db);
      return true;
    },
    signInLink: () => mintLocalSignInLink(local.repos, url),
    signingConnected: signing !== null,
    async close() {
      await app.close();
      await local.close();
    },
  };
}

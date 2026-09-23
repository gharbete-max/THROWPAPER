/**
 * Loppa for Windows — the Electron main process (ADR 0016).
 *
 * One process holds everything: Electron's window, and inside the same Node the Forms API on an
 * embedded Postgres, bound to 127.0.0.1. The main window is simply the Forms web app pointed at
 * that address — no second UI, no bridge into it. The shell adds only what a web app cannot do for
 * itself: a first-run screen, settings that live on this machine, "open the data folder", backup,
 * and the OS password store for an SMTP password.
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  WorkspaceOwner,
  readSettings,
  startDesktopServer,
  workspacePaths,
  writeSettings,
  type DesktopServer,
} from '@tp/api-forms/desktop';
import { CHANNELS, type PanelView, type Result, type SettingsForm } from '../bridge.js';
import { fill, messagesFor } from '../messages.js';
import { createElectronPdfRenderer } from './pdf.js';
import { applySettingsForm, toPanelSettings } from './settings-form.js';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Packaged, the web bundle, migrations and panel are `extraResources` — plain folders beside the
 * asar, because the server streams files from them and the migrator reads them at every start.
 * Unpackaged (`pnpm --filter @tp/desktop start`), they sit beside this file in `.stage/`.
 */
const resources = app.isPackaged ? process.resourcesPath : here;
/**
 * The workspace is a folder *inside* userData rather than userData itself, because Electron keeps
 * its own browser profile there — caches, GPU state — and a backup should be the user's data only.
 */
const dataDir = join(app.getPath('userData'), 'workspace');

const { lang, t } = messagesFor([app.getLocale(), ...app.getPreferredSystemLanguages()]);

let server: DesktopServer | null = null;
let mainWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;

function protect(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating system password store is not available on this machine.');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

function unprotect(value: string): string {
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

async function startServer(): Promise<DesktopServer> {
  return startDesktopServer({
    dataDir,
    webDir: join(resources, 'web'),
    migrationsFolder: join(resources, 'drizzle'),
    unprotect,
    // PDFs from Electron's own Chromium: no Edge or Chrome needed, which on a Mac there usually
    // is not. A browser path in Settings still wins.
    defaultRenderer: createElectronPdfRenderer({
      BrowserWindow,
      scratchDir: join(dataDir, 'tmp'),
    }),
  });
}

async function restartServer(): Promise<void> {
  await server?.close();
  server = await startServer();
  // Secrets persist, so the session in the window is still valid: a reload is enough.
  mainWindow?.webContents.reload();
}

function isOurs(url: string): boolean {
  return server !== null && url.startsWith(`${server.url}/`);
}

async function openMainWindow(): Promise<void> {
  if (!server) return;
  const link = await server.signInLink();
  if (!link) return openPanel('setup');

  if (mainWindow) {
    await mainWindow.loadURL(link);
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: t.appName,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links out of the product — a help page, a sender's website — go to the user's browser. Our
  // own pages that ask for a new window (a public form preview, a PDF) open in one of ours.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOurs(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(link);
}

async function openPanel(view: PanelView): Promise<void> {
  if (panelWindow) {
    await panelWindow.loadFile(join(resources, 'panel', 'index.html'), { query: { view } });
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 640,
    height: view === 'setup' ? 640 : 860,
    title: view === 'setup' ? t.setupTitle : t.settingsTitle,
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
    // Closing first-run without choosing leaves nothing to show; quitting is the honest answer.
    if (!mainWindow) app.quit();
  });
  await panelWindow.loadFile(join(resources, 'panel', 'index.html'), { query: { view } });
}

async function backUp(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: t.menuBackup,
    defaultPath: join(app.getPath('documents'), `Loppa-backup-${stamp}`),
  });
  if (canceled || !filePath) return;
  try {
    // Stopped first: PGlite's files are only consistent at rest, and a copy taken mid-write is
    // a backup that restores to a corrupt database.
    await server?.close();
    server = null;
    await mkdir(filePath, { recursive: true });
    await cp(dataDir, filePath, { recursive: true });
    await dialog.showMessageBox({ message: fill(t.backupDone, { path: filePath }) });
  } catch (error) {
    dialog.showErrorBox(t.menuBackup, fill(t.backupFailed, { message: (error as Error).message }));
  } finally {
    await restartServer();
  }
}

function buildMenu(): void {
  const paths = workspacePaths(dataDir);
  const template: MenuItemConstructorOptions[] = [
    // macOS puts the application's own menu first (About, Hide, Quit); Electron localises it.
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: t.menuFile,
      submenu: [
        {
          label: t.menuSettings,
          accelerator: 'CmdOrCtrl+,',
          click: () => void openPanel('settings'),
        },
        { type: 'separator' },
        { label: t.menuOpenData, click: () => void shell.openPath(paths.root) },
        { label: t.menuOpenOutbox, click: () => void shell.openPath(paths.outbox) },
        { label: t.menuBackup, click: () => void backUp() },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' } as const, { label: t.menuQuit, role: 'quit' } as const]),
      ],
    },
    /*
     * Cut, copy, paste and undo. On a Mac these shortcuts live in the Edit menu, and without one
     * ⌘C and ⌘V do nothing in any text field — the whole form builder included.
     */
    { role: 'editMenu' },
    {
      label: t.menuView,
      submenu: [
        { label: t.menuReload, role: 'reload' },
        { label: t.menuSignInAgain, click: () => void openMainWindow() },
        {
          label: t.menuOpenInBrowser,
          click: async () => {
            const link = await server?.signInLink();
            if (link) void shell.openExternal(link);
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * First run is over: the main window opens, *then* the setup window goes. The other order closes
 * the last window while none other exists yet, and the panel's own `closed` handler quits the app.
 */
async function replacePanelWithMain(): Promise<void> {
  await openMainWindow();
  panelWindow?.destroy();
  panelWindow = null;
}

function registerIpc(): void {
  const fail = (error: unknown): Result => ({ ok: false, error: (error as Error).message });

  ipcMain.handle(CHANNELS.state, async (event) => {
    const view =
      new URL(event.sender.getURL()).searchParams.get('view') === 'setup' ? 'setup' : 'settings';
    const settings = await readSettings(workspacePaths(dataDir).settings);
    return {
      view,
      platform: process.platform,
      lang,
      dataDir,
      settings: toPanelSettings(settings),
    };
  });

  ipcMain.handle(CHANNELS.bootstrap, async (_event, owner: unknown): Promise<Result> => {
    try {
      const parsed = WorkspaceOwner.parse({ ...(owner as object), locale: lang });
      if (!server || !(await server.bootstrap(parsed)))
        return { ok: false, error: 'already-set-up' };
      await replacePanelWithMain();
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.loadDemo, async (): Promise<Result> => {
    try {
      if (!server || !(await server.loadDemo())) return { ok: false, error: 'already-set-up' };
      await replacePanelWithMain();
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.saveSettings, async (_event, form: SettingsForm): Promise<Result> => {
    try {
      const paths = workspacePaths(dataDir);
      const applied = applySettingsForm(await readSettings(paths.settings), form, protect);
      if (!applied.ok) return applied;
      await writeSettings(paths.settings, applied.settings);
      await restartServer();
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.on(CHANNELS.closePanel, () => panelWindow?.close());
}

/**
 * The camera (QR at the door, photographing a paper form) is the one device permission the
 * product uses. Granted to our own origin, refused to anything else.
 */
function limitPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isOurs(webContents.getURL()));
  });
}

if (!app.requestSingleInstanceLock()) {
  // Two processes on one PGlite directory would corrupt it; the second one just hands over.
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = mainWindow ?? panelWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    void server?.close();
  });

  void app.whenReady().then(async () => {
    try {
      buildMenu();
      registerIpc();
      limitPermissions();
      server = await startServer();
      if (await server.isSetUp()) await openMainWindow();
      else await openPanel('setup');
    } catch (error) {
      dialog.showErrorBox(t.startFailed, (error as Error).stack ?? String(error));
      app.exit(1);
    }
  });
}

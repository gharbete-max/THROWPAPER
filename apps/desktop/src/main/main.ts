/**
 * Loppa for Windows — the Electron main process (ADR 0016).
 *
 * One process holds everything: Electron's window, and inside the same Node the Forms API on an
 * embedded Postgres, bound to 127.0.0.1. The main window is simply the Forms web app pointed at
 * that address — no second UI, no bridge into it. The shell adds only what a web app cannot do for
 * itself: a first-run screen, settings that live on this machine, "open the data folder", backup,
 * and the OS password store for an SMTP password.
 */
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  KEYS_FILE,
  KeysError,
  MIN_PASSPHRASE,
  backupFilter,
  openKeys,
  readKeyFiles,
  sealKeys,
  writeKeyFiles,
} from './backup.js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  workspacePaths,
  writeSettings,
  type DesktopServer,
} from '@tp/api-forms/desktop';
import type { LocalSign } from '@tp/api-sign/local';
import { startForms, startSign } from './host.js';
import {
  CHANNELS,
  type KeysForm,
  type PanelView,
  type Result,
  type SettingsForm,
} from '../bridge.js';
import { fill, messagesFor } from '../messages.js';
import { registerAiIpc } from '../ai/ai-ipc.js';
import { registerAddonsIpc } from '../addons/addons-ipc.js';
import { ADDONS_CHANNELS, AI_CHANNELS, MODEL_CHANNELS } from '../ai/channels.js';
import { registerModelIpc } from '../ai/model-ipc.js';
import { createShellAi } from '../ai/shell.js';
import { closeAll, createLock } from './lifecycle.js';
import { createElectronPdfRenderer } from './pdf.js';
import { applySettingsForm, toPanelSettings } from './settings-form.js';
import {
  classifyNavigation,
  classifyOpen,
  externalAllowed,
  permissionAllowed,
} from './navigation.js';

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

/**
 * The AI coordinator (ADR 0024, amending ADR 0023): the one model, run by a `llama-server` process of its own, started only when a
 * job is asked for, and a narrow IPC to the Forms window. Nothing here runs at start-up.
 */
const {
  coordinator: ai,
  model,
  addons,
} = createShellAi({
  chooseFile: async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: t.menuOpenModel,
      properties: ['openFile'],
      filters: [
        { name: 'GGUF, PACK.json', extensions: ['gguf', 'json', 'part1'] },
        { name: '*', extensions: ['*'] },
      ],
    });
    return canceled ? null : (filePaths[0] ?? null);
  },
  userData: app.getPath('userData'),
  resources,
  // A checkout's own model folders are looked in by development builds only (docs/plan/AI-SYSTEM.md D7).
  repoRoot: app.isPackaged ? null : join(here, '..', '..', '..'),
  emit: (event) => sendToMain(AI_CHANNELS.event, event),
  emitLegacy: (event) => sendToMain(MODEL_CHANNELS.event, event),
  addons: {
    version: app.getVersion(),
    // electron-builder's portable program sets this while it runs.
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    downloads: app.getPath('downloads'),
    // A person pressed "Open the installer": the system opens it as a double-click would.
    openPath: (path) => shell.openPath(path),
    emit: (event) => sendToMain(ADDONS_CHANNELS.event, event),
  },
  env: process.env,
});

/** A window that is closing or gone has nobody to tell: `send` on a destroyed one throws. */
function sendToMain(channel: string, payload: unknown): void {
  const window = mainWindow;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}

/** Stopping and starting the servers happens one operation at a time (`lifecycle.ts`). */
const exclusive = createLock();

let server: DesktopServer | null = null;
/**
 * Loppa Sign, on this machine (ADR 0016, "the shell hosts products side by side"). Its own
 * PGlite directory inside the workspace — so a backup carries it — and its own loopback port.
 * Forms reaches it only over CONTRACT §5 with a service token, as it would a Sign online; this
 * shell is the one place that knows both are here.
 */
let sign: LocalSign | null = null;
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
  const settings = await readSettings(workspacePaths(dataDir).settings);
  if (settings.signing.mode === 'local') sign ??= await startSign(dataDir, { root: resources });
  return startForms(sign, {
    dataDir,
    webDir: join(resources, 'web'),
    migrationsFolder: join(resources, 'drizzle'),
    unprotect,
    // PDFs from Electron's own Chromium: no Edge or Chrome needed, which on a Mac there usually
    // is not. A browser path in Settings still wins.
    defaultRenderer: createElectronPdfRenderer({
      BrowserWindow,
      scratchDir: join(dataDir, 'tmp'),
      // Its own session, where nothing but the page being printed may load (`pdf.ts`).
      session: session.fromPartition('loppa-pdf-render'),
    }),
  });
}

/** Inside an `exclusive` operation: the others wait. */
async function restartNow(): Promise<void> {
  const old = server;
  server = null; // while it restarts nothing is answered, and a failed start leaves no closed server behind
  await old?.close();
  const settings = await readSettings(workspacePaths(dataDir).settings);
  if (settings.signing.mode !== 'local') {
    await sign?.close();
    sign = null;
  }
  server = await startServer();
  // Secrets persist, so the session in the window is still valid: a reload is enough.
  mainWindow?.webContents.reload();
}

/** Our two loopback origins: Forms, and Sign beside it (signing at this computer is offline). */
function ourOrigins(): string[] {
  return [server?.url, sign?.url].filter((url): url is string => typeof url === 'string');
}

/** The settings panel's own page. Only it may use the bridge. */
const panelUrl = pathToFileURL(join(resources, 'panel', 'index.html')).href;

function fromPanel(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === panelUrl || url.startsWith(`${panelUrl}?`);
}

function openOutside(url: string): void {
  if (externalAllowed(url)) void shell.openExternal(url);
}

/**
 * The same rules for every window the app ever has — the main window, a form preview it opens, the
 * PDF a page opens, the settings panel (`navigation.ts`). Attached here rather than to one window,
 * because a rule on one window is no rule on the window it opens.
 */
function guardEveryWindow(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const opening = classifyOpen(url, ourOrigins());
      if (opening.action === 'window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false,
              // Chromium's PDF viewer, for the finished document's "Open"; nothing else needs it.
              plugins: opening.pdfViewer,
            },
          },
        };
      }
      if (opening.action === 'external') openOutside(url);
      return { action: 'deny' };
    });
    // A redirect is a navigation too, and `will-navigate` does not see one the server sends.
    const judge = (event: { preventDefault(): void }, url: string) => {
      const verdict = classifyNavigation(contents.getURL(), url, ourOrigins());
      if (verdict === 'allow') return;
      event.preventDefault();
      if (verdict === 'external') openOutside(url);
    };
    contents.on('will-navigate', (event, url) => judge(event, url));
    contents.on('will-redirect', (event, url) => judge(event, url));
  });
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
    webPreferences: {
      // `window.loppaAi` and `window.loppaModel`, for the AI panes and nothing else (`ai/preload.ts`).
      preload: join(here, 'model-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links out of the product go to the user's browser; our own pages that ask for a new window (a
  // form preview, a PDF) open in one of ours. The rules are `guardEveryWindow`'s, for every window.
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
    height: view === 'setup' ? 640 : view === 'settings' ? 860 : 480,
    title:
      view === 'setup'
        ? t.setupTitle
        : view === 'backupKeys'
          ? t.keysBackupTitle
          : view === 'restoreKeys'
            ? t.keysRestoreTitle
            : t.settingsTitle,
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

/** Writes the data folder to a place the person chooses; with a passphrase, the keys go beside it as keys.enc. */
async function backUp(passphrase?: string): Promise<Result> {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: t.menuBackup,
    defaultPath: join(app.getPath('documents'), `Loppa-backup-${stamp}`),
  });
  if (canceled || !filePath) return { ok: false, error: '' };
  // The servers are stopped for the copy and started again, all inside one exclusive operation: a
  // settings save or another backup that restarted them in the middle would copy a database in use.
  const outcome = await exclusive(async (): Promise<Result> => {
    try {
      // Stopped first: PGlite's files are only consistent at rest, and a copy taken mid-write is
      // a backup that restores to a corrupt database.
      const old = server;
      server = null;
      await old?.close();
      await sign?.close();
      sign = null;
      await mkdir(filePath, { recursive: true });
      await cp(dataDir, filePath, { recursive: true, filter: backupFilter() });
      if (passphrase) {
        await writeFile(
          join(filePath, KEYS_FILE),
          sealKeys(await readKeyFiles(dataDir), passphrase),
          {
            mode: 0o600,
          },
        );
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: fill(t.backupFailed, { message: (error as Error).message }) };
    } finally {
      await restartNow().catch((error: unknown) =>
        dialog.showErrorBox(t.startFailed, (error as Error).stack ?? String(error)),
      );
    }
  });
  if (outcome.ok) {
    await dialog.showMessageBox({
      message: fill(passphrase ? t.backupKeysDone : t.backupDone, { path: filePath }),
    });
  } else {
    dialog.showErrorBox(t.menuBackup, outcome.error);
  }
  return outcome;
}

/**
 * Puts the keys of a `keys.enc` back. Decrypted first, so a wrong passphrase ends here with nothing
 * written; then a confirmation; then the servers stop, the files are written and the servers start.
 */
async function restoreKeys(passphrase: string): Promise<Result> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: t.keysPickTitle,
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: KEYS_FILE, extensions: ['enc'] }],
  });
  const file = filePaths[0];
  if (canceled || !file) return { ok: false, error: '' };
  let files;
  try {
    files = openKeys(await readFile(file), passphrase);
  } catch (error) {
    if (error instanceof KeysError) {
      return { ok: false, error: error.code === 'unreadable' ? t.keysUnreadable : t.keysWrong };
    }
    return { ok: false, error: t.keysUnreadable };
  }
  if (Object.keys(files).length === 0) return { ok: false, error: t.keysEmpty };
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: fill(t.keysRestoreConfirm, { file }),
    buttons: [t.keysRestoreNo, t.keysRestoreYes],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { ok: false, error: '' };
  const outcome = await exclusive(async (): Promise<Result> => {
    try {
      const old = server;
      server = null;
      await old?.close();
      await sign?.close();
      sign = null;
      await writeKeyFiles(dataDir, files);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    } finally {
      await restartNow().catch((error: unknown) =>
        dialog.showErrorBox(t.startFailed, (error as Error).stack ?? String(error)),
      );
    }
  });
  if (outcome.ok) await dialog.showMessageBox({ message: t.keysRestoreDone });
  return outcome;
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
        { label: t.menuBackupKeys, click: () => void openPanel('backupKeys') },
        { label: t.menuRestoreKeys, click: () => void openPanel('restoreKeys') },
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
            if (link) openOutside(link);
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
  // The AI bridge answers Forms' own origin only, not Sign's beside it (ADR 0023, ADR 0024).
  const formsOnly = () => (server ? [server.url] : []);
  registerModelIpc(ipcMain, model, formsOnly);
  registerAiIpc(ipcMain, ai, formsOnly);
  registerAddonsIpc(ipcMain, addons, formsOnly);
  const fail = (error: unknown): Result => ({ ok: false, error: (error as Error).message });
  const refused: Result = { ok: false, error: 'not-the-panel' };

  ipcMain.handle(CHANNELS.state, async (event) => {
    // The bridge answers the settings panel and nothing else — not a page that got into a window.
    if (!fromPanel(event)) throw new Error('not-the-panel');
    const asked = new URL(event.sender.getURL()).searchParams.get('view');
    const view: PanelView =
      asked === 'setup' || asked === 'backupKeys' || asked === 'restoreKeys' ? asked : 'settings';
    const settings = await readSettings(workspacePaths(dataDir).settings);
    return {
      view,
      platform: process.platform,
      lang,
      dataDir,
      settings: toPanelSettings(settings),
    };
  });

  ipcMain.handle(CHANNELS.bootstrap, async (event, owner: unknown): Promise<Result> => {
    if (!fromPanel(event)) return refused;
    try {
      const parsed = WorkspaceOwner.parse({ ...(owner as object), locale: lang });
      const done = await exclusive(async () => {
        if (!server || !(await server.bootstrap(parsed))) return false;
        // Now there is an organisation, Forms can be given its Sign token.
        await restartNow();
        return true;
      });
      if (!done) return { ok: false, error: 'already-set-up' };
      await replacePanelWithMain();
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.saveSettings, async (event, form: SettingsForm): Promise<Result> => {
    if (!fromPanel(event)) return refused;
    try {
      // Read, change, write and restart as one operation: two saves must not both start from the old file.
      return await exclusive(async (): Promise<Result> => {
        const paths = workspacePaths(dataDir);
        const applied = applySettingsForm(await readSettings(paths.settings), form, protect);
        if (!applied.ok) return applied;
        await writeSettings(paths.settings, applied.settings);
        await restartNow();
        return { ok: true };
      });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(CHANNELS.keys, async (event, form: KeysForm): Promise<Result> => {
    if (!fromPanel(event)) return refused;
    const view = new URL(event.sender.getURL()).searchParams.get('view');
    const passphrase = String(form?.passphrase ?? '');
    try {
      if (view === 'restoreKeys') return await restoreKeys(passphrase);
      if (view !== 'backupKeys') return refused;
      if (passphrase.length < MIN_PASSPHRASE) {
        return { ok: false, error: fill(t.keysTooShort, { min: String(MIN_PASSPHRASE) }) };
      }
      if (passphrase !== String(form.again ?? '')) return { ok: false, error: t.keysNoMatch };
      if (Object.keys(await readKeyFiles(dataDir)).length === 0) {
        return { ok: false, error: t.keysNothing };
      }
      return await backUp(passphrase);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.on(CHANNELS.closePanel, (event) => {
    if (fromPanel(event)) panelWindow?.close();
  });
}

/**
 * The camera (QR at the door, photographing a paper form) is the one device permission the
 * product uses: video only, for the frame of ours that asked — plus writing to the clipboard
 * (`navigation.ts`). The check handler
 * answers the same way, so a page cannot learn a permission is granted that it could not request.
 */
function limitPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : [];
    callback(permissionAllowed(permission, details.requestingUrl, mediaTypes ?? [], ourOrigins()));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, undefined, ourOrigins()),
  );
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
  /*
   * Quitting waits for both databases to close. PGlite writes its files on close, and a process
   * that exits before that has finished can leave the last minutes of work unflushed.
   */
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    // After an operation that has the servers stopped (a backup) has finished, and not for ever.
    const closeServers = () =>
      exclusive(() => closeAll([() => server?.close(), () => sign?.close()], 30_000));
    void closeAll([closeServers, () => model.close(), async () => addons.close()], 45_000).finally(
      () => app.quit(),
    );
  });

  void app.whenReady().then(async () => {
    try {
      guardEveryWindow();
      buildMenu();
      registerIpc();
      limitPermissions();
      server = await startServer();
      /*
       * No sign-in and no set-up form: the data never leaves this computer, so the first start makes
       * the workspace itself, named by a random ID drawn once per install. The "email" is that ID
       * at a reserved name; nothing is ever sent to it.
       */
      if (!(await server.isSetUp())) {
        const id = randomUUID();
        await exclusive(async () => {
          await server?.bootstrap(
            WorkspaceOwner.parse({
              organisationName: 'Loppa',
              name: t.appName,
              email: `${id}@install.invalid`,
              locale: lang,
            }),
          );
          // Now there is an organisation, Forms can be given its Sign token.
          await restartNow();
        });
      }
      await openMainWindow();
    } catch (error) {
      dialog.showErrorBox(t.startFailed, (error as Error).stack ?? String(error));
      app.exit(1);
    }
  });
}

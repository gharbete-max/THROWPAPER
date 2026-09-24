/**
 * The desktop edition's server, as the Electron shell in `apps/desktop` consumes it (ADR 0016).
 *
 * `apps/desktop` is Forms' own shell — the same product in a window, as `apps/mobile` will be in a
 * phone — so it imports this; `eslint.config.js` keeps it inside the Forms boundary.
 */
export { startDesktopServer, type DesktopServer, type StartDesktopOptions } from './start.js';
export {
  DesktopSettings,
  AiMode,
  MailMode,
  SigningMode,
  defaultSettings,
  readSettings,
  writeSettings,
  type DesktopSettingsInput,
} from './settings.js';
export type { PdfRenderer } from '../documents/render.js';
export { workspacePaths, WorkspaceOwner, type WorkspacePaths } from './workspace.js';

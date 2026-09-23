import type { DesktopSettings } from '@tp/api-forms/desktop';

/**
 * What the shell's own small window (first run and settings) may ask the main process for.
 *
 * Deliberately narrow. The main window — the Forms app itself — gets **no** bridge at all: it is a
 * web app talking to its API over HTTP like every other client (rule 3), and a preload there would
 * be a second, undocumented API into the machine.
 */
export type PanelView = 'setup' | 'settings';

/** Settings as the panel sees them: the stored password is never sent back to a renderer. */
export type PanelSettings = Omit<DesktopSettings, 'mail'> & {
  mail: Omit<DesktopSettings['mail'], 'smtp'> & {
    smtp?: Omit<NonNullable<DesktopSettings['mail']['smtp']>, 'passwordProtected'> & {
      hasPassword: boolean;
    };
  };
};

export interface PanelState {
  view: PanelView;
  lang: string;
  dataDir: string;
  settings: PanelSettings;
}

export interface SettingsForm {
  settings: PanelSettings;
  /** Plain text from the form, encrypted by the main process before it touches disk. Empty keeps the old one. */
  smtpPassword: string;
  /** Rule 7: moving from test mode to real sending needs this ticked. */
  confirmRealSending: boolean;
}

export type Result = { ok: true } | { ok: false; error: string };

export interface LoppaBridge {
  state(): Promise<PanelState>;
  bootstrap(owner: { organisationName: string; name: string; email: string }): Promise<Result>;
  loadDemo(): Promise<Result>;
  saveSettings(form: SettingsForm): Promise<Result>;
  closePanel(): void;
}

export const CHANNELS = {
  state: 'loppa:state',
  bootstrap: 'loppa:bootstrap',
  loadDemo: 'loppa:load-demo',
  saveSettings: 'loppa:save-settings',
  closePanel: 'loppa:close-panel',
} as const;

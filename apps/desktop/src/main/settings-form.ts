import { DesktopSettings } from '@tp/api-forms/desktop';
import type { PanelSettings, SettingsForm } from '../bridge.js';

/** What the panel may see: everything but the stored password, which becomes a yes/no. */
export function toPanelSettings(settings: DesktopSettings): PanelSettings {
  const { smtp, ...mail } = settings.mail;
  if (!smtp) return { ...settings, mail };
  const { passwordProtected, ...rest } = smtp;
  return {
    ...settings,
    mail: { ...mail, smtp: { ...rest, hasPassword: Boolean(passwordProtected) } },
  };
}

export type Applied = { ok: true; settings: DesktopSettings } | { ok: false; error: string };

/**
 * The settings form, applied to what is stored.
 *
 * Pure, so the two rules that matter are tested without Electron:
 *
 * - **Rule 7.** Choosing a mode that really sends — SMTP, Outlook, Apple Mail — is refused unless
 *   the confirmation was ticked, whether it replaces test mode or another sender. Staying where
 *   you are, or going back to the outbox, needs nothing.
 * - **No plain password on disk.** A new password is passed through `protect` (the OS store); an
 *   empty field keeps the one already stored; a password is never taken back from the panel,
 *   which never had it.
 */
export function applySettingsForm(
  current: DesktopSettings,
  form: SettingsForm,
  protect: (plain: string) => string,
): Applied {
  const next = form.settings;
  // Any change to a mode that really sends — from test mode, or from one sender to another.
  const startsSending = next.mail.mode !== 'outbox' && next.mail.mode !== current.mail.mode;
  if (startsSending && !form.confirmRealSending) {
    return { ok: false, error: 'confirm-real-sending' };
  }

  let smtp: DesktopSettings['mail']['smtp'];
  if (next.mail.smtp) {
    const { hasPassword: _hasPassword, ...rest } = next.mail.smtp;
    const passwordProtected = form.smtpPassword
      ? protect(form.smtpPassword)
      : current.mail.smtp?.passwordProtected;
    smtp = { ...rest, ...(passwordProtected ? { passwordProtected } : {}) };
  }

  const parsed = DesktopSettings.safeParse({
    ...next,
    mail: { mode: next.mail.mode, from: next.mail.from, ...(smtp ? { smtp } : {}) },
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    };
  }
  return { ok: true, settings: parsed.data };
}

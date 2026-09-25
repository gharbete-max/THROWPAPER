import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * What the person at the desktop has chosen, kept as `settings.json` in their data folder.
 *
 * Three switches carry the edition's promise (ADR 0016): forms, documents and email work with no
 * network at all, and the two things that genuinely need somebody else's computer — an AI model
 * and a qualified identity for signing — are each an explicit choice between **off/local**,
 * **connect online** to an endpoint the user names, and **work in cloud**, which is a placeholder
 * until a hosted Loppa exists to sync with.
 */

/** AI assistance (ADR 0013). Off unless somebody turns it on — the ADR's default, unchanged. */
export const AiMode = z.enum(['off', 'online', 'cloud']);
/**
 * Signing (ADR 0009). `local` is what works today with no network: the form's drawn signature
 * field, stored with its vector path. `online` points at a Sign server; `cloud` is the placeholder.
 */
export const SigningMode = z.enum(['local', 'online', 'cloud']);
/**
 * Mail.
 *
 * - `program` — the default: **nothing is sent by the app**. Every message waits on the To send
 *   screen until the person opens it as a draft in their own mail program and presses Send there
 *   (`mail/queue.ts`). Offline first means the app never mails anybody on its own.
 * - `outbox` is test mode (rule 7): `.eml` files in a folder, nothing sent.
 * - Advanced, and each behind rule 7's confirmation: `smtp`, a mail server the user names;
 *   `outlook` and `apple-mail`, which hand each message to that program to send on its own
 *   (`mail/outlook.ts`).
 */
export const MailMode = z.enum(['program', 'outbox', 'smtp', 'outlook', 'apple-mail']);

/**
 * Which program a draft opens in. `auto` is Apple Mail on a Mac and classic Outlook on Windows;
 * `mailto` is whatever the system opens for an email link — any program, but without the
 * attachment, which the To send screen then offers to save.
 */
export const DraftProgram = z.enum(['auto', 'outlook', 'apple-mail', 'mailto']);

export const SmtpSettings = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().optional(),
  /**
   * Encrypted by the desktop shell with the operating system's own store (DPAPI on Windows,
   * Keychain on macOS) before it is written here. Never a plain password on disk.
   */
  passwordProtected: z.string().optional(),
});

export const DesktopSettings = z.object({
  /**
   * A fixed port, not a random one: the browser keys storage, the service worker and the signed-in
   * session on the origin, and an origin that changed at every launch would sign the user out
   * every launch.
   */
  port: z.number().int().min(1024).max(65535).default(47017),
  mail: z
    .object({
      mode: MailMode.default('program'),
      program: DraftProgram.default('auto'),
      from: z.string().email().default('loppa@localhost.localdomain'),
      smtp: SmtpSettings.optional(),
    })
    .default({}),
  ai: z
    .object({
      mode: AiMode.default('off'),
      /** Where `online` connects. Recorded now; nothing calls it until P5 builds `AiProvider`. */
      endpoint: z.string().url().optional(),
    })
    .default({}),
  signing: z
    .object({
      mode: SigningMode.default('local'),
      /** Where `online` connects — an `api-sign` the user runs or rents. Nothing calls it before P1c. */
      endpoint: z.string().url().optional(),
    })
    .default({}),
  /** An explicit Chromium for PDFs, when neither Edge nor Chrome is where Playwright looks. */
  pdfBrowserPath: z.string().optional(),
});
export type DesktopSettings = z.infer<typeof DesktopSettings>;
export type DesktopSettingsInput = z.input<typeof DesktopSettings>;

export function defaultSettings(): DesktopSettings {
  return DesktopSettings.parse({});
}

/**
 * Read, or the defaults when there is no file yet. A file that exists and does not parse is an
 * error, not a reset: silently replacing somebody's SMTP settings with defaults would be data loss
 * that looks like a feature.
 */
export async function readSettings(path: string): Promise<DesktopSettings> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
    throw error;
  }
  return DesktopSettings.parse(JSON.parse(text));
}

/** Written beside and renamed over, so a crash mid-write leaves the old file rather than half. */
export async function writeSettings(
  path: string,
  input: DesktopSettingsInput,
): Promise<DesktopSettings> {
  const settings = DesktopSettings.parse(input);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return settings;
}

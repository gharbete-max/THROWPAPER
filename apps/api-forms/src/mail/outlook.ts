import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { MailProvider, OutboundMail } from './provider.js';

/**
 * Mail through the mail program already on this computer — the desktop edition's "send through
 * Outlook" (ADR 0016).
 *
 * No SMTP server, password or app registration: the message is handed to the program the user
 * already sends from, and leaves from their own account, in their own Sent folder.
 *
 * - **Windows:** classic Outlook, through its COM object model, from PowerShell. The new Outlook
 *   for Windows has no COM automation at all; that is reported as such, not as a vague failure.
 * - **macOS:** Microsoft Outlook, or Apple Mail, through AppleScript.
 *
 * **The scripts below are constants.** Nothing the message carries — an address, a subject with a
 * quote in it, an attachment named `$(rm -rf ~)` — is ever written into script text. On Windows
 * the message is a JSON file whose path arrives in an environment variable; on macOS it is a
 * folder of files whose path is the script's one argument. That is the whole defence against injection, and
 * `outlook.test.ts` holds it.
 */
export type MailProgram = 'outlook' | 'apple-mail';

export interface ScriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ScriptRunner = (
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<ScriptResult>;

export interface MailProgramOptions {
  program: MailProgram;
  platform: NodeJS.Platform;
  /** A folder in the workspace; each send writes into its own subfolder and removes it. */
  scratchDir: string;
  /** Injected by the tests; `execFile` otherwise. */
  run?: ScriptRunner;
}

/** Exit code the scripts use for "the mail program is not there, or cannot be automated". */
export const NOT_AVAILABLE = 3;

export const WINDOWS_OUTLOOK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$job = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:LOPPA_MAIL_JOB | ConvertFrom-Json',
  'try { $outlook = New-Object -ComObject Outlook.Application } catch { exit 3 }',
  '$mail = $outlook.CreateItem(0)',
  '$mail.To = $job.to',
  '$mail.Subject = $job.subject',
  'if ($job.html) { $mail.HTMLBody = $job.html } else { $mail.Body = $job.text }',
  'foreach ($path in $job.attachments) { [void]$mail.Attachments.Add($path) }',
  '$mail.Send()',
].join('\n');

/**
 * The message as files in one folder, read by the macOS scripts. Their only argument is that
 * folder's path — ours, absolute — because `osascript` parses options among its arguments, and an
 * address beginning with `-e` would otherwise be read as another script.
 */
export const MAC_FIELD_FILES = {
  to: 'to.txt',
  subject: 'subject.txt',
  body: 'body.txt',
  attachments: 'attachments.txt',
} as const;

const MAC_READ_FIELDS = [
  'on run argv',
  '  set jobFolder to item 1 of argv',
  '  set toAddress to read (POSIX file (jobFolder & "/to.txt")) as «class utf8»',
  '  set subjectLine to read (POSIX file (jobFolder & "/subject.txt")) as «class utf8»',
  '  set bodyText to read (POSIX file (jobFolder & "/body.txt")) as «class utf8»',
  '  set attachmentPaths to paragraphs of (read (POSIX file (jobFolder & "/attachments.txt")) as «class utf8»)',
];

/**
 * Outlook for Mac takes HTML content. Variables avoid `message` and `index`, which are terms in
 * the mail programs' own dictionaries.
 */
export const MAC_OUTLOOK_SCRIPT = [
  ...MAC_READ_FIELDS,
  '  try',
  '    tell application "Microsoft Outlook" to launch',
  '  on error',
  '    error number 3',
  '  end try',
  '  tell application "Microsoft Outlook"',
  '    set newMessage to make new outgoing message with properties {subject:subjectLine, content:bodyText}',
  '    make new to recipient at newMessage with properties {email address:{address:toAddress}}',
  '    repeat with attachmentPath in attachmentPaths',
  '      if length of attachmentPath > 0 then make new attachment at newMessage with properties {file:(POSIX file (attachmentPath as text))}',
  '    end repeat',
  '    send newMessage',
  '  end tell',
  'end run',
].join('\n');

/** Apple Mail is given the plain-text body; it has no supported way to set HTML. */
export const MAC_APPLE_MAIL_SCRIPT = [
  ...MAC_READ_FIELDS,
  '  tell application "Mail"',
  '    set newMessage to make new outgoing message with properties {subject:subjectLine, content:bodyText, visible:false}',
  '    tell newMessage',
  '      make new to recipient at end of to recipients with properties {address:toAddress}',
  '      repeat with attachmentPath in attachmentPaths',
  '        if length of attachmentPath > 0 then make new attachment with properties {file name:(POSIX file (attachmentPath as text))} at after the last paragraph',
  '      end repeat',
  '    end tell',
  '    send newMessage',
  '  end tell',
  'end run',
].join('\n');

const defaultRun: ScriptRunner = (command, args, env) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? (error as unknown as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error?.message ?? '') });
      },
    );
  });

export function describeProgram(program: MailProgram, platform: NodeJS.Platform): string {
  if (program === 'apple-mail') return 'Apple Mail';
  return platform === 'win32' ? 'classic Outlook' : 'Microsoft Outlook';
}

export function createMailProgramProvider(options: MailProgramOptions): MailProvider {
  const run = options.run ?? defaultRun;
  const { program, platform } = options;

  if (program === 'apple-mail' && platform !== 'darwin') {
    throw new Error('Apple Mail can only be used on a Mac.');
  }
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new Error('Sending through a mail program works on Windows and macOS only.');
  }

  return {
    name: program,
    async send(mail: OutboundMail) {
      const id = randomUUID();
      const dir = join(options.scratchDir, `mail-${id}`);
      await mkdir(dir, { recursive: true });
      try {
        // Each attachment under its own name, in its own folder: the mail program names the
        // attachment after the file.
        const attachments: string[] = [];
        for (const [index, attachment] of (mail.attachments ?? []).entries()) {
          const folder = join(dir, `a${index}`);
          await mkdir(folder);
          // No control characters: the macOS scripts read the paths back one per line.
          const name = [...basename(attachment.filename)]
            .map((char) => (char.charCodeAt(0) < 0x20 ? '_' : char))
            .join('');
          const path = join(folder, name || `attachment-${index}`);
          await writeFile(path, attachment.content, { mode: 0o600 });
          attachments.push(path);
        }

        let result: ScriptResult;
        if (platform === 'win32') {
          const job = join(dir, 'job.json');
          await writeFile(
            job,
            JSON.stringify({
              to: mail.to,
              subject: mail.subject,
              text: mail.text,
              html: mail.html ?? null,
              attachments,
            }),
            { encoding: 'utf8', mode: 0o600 },
          );
          result = await run(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              WINDOWS_OUTLOOK_SCRIPT,
            ],
            { LOPPA_MAIL_JOB: job },
          );
        } else {
          const content = program === 'outlook' ? (mail.html ?? mail.text) : mail.text;
          const fields: Record<keyof typeof MAC_FIELD_FILES, string> = {
            to: mail.to,
            subject: mail.subject,
            body: content,
            attachments: attachments.join('\n'),
          };
          for (const [field, file] of Object.entries(MAC_FIELD_FILES)) {
            await writeFile(join(dir, file), fields[field as keyof typeof MAC_FIELD_FILES], {
              encoding: 'utf8',
              mode: 0o600,
            });
          }
          const script = program === 'outlook' ? MAC_OUTLOOK_SCRIPT : MAC_APPLE_MAIL_SCRIPT;
          result = await run('osascript', ['-e', script, dir], {});
        }

        if (result.code === NOT_AVAILABLE || /\(3\)\s*$/.test(result.stderr.trim())) {
          throw new Error(
            platform === 'win32'
              ? 'Classic Outlook is not available on this computer. The new Outlook for Windows cannot be automated; switch to SMTP, or to test mode, in Settings.'
              : `${describeProgram(program, platform)} is not available on this computer.`,
          );
        }
        if (result.code !== 0) {
          throw new Error(
            `${describeProgram(program, platform)} did not send the message: ${result.stderr.trim() || `exit ${result.code}`}`,
          );
        }
        return { messageId: `${program}-${id}` };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

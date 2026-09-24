import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  MAC_FIELD_FILES,
  NOT_AVAILABLE,
  defaultRun,
  describeProgram,
  powershellPath,
  type MailProgram,
  type ScriptRunner,
} from './outlook.js';

/**
 * A message **left open as a draft** in the mail program on this computer, with a file attached —
 * the desktop edition's "Email document".
 *
 * `mailto:` cannot attach a file, on any platform, by design of the scheme. On the desktop there is
 * a better answer: the same Outlook and Apple Mail automation `outlook.ts` sends through, asked to
 * *show* the message instead of sending it. The person sees their own mail program with the PDF
 * already attached, types who it is for, and presses Send themselves. Nothing leaves the computer
 * until they do (rule 7) — this opens a window, it sends nothing.
 *
 * The same defence as `outlook.ts`: every script below is a constant. The subject, the body and the
 * attachment's name reach the script as files in a folder whose path is the only argument (macOS),
 * or as a JSON file named by an environment variable (Windows). No recipient is ever set.
 *
 * The attachment stays on disk after the draft opens: Apple Mail reads the file when the message is
 * sent, not when it is attached, so deleting it at once would send an empty attachment. Drafts live
 * under `scratchDir/drafts` and anything older than a day is swept on the next draft.
 */
export interface MailDraft {
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer };
}

export interface MailDrafter {
  /** What to call it on a button: "classic Outlook", "Apple Mail". */
  readonly label: string;
  open(draft: MailDraft): Promise<void>;
}

export const WINDOWS_OUTLOOK_DRAFT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$job = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:LOPPA_MAIL_JOB | ConvertFrom-Json',
  'try { $outlook = New-Object -ComObject Outlook.Application } catch { exit 3 }',
  '$mail = $outlook.CreateItem(0)',
  '$mail.Subject = $job.subject',
  '$mail.Body = $job.text',
  'foreach ($path in $job.attachments) { [void]$mail.Attachments.Add($path) }',
  '$mail.Display()',
].join('\n');

const MAC_READ_DRAFT_FIELDS = [
  'on run argv',
  '  set jobFolder to item 1 of argv',
  '  set subjectLine to read (POSIX file (jobFolder & "/subject.txt")) as «class utf8»',
  '  set bodyText to read (POSIX file (jobFolder & "/body.txt")) as «class utf8»',
  '  set attachmentPaths to paragraphs of (read (POSIX file (jobFolder & "/attachments.txt")) as «class utf8»)',
];

export const MAC_OUTLOOK_DRAFT_SCRIPT = [
  ...MAC_READ_DRAFT_FIELDS,
  '  try',
  '    tell application "Microsoft Outlook" to launch',
  '  on error',
  '    error number 3',
  '  end try',
  '  tell application "Microsoft Outlook"',
  '    set newMessage to make new outgoing message with properties {subject:subjectLine, content:bodyText}',
  '    repeat with attachmentPath in attachmentPaths',
  '      if length of attachmentPath > 0 then make new attachment at newMessage with properties {file:(POSIX file (attachmentPath as text))}',
  '    end repeat',
  '    open newMessage',
  '    activate',
  '  end tell',
  'end run',
].join('\n');

export const MAC_APPLE_MAIL_DRAFT_SCRIPT = [
  ...MAC_READ_DRAFT_FIELDS,
  '  tell application "Mail"',
  '    set newMessage to make new outgoing message with properties {subject:subjectLine, content:bodyText, visible:true}',
  '    tell newMessage',
  '      repeat with attachmentPath in attachmentPaths',
  '        if length of attachmentPath > 0 then make new attachment with properties {file name:(POSIX file (attachmentPath as text))} at after the last paragraph',
  '      end repeat',
  '    end tell',
  '    activate',
  '  end tell',
  'end run',
].join('\n');

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MailDrafterOptions {
  program: MailProgram;
  platform: NodeJS.Platform;
  /** The workspace's scratch folder. Drafts go in its `drafts` subfolder. */
  scratchDir: string;
  run?: ScriptRunner;
  now?: () => Date;
}

/** `null` where no mail program can be driven — Linux, or Apple Mail off a Mac. */
export function createMailDrafter(options: MailDrafterOptions): MailDrafter | null {
  const { program, platform } = options;
  if (platform !== 'win32' && platform !== 'darwin') return null;
  if (program === 'apple-mail' && platform !== 'darwin') return null;
  const run = options.run ?? defaultRun;
  const now = options.now ?? (() => new Date());
  const root = join(options.scratchDir, 'drafts');
  const label = describeProgram(program, platform);

  return {
    label,
    async open(draft) {
      await mkdir(root, { recursive: true });
      await sweep(root, now());

      const dir = join(root, randomUUID());
      const folder = join(dir, 'a0');
      await mkdir(folder, { recursive: true });
      // Its own name, minus anything that is not a name: no separators, no control characters.
      const name =
        [...basename(draft.attachment.filename.replace(/[\\/]/g, '_'))]
          .map((char) => (char.charCodeAt(0) < 0x20 ? '_' : char))
          .join('') || 'document.pdf';
      const path = join(folder, name);
      await writeFile(path, draft.attachment.content, { mode: 0o600 });

      let result;
      if (platform === 'win32') {
        const job = join(dir, 'job.json');
        await writeFile(
          job,
          JSON.stringify({ subject: draft.subject, text: draft.text, attachments: [path] }),
          { encoding: 'utf8', mode: 0o600 },
        );
        result = await run(
          powershellPath(),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            WINDOWS_OUTLOOK_DRAFT_SCRIPT,
          ],
          { LOPPA_MAIL_JOB: job },
        );
      } else {
        const fields = { subject: draft.subject, body: draft.text, attachments: path };
        for (const [field, value] of Object.entries(fields)) {
          const file = MAC_FIELD_FILES[field as keyof typeof fields];
          await writeFile(join(dir, file), value, { encoding: 'utf8', mode: 0o600 });
        }
        const script =
          program === 'outlook' ? MAC_OUTLOOK_DRAFT_SCRIPT : MAC_APPLE_MAIL_DRAFT_SCRIPT;
        result = await run('osascript', ['-e', script, dir], {});
      }

      if (result.code === NOT_AVAILABLE || /\(3\)\s*$/.test(result.stderr.trim())) {
        await rm(dir, { recursive: true, force: true });
        throw new DraftUnavailable(label);
      }
      if (result.code !== 0) {
        await rm(dir, { recursive: true, force: true });
        throw new Error(`${label} did not open the draft: exit ${result.code}`);
      }
    },
  };
}

export class DraftUnavailable extends Error {
  constructor(program: string) {
    super(`${program} is not available on this computer`);
    this.name = 'DraftUnavailable';
  }
}

/** Removes draft folders older than a day. Best effort: a locked file waits for the next sweep. */
async function sweep(root: string, now: Date): Promise<void> {
  for (const entry of await readdir(root).catch(() => [] as string[])) {
    const path = join(root, entry);
    const info = await stat(path).catch(() => null);
    if (info && now.getTime() - info.mtimeMs > DAY_MS) {
      await rm(path, { recursive: true, force: true }).catch(() => {});
    }
  }
}

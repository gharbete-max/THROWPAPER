import { mkdtemp, readdir, readFile, rm, stat, utimes, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DraftUnavailable,
  MAC_APPLE_MAIL_DRAFT_SCRIPT,
  MAC_OUTLOOK_DRAFT_SCRIPT,
  WINDOWS_OUTLOOK_DRAFT_SCRIPT,
  createMailDrafter,
} from './draft.js';
import type { ScriptRunner } from './outlook.js';

const scratch = await mkdtemp(join(tmpdir(), 'loppa-draft-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Everything the person's own form controls, at once. */
const hostile = {
  subject: `Vårmötet "2026" '; $(Remove-Item C:\\) \`whoami\` end tell`,
  text: 'Bifogat: Vårmötet.pdf\nReferens: K7M2QX',
  attachment: { filename: '../../Åsa\n$(evil).pdf', content: Buffer.from('%PDF-1.7 hej') },
};

function recorder(result = { code: 0, stdout: '', stderr: '' }) {
  const calls: Array<{
    command: string;
    args: readonly string[];
    env: Readonly<Record<string, string>>;
    files: Record<string, string>;
    attachments: string[];
  }> = [];
  const run: ScriptRunner = async (command, args, env) => {
    const folder = env['LOPPA_MAIL_JOB'] ? join(env['LOPPA_MAIL_JOB'], '..') : args.at(-1)!;
    const files: Record<string, string> = {};
    for (const name of await readdir(folder)) {
      if (name.endsWith('.txt') || name.endsWith('.json')) {
        files[name] = await readFile(join(folder, name), 'utf8');
      }
    }
    calls.push({ command, args, env, files, attachments: await readdir(join(folder, 'a0')) });
    return result;
  };
  return { calls, run };
}

describe('a draft in the mail program on this computer', () => {
  it('Windows: shows the message in Outlook, never sends it, with nothing of ours in the script', async () => {
    const { calls, run } = recorder();
    const drafter = createMailDrafter({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run,
    })!;
    await drafter.open(hostile);

    const [call] = calls;
    expect(call!.args.at(-1)).toBe(WINDOWS_OUTLOOK_DRAFT_SCRIPT);
    expect(WINDOWS_OUTLOOK_DRAFT_SCRIPT).toContain('$mail.Display()');
    expect(WINDOWS_OUTLOOK_DRAFT_SCRIPT).not.toContain('Send()');
    // No recipient: the person chooses who it goes to, in their own mail program.
    expect(WINDOWS_OUTLOOK_DRAFT_SCRIPT).not.toContain('.To');
    for (const arg of call!.args) expect(arg).not.toContain('Remove-Item');
    const job = JSON.parse(call!.files['job.json']!);
    expect(job.subject).toBe(hostile.subject);
    expect(job).not.toHaveProperty('to');
  });

  it('macOS: the only argument is our folder; Outlook opens the message, Mail shows it', async () => {
    for (const program of ['outlook', 'apple-mail'] as const) {
      const { calls, run } = recorder();
      const drafter = createMailDrafter({ program, platform: 'darwin', scratchDir: scratch, run })!;
      await drafter.open(hostile);
      const [call] = calls;
      expect(call!.command).toBe('osascript');
      expect(call!.args).toHaveLength(3);
      expect(call!.args[1]).toBe(
        program === 'outlook' ? MAC_OUTLOOK_DRAFT_SCRIPT : MAC_APPLE_MAIL_DRAFT_SCRIPT,
      );
      expect(call!.args[1]).not.toMatch(/\bsend\b/);
      expect(call!.args[1]).not.toContain('recipient');
      expect(call!.files['subject.txt']).toBe(hostile.subject);
      expect(call!.files['to.txt']).toBeUndefined();
    }
  });

  it('keeps the attachment a name and never a path, and keeps it on disk for the draft', async () => {
    const { calls, run } = recorder();
    const drafter = createMailDrafter({
      program: 'apple-mail',
      platform: 'darwin',
      scratchDir: scratch,
      run,
    })!;
    await drafter.open(hostile);
    const [name] = calls[0]!.attachments;
    expect(name).not.toMatch(/[\\/\n]/);
    const path = calls[0]!.files['attachments.txt']!;
    expect(path.startsWith(join(scratch, 'drafts'))).toBe(true);
    // Still there after the call: Mail reads it when the message is sent.
    expect((await readFile(path)).toString()).toBe('%PDF-1.7 hej');
  });

  it('sweeps drafts older than a day when the next one opens', async () => {
    const old = join(scratch, 'drafts', 'old-draft');
    await mkdir(old, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(old, twoDaysAgo, twoDaysAgo);

    const { run } = recorder();
    await createMailDrafter({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run,
    })!.open(hostile);
    await expect(stat(old)).rejects.toThrow();
  });

  it('says the program is not there, rather than failing vaguely — and cleans up', async () => {
    const { run } = recorder({ code: 3, stdout: '', stderr: '' });
    const before = await readdir(join(scratch, 'drafts')).catch(() => []);
    const drafter = createMailDrafter({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run,
    })!;
    await expect(drafter.open(hostile)).rejects.toBeInstanceOf(DraftUnavailable);
    expect(await readdir(join(scratch, 'drafts'))).toHaveLength(before.length);
  });

  it('offers nothing where no mail program can be driven', () => {
    expect(
      createMailDrafter({ program: 'outlook', platform: 'linux', scratchDir: scratch }),
    ).toBeNull();
    expect(
      createMailDrafter({ program: 'apple-mail', platform: 'win32', scratchDir: scratch }),
    ).toBeNull();
  });
});

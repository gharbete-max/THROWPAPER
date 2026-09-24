import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAC_APPLE_MAIL_SCRIPT,
  MAC_OUTLOOK_SCRIPT,
  WINDOWS_OUTLOOK_SCRIPT,
  createMailProgramProvider,
  type ScriptRunner,
} from './outlook.js';

const scratch = await mkdtemp(join(tmpdir(), 'loppa-outlook-'));
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Everything an attacker controls, in every field at once. */
const hostile = {
  to: '-e do shell script "rm -rf ~"@example.com',
  subject: `Hej "Åsa" '; $(Remove-Item C:\\) \`whoami\` end tell`,
  text: 'Välkommen',
  html: '<p>Välkommen</p>',
  attachments: [
    {
      filename: 'Åsa\n$(evil).pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-1.7'),
    },
  ],
};

interface Call {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  files: Record<string, string>;
}

/** Records the call, and reads what the script would read, before the folder is removed. */
function recorder(result = { code: 0, stdout: '', stderr: '' }) {
  const calls: Call[] = [];
  const run: ScriptRunner = async (command, args, env) => {
    const files: Record<string, string> = {};
    const folder = env['LOPPA_MAIL_JOB']
      ? join(env['LOPPA_MAIL_JOB'], '..')
      : args[args.length - 1]!;
    for (const name of await readdir(folder)) {
      if (name.endsWith('.txt') || name.endsWith('.json')) {
        files[name] = await readFile(join(folder, name), 'utf8');
      }
    }
    calls.push({ command, args, env, files });
    return result;
  };
  return { calls, run };
}

describe('sending through the mail program on this computer', () => {
  it('Windows: runs the constant script and carries the message only in a JSON file', async () => {
    const { calls, run } = recorder();
    const provider = createMailProgramProvider({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run,
    });
    expect(provider.name).toBe('outlook');
    await provider.send(hostile);

    const call = calls[0]!;
    expect(call.command).toBe('powershell.exe');
    expect(call.args[call.args.length - 1]).toBe(WINDOWS_OUTLOOK_SCRIPT);
    // Nothing the message says appears on the command line.
    expect(call.args.join(' ')).not.toContain('Åsa');
    expect(call.args.join(' ')).not.toContain('rm -rf');

    const job = JSON.parse(call.files['job.json']!) as {
      to: string;
      subject: string;
      attachments: string[];
    };
    expect(job.to).toBe(hostile.to);
    expect(job.subject).toBe(hostile.subject);
    expect(job.attachments[0]).toMatch(/Åsa_\$\(evil\)\.pdf$/);
  });

  it('macOS: the only argument is our own folder, never a field that could read as an option', async () => {
    for (const program of ['outlook', 'apple-mail'] as const) {
      const { calls, run } = recorder();
      const provider = createMailProgramProvider({
        program,
        platform: 'darwin',
        scratchDir: scratch,
        run,
      });
      await provider.send(hostile);

      const call = calls[0]!;
      expect(call.command).toBe('osascript');
      expect(call.args).toHaveLength(3);
      expect(call.args[0]).toBe('-e');
      expect(call.args[1]).toBe(program === 'outlook' ? MAC_OUTLOOK_SCRIPT : MAC_APPLE_MAIL_SCRIPT);
      expect(call.args[2]!.startsWith(scratch)).toBe(true);

      expect(call.files['to.txt']).toBe(hostile.to);
      expect(call.files['subject.txt']).toBe(hostile.subject);
      // Outlook gets the HTML, Apple Mail the text.
      expect(call.files['body.txt']).toBe(program === 'outlook' ? hostile.html : hostile.text);
      // One attachment per line: the newline in the file name cannot split it into two.
      expect(call.files['attachments.txt']!.split('\n')).toHaveLength(1);
    }
  });

  it('removes the message from disk after sending, and after failing', async () => {
    const ok = createMailProgramProvider({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run: recorder().run,
    });
    await ok.send(hostile);
    const failing = createMailProgramProvider({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run: recorder({ code: 1, stdout: '', stderr: 'boom' }).run,
    });
    await expect(failing.send(hostile)).rejects.toThrow(
      /classic Outlook did not send the message: boom/,
    );
    expect((await readdir(scratch)).filter((name) => name.startsWith('mail-'))).toEqual([]);
  });

  it('says plainly when classic Outlook is not there — the new Outlook cannot be automated', async () => {
    const provider = createMailProgramProvider({
      program: 'outlook',
      platform: 'win32',
      scratchDir: scratch,
      run: recorder({ code: 3, stdout: '', stderr: '' }).run,
    });
    await expect(provider.send(hostile)).rejects.toThrow(
      /new Outlook for Windows cannot be automated/,
    );
  });

  it('refuses a combination that cannot work, at configuration rather than at the first send', () => {
    expect(() =>
      createMailProgramProvider({ program: 'apple-mail', platform: 'win32', scratchDir: scratch }),
    ).toThrow(/only be used on a Mac/);
    expect(() =>
      createMailProgramProvider({ program: 'outlook', platform: 'linux', scratchDir: scratch }),
    ).toThrow(/Windows and macOS only/);
  });
});

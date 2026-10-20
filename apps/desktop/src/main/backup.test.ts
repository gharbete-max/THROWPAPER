import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KEY_FILES,
  KEYS_FILE,
  KeysError,
  backupFilter,
  openKeys,
  readKeyFiles,
  sealKeys,
  writeKeyFiles,
} from './backup.js';

describe('the backup', () => {
  const keep = backupFilter();

  it('leaves out the keys files of Forms and of Sign', () => {
    expect(keep(join('data', 'workspace', 'secrets.json'))).toBe(false);
    expect(keep(join('data', 'workspace', 'sign', 'secrets.json'))).toBe(false);
  });

  it('copies everything else', () => {
    expect(keep(join('data', 'workspace'))).toBe(true);
    expect(keep(join('data', 'workspace', 'forms', 'pgdata', 'PG_VERSION'))).toBe(true);
  });
});

describe('the encrypted keys backup', () => {
  // Built at run time: no secret-looking literal in the source.
  const phrase = ['correct', 'horse', Date.now().toString(36)].join(' ');
  const wrong = phrase + '!';
  const signKeys = join('sign', 'secrets.json');
  const files: Record<string, Buffer> = {
    'secrets.json': Buffer.from('{"jwt":"' + 'a'.repeat(40) + '"}'),
    [signKeys]: Buffer.from('{"k":"' + 'b'.repeat(40) + '"}'),
  };

  it('round-trips both files under the same passphrase', () => {
    const opened = openKeys(sealKeys(files, phrase), phrase);
    expect(Object.keys(opened).sort()).toEqual(Object.keys(files).sort());
    expect(opened['secrets.json']!.equals(files['secrets.json']!)).toBe(true);
  });

  it('is random each time and keeps no plain text in the file', () => {
    const a = sealKeys(files, phrase);
    expect(a.equals(sealKeys(files, phrase))).toBe(false);
    expect(a.toString('utf8')).not.toContain('aaaaaaaa');
    expect(JSON.parse(a.toString('utf8'))).toMatchObject({
      kdf: 'scrypt',
      cipher: 'aes-256-gcm',
      N: 32768,
      r: 8,
      p: 1,
    });
  });

  it('refuses a wrong passphrase', () => {
    expect(() => openKeys(sealKeys(files, phrase), wrong)).toThrow(KeysError);
  });

  it('notices any tampering, in the text or in the parameters', () => {
    const sealed = JSON.parse(sealKeys(files, phrase).toString('utf8')) as Record<string, string>;
    for (const field of ['ct', 'tag', 'iv', 'salt']) {
      const raw = Buffer.from(sealed[field]!, 'base64');
      raw[0] = raw[0]! ^ 1;
      const changed = Buffer.from(JSON.stringify({ ...sealed, [field]: raw.toString('base64') }));
      expect(() => openKeys(changed, phrase), field).toThrow(KeysError);
    }
    const weaker = Buffer.from(JSON.stringify({ ...sealed, N: 16384 }));
    expect(() => openKeys(weaker, phrase)).toThrow(KeysError);
  });

  it('calls what is not a keys file unreadable, and refuses enormous parameters', () => {
    expect(() => openKeys(Buffer.from('nope'), phrase)).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
    const sealed = JSON.parse(sealKeys(files, phrase).toString('utf8')) as object;
    expect(() => openKeys(Buffer.from(JSON.stringify({ ...sealed, N: 2 ** 30 })), phrase)).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
    // A gigabyte of scrypt memory is also too much to ask of a file somebody handed over.
    expect(() => openKeys(Buffer.from(JSON.stringify({ ...sealed, N: 2 ** 20 })), phrase)).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  it('lays out as keys.enc beside the copy and writes the files back only from a good one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loppa-keys-'));
    try {
      const data = join(root, 'data');
      await mkdir(join(data, 'sign'), { recursive: true });
      await writeFile(join(data, 'secrets.json'), files['secrets.json']!);
      await writeFile(join(data, signKeys), files[signKeys]!);
      const read = await readKeyFiles(data);
      expect(Object.keys(read).sort()).toEqual([...KEY_FILES].sort());

      const backup = join(root, 'backup');
      await mkdir(backup);
      await writeFile(join(backup, KEYS_FILE), sealKeys(read, phrase));
      expect(await readdir(backup)).toEqual(['keys.enc']);

      await rm(join(data, 'secrets.json'));
      // A wrong passphrase throws before anything is written: the folder is as it was.
      expect(() => openKeys(readFileSync(join(backup, KEYS_FILE)), wrong)).toThrow(KeysError);
      expect(await readdir(data)).toEqual(['sign']);

      await writeKeyFiles(data, openKeys(await readFile(join(backup, KEYS_FILE)), phrase));
      expect((await readFile(join(data, 'secrets.json'))).equals(files['secrets.json']!)).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

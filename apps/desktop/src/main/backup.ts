import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * What a backup copies: the whole data folder except the plain-text keys files (`secrets.json` at its top
 * for Forms and `sign/secrets.json` for Sign: signing and session keys), which would otherwise land in a
 * synced Documents folder as readable text (ADR 0026). A restored copy makes new keys; sessions and
 * old magic links stop working, the data does not.
 */
export function backupFilter(): (source: string) => boolean {
  return (source) => basename(source) !== 'secrets.json';
}

/**
 * The encrypted backup of the keys (ADR 0026, decision 7). `keys.enc` sits beside the copy of the data
 * folder and holds the two `secrets.json` files, sealed with AES-256-GCM under a key that scrypt makes of
 * a passphrase the person types. The file is JSON: the parameters, salt and nonce are in it in the clear
 * (they are not secret) and are authenticated too, so changing any byte of it, or typing the wrong
 * passphrase, fails the same way and writes nothing.
 */
export const KEYS_FILE = 'keys.enc';

/** The only paths a keys file can restore, relative to the data folder. It never names a path itself. */
export const KEY_FILES = ['secrets.json', join('sign', 'secrets.json')] as const;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1 } as const;
/** Parameters read from a file are held to this, so a crafted file cannot ask for gigabytes. */
const SCRYPT_MAX_N = 2 ** 20;
export const MIN_PASSPHRASE = 8;

export class KeysError extends Error {
  constructor(readonly code: 'wrong-or-damaged' | 'unreadable') {
    super(code);
  }
}

function derive(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * N * r });
}

/** Files as `{ relative path: bytes }` to the bytes of a `keys.enc`. */
export function sealKeys(files: Record<string, Buffer>, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = {
    v: 1,
    kdf: 'scrypt',
    ...SCRYPT,
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
  const key = derive(passphrase, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const plain = JSON.stringify(
    Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]),
    ),
  );
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const sealed = {
    ...header,
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
  return Buffer.from(JSON.stringify(sealed, null, 2));
}

/** The files in a `keys.enc`, or a `KeysError`. Only the two known paths come back. */
export function openKeys(blob: Buffer, passphrase: string): Record<string, Buffer> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(blob.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new KeysError('unreadable');
  }
  const { ct, tag, ...header } = parsed;
  const N = Number(header['N']);
  const r = Number(header['r']);
  const p = Number(header['p']);
  if (
    header['v'] !== 1 ||
    header['kdf'] !== 'scrypt' ||
    header['cipher'] !== 'aes-256-gcm' ||
    typeof ct !== 'string' ||
    typeof tag !== 'string' ||
    !Number.isInteger(Math.log2(N)) ||
    N < 2 ** 14 ||
    N > SCRYPT_MAX_N ||
    r !== 8 ||
    p !== 1
  ) {
    throw new KeysError('unreadable');
  }
  try {
    const key = derive(passphrase, Buffer.from(String(header['salt']), 'base64'), N, r, p);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(String(header['iv']), 'base64'),
    );
    decipher.setAAD(Buffer.from(JSON.stringify(header)));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plain = JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
        'utf8',
      ),
    ) as Record<string, string>;
    return Object.fromEntries(
      KEY_FILES.filter((name) => typeof plain[name] === 'string').map((name) => [
        name,
        Buffer.from(plain[name]!, 'base64'),
      ]),
    );
  } catch {
    throw new KeysError('wrong-or-damaged');
  }
}

/** Reads the keys files that exist in a data folder. */
export async function readKeyFiles(dataDir: string): Promise<Record<string, Buffer>> {
  const found: Record<string, Buffer> = {};
  for (const name of KEY_FILES) {
    try {
      found[name] = await readFile(join(dataDir, name));
    } catch {
      /* Sign may be off, so there may be only one. */
    }
  }
  return found;
}

/** Puts keys files back. The caller has stopped the servers and the person has confirmed. */
export async function writeKeyFiles(dataDir: string, files: Record<string, Buffer>): Promise<void> {
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(dataDir, name)), { recursive: true });
    await writeFile(join(dataDir, name), bytes, { mode: 0o600 });
  }
}

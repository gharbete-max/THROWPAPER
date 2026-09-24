import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * An independent check of a sealed PDF, for tests: OpenSSL, not our code, decides whether the seal
 * holds (ADR 0015 — a validator we did not write). The EU DSS validator is the fuller check and a
 * later CI job; this one runs everywhere OpenSSL does, which is every CI runner.
 *
 * It verifies the CMS signature over exactly the bytes the PDF's `/ByteRange` names, against the
 * seal certificate as the only trust anchor. It does not follow a PDF's structure, so it also
 * catches a seal that covers less of the file than it should (see `coversWholeFile`).
 */
export interface Extracted {
  byteRange: [number, number, number, number];
  signedContent: Uint8Array;
  cms: Uint8Array;
}

export function extractSeal(pdf: Uint8Array): Extracted {
  const text = Buffer.from(pdf).toString('latin1');
  const matches = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const last = matches.at(-1);
  if (!last) throw new Error('No /ByteRange in the file');
  const byteRange = last.slice(1, 5).map(Number) as [number, number, number, number];
  const [a, b, c, d] = byteRange;

  const signedContent = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const hex = text.slice(b + 1, c - 1);
  const padded = Buffer.from(hex, 'hex');
  return { byteRange, signedContent, cms: padded.subarray(0, derLength(padded)) };
}

/** The seal leaves out only its own `<…>` hole: from byte 0 to the last byte of the file. */
export function coversWholeFile(pdf: Uint8Array, byteRange: Extracted['byteRange']): boolean {
  const [a, b, c, d] = byteRange;
  const hole = Buffer.from(pdf.subarray(b, c)).toString('latin1');
  return a === 0 && c + d === pdf.length && /^<[0-9a-fA-F]+>$/.test(hole);
}

export function opensslVerify(
  signedContent: Uint8Array,
  cms: Uint8Array,
  certPem: string,
): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tp-seal-'));
  try {
    writeFileSync(join(dir, 'content.bin'), signedContent);
    writeFileSync(join(dir, 'seal.der'), cms);
    writeFileSync(join(dir, 'cert.pem'), certPem);
    const result = spawnSync(
      'openssl',
      [
        'cms',
        '-verify',
        '-binary',
        '-inform',
        'DER',
        '-in',
        join(dir, 'seal.der'),
        '-content',
        join(dir, 'content.bin'),
        '-CAfile',
        join(dir, 'cert.pem'),
        '-purpose',
        'any',
        '-out',
        join(dir, 'out.bin'),
      ],
      { encoding: 'utf8' },
    );
    // A missing openssl is an error, never a pass: a validator that did not run validated nothing.
    if (result.error) throw result.error;
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Length of the outermost DER element — the placeholder is zero-padded past it. */
function derLength(bytes: Uint8Array): number {
  const first = bytes[1]!;
  if (first < 0x80) return 2 + first;
  const count = first & 0x7f;
  let length = 0;
  for (let index = 0; index < count; index += 1) length = length * 256 + bytes[2 + index]!;
  return 2 + count + length;
}

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as pkijs from 'pkijs';
import { PDFDocument } from 'pdf-lib';
import { apply, draftEnvelope, type EnvelopeEvent } from '@tp/signing';
import { generateDevCertificate, loadSealer, type PemPair, type Sealer } from './certificate.js';
import { extractSeal, opensslVerify } from './openssl-validator.js';
import { sealEnvelope, type SealInput } from './seal.js';
import { rfc3161, TimestampUnavailable } from './timestamp.js';

/**
 * A real RFC 3161 service, run by OpenSSL in a temporary folder: the client is checked against
 * replies it did not write itself, and every token it keeps is verified by `openssl ts -verify`.
 * OpenSSL missing is a failure, never a pass, as in `openssl-validator.ts`.
 */
let dir: string;
const run = (args: string[]) => {
  const result = spawnSync('openssl', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tp-tsa-'));
  run([
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', join(dir, 'tsa.key'), '-out', join(dir, 'tsa.pem'), '-days', '2',
    '-subj', '/CN=Test TSA', '-addext', 'extendedKeyUsage=critical,timeStamping',
  ]); // prettier-ignore
  writeFileSync(join(dir, 'serial'), '01\n');
  writeFileSync(
    join(dir, 'tsa.cnf'),
    [
      '[ tsa ]',
      'default_tsa = test',
      '[ test ]',
      `serial = ${join(dir, 'serial')}`,
      `signer_cert = ${join(dir, 'tsa.pem')}`,
      `signer_key = ${join(dir, 'tsa.key')}`,
      'signer_digest = sha256',
      'default_policy = 1.2.3.4.1',
      'digests = sha256',
      'ess_cert_id_alg = sha256',
      'accuracy = secs:1',
    ].join('\n'),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** `fetch`, answered by the OpenSSL service; `query` lets a test swap in another request. */
function tsaFetch(query?: (asked: Uint8Array) => Uint8Array): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const asked = new Uint8Array(init!.body as Uint8Array);
    writeFileSync(join(dir, 'q.tsq'), query ? query(asked) : asked);
    const reply = run([
      'ts', '-reply', '-config', join(dir, 'tsa.cnf'),
      '-queryfile', join(dir, 'q.tsq'), '-out', join(dir, 'r.tsr'),
    ]); // prettier-ignore
    if (reply.status !== 0) throw new Error(reply.stderr);
    return new Response(readFileSync(join(dir, 'r.tsr')));
  }) as typeof fetch;
}

function verifyToken(token: Uint8Array, imprint: Uint8Array): string {
  writeFileSync(join(dir, 'token.der'), token);
  const result = run([
    'ts', '-verify', '-digest', Buffer.from(imprint).toString('hex'),
    '-in', join(dir, 'token.der'), '-token_in', '-CAfile', join(dir, 'tsa.pem'),
  ]); // prettier-ignore
  return `${result.stdout}${result.stderr}`;
}

const sha = (text: string) => new Uint8Array(createHash('sha256').update(text).digest());

describe('the RFC 3161 client', () => {
  it('keeps a token that a timestamp service signed over exactly our hash', async () => {
    const imprint = sha('the signature');
    const token = await rfc3161(
      { name: 'Test', url: 'http://tsa.test' },
      { fetch: tsaFetch() },
    ).stamp(imprint);
    expect(verifyToken(token, imprint)).toMatch(/Verification: OK/);
  });

  it('refuses a reply for another hash', async () => {
    const other = () => {
      run(['ts', '-query', '-digest', Buffer.from(sha('something else')).toString('hex'),
        '-sha256', '-cert', '-out', join(dir, 'other.tsq')]); // prettier-ignore
      return readFileSync(join(dir, 'other.tsq'));
    };
    const client = rfc3161({ name: 'Test', url: 'http://tsa.test' }, { fetch: tsaFetch(other) });
    await expect(client.stamp(sha('the signature'))).rejects.toThrow(TimestampUnavailable);
  });

  it('gives up, as unavailable, when the service cannot be reached', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const client = rfc3161({ name: 'Test', url: 'http://tsa.test' }, { fetch: offline });
    await expect(client.stamp(sha('x'))).rejects.toThrow(TimestampUnavailable);
  });
});

describe('a sealed PDF and its time', () => {
  let pair: PemPair;
  let sealer: Sealer;
  let input: SealInput;

  beforeAll(async () => {
    pair = await generateDevCertificate();
    sealer = await loadSealer(pair);
    const source = await PDFDocument.create();
    source.addPage([595.28, 841.89]).drawText('Hyresavtal', { x: 72, y: 760, size: 18 });
    const document = await source.save();
    const documentSha256 = createHash('sha256').update(document).digest('hex');
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 9, minute)).toISOString();
    let envelope = draftEnvelope({
      id: '0b4e2f9a-6c1d-4e3b-8a7f-2d9c1b0e5a44',
      documentName: 'Hyresavtal',
      documentSha256,
      routing: 'parallel',
      environment: 'production',
      expiresAt: at(59),
      parties: [{ id: 'p1', name: 'Anna', locale: 'en-GB', order: 1 }],
    });
    const events: EnvelopeEvent[] = [
      { type: 'sent', at: at(0) },
      { type: 'viewed', at: at(1), partyId: 'p1' },
      {
        type: 'signed',
        at: at(2),
        partyId: 'p1',
        evidence: {
          method: 'typed',
          level: 'simple',
          environment: 'production',
          signedAt: at(2),
          documentSha256,
          declaration: { key: 'lease.agree', version: 1, text: '[placeholder]' },
          details: { typedName: 'Anna' },
        },
      },
    ];
    for (const event of events) {
      const result = apply(envelope, event);
      if (!result.ok) throw new Error(result.reason);
      envelope = result.envelope;
    }
    input = {
      document,
      envelope,
      events,
      declaration: { key: 'lease.agree', version: 1 },
      trailSha256: 'c'.repeat(64),
      sealedAt: new Date(at(3)),
    };
  });

  /** The signature-time-stamp attribute of the seal, and the hash it must be over. */
  function stampOf(sealed: Uint8Array): { token: Uint8Array; imprint: Uint8Array } | null {
    const info = pkijs.ContentInfo.fromBER(extractSeal(sealed).cms.slice().buffer);
    const signer = new pkijs.SignedData({ schema: info.content }).signerInfos[0]!;
    const attribute = signer.unsignedAttrs?.attributes.find(
      (a) => a.type === '1.2.840.113549.1.9.16.2.14',
    );
    if (!attribute) return null;
    return {
      token: new Uint8Array(attribute.values[0]!.toBER(false)),
      imprint: new Uint8Array(
        createHash('sha256')
          .update(new Uint8Array(signer.signature.valueBlock.valueHexView))
          .digest(),
      ),
    };
  }

  it('carries a timestamp over its own signature that OpenSSL verifies, and still verifies', async () => {
    const timestamper = rfc3161(
      { name: 'Test TSA', url: 'http://tsa.test' },
      { fetch: tsaFetch() },
    );
    const sealed = await sealEnvelope(input, { ...sealer, timestamper });

    const seal = extractSeal(sealed);
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
    const stamp = stampOf(sealed);
    expect(stamp).not.toBeNull();
    expect(verifyToken(stamp!.token, stamp!.imprint)).toMatch(/Verification: OK/);
  });

  it('is sealed on the clock, with no timestamp, when the service is out of reach', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const timestamper = rfc3161({ name: 'Test TSA', url: 'http://tsa.test' }, { fetch: offline });
    const sealed = await sealEnvelope(input, { ...sealer, timestamper });

    const seal = extractSeal(sealed);
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
    expect(stampOf(sealed)).toBeNull();
  });

  it('puts the envelope and the sealed time on every page', async () => {
    const sealed = await sealEnvelope(input, sealer);
    const pdf = await PDFDocument.load(sealed);
    // Standard fonts write text as hex strings, inside compressed content streams.
    const hex = Buffer.from(input.envelope.id, 'latin1').toString('hex').toUpperCase();
    const raw = Buffer.from(sealed).toString('latin1');
    const body = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n')
      .toUpperCase();
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(body.split(hex).length - 1).toBeGreaterThanOrEqual(pdf.getPageCount());
  });
});

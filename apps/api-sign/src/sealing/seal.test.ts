import { X509Certificate } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { apply, draftEnvelope, type Envelope, type EnvelopeEvent } from '@tp/signing';
import {
  generateDevCertificate,
  loadSealer,
  readableCertificate,
  type PemPair,
  type Sealer,
} from './certificate.js';
import { withPaddedSerial } from '../test-certificate.js';
import { coversWholeFile, extractSeal, opensslVerify } from './openssl-validator.js';
import { sealEnvelope, type SealInput } from './seal.js';
import { createHash } from 'node:crypto';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString();

let pair: PemPair;
let sealer: Sealer;
let document: Uint8Array;
let documentSha256: string;

beforeAll(async () => {
  pair = await generateDevCertificate();
  sealer = await loadSealer(pair);
  const source = await PDFDocument.create();
  source.addPage([595.28, 841.89]).drawText('Hyresavtal', { x: 72, y: 760, size: 18 });
  source.addPage([595.28, 841.89]);
  document = await source.save();
  documentSha256 = createHash('sha256').update(document).digest('hex');
});

function completed(
  environment: Envelope['environment'],
  parties: { id: string; name: string; locale: string }[],
): SealInput {
  let envelope = draftEnvelope({
    id: '6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11',
    documentName: 'Hyresavtal 2026',
    documentSha256,
    routing: 'parallel',
    environment,
    expiresAt: at(59),
    parties: parties.map((party, index) => ({ ...party, order: index + 1 })),
  });
  const events: EnvelopeEvent[] = [{ type: 'sent', at: at(0) }];
  parties.forEach((party, index) => {
    events.push({ type: 'viewed', at: at(1 + index), partyId: party.id });
    events.push({
      type: 'signed',
      at: at(10 + index),
      partyId: party.id,
      evidence: {
        method: 'typed',
        level: 'simple',
        environment,
        signedAt: at(10 + index),
        documentSha256,
        declaration: { key: 'lease.agree', version: 1, text: '[placeholder]' },
        details: { typedName: party.name },
      },
    });
  });
  for (const event of events) {
    const result = apply(envelope, event);
    if (!result.ok) throw new Error(result.reason);
    envelope = result.envelope;
  }
  return {
    document,
    envelope,
    events,
    declaration: { key: 'lease.agree', version: 1 },
    trailSha256: 'c'.repeat(64),
    sealedAt: new Date(at(20)),
  };
}

describe('a sealed PDF', () => {
  it('verifies with OpenSSL, over the whole file but its own signature', async () => {
    const sealed = await sealEnvelope(
      completed('production', [{ id: 'p1', name: 'Åsa Öberg', locale: 'sv-SE' }]),
      sealer,
    );
    const seal = extractSeal(sealed);
    expect(coversWholeFile(sealed, seal.byteRange)).toBe(true);
    const verdict = opensslVerify(seal.signedContent, seal.cms, pair.certPem);
    expect(verdict.output).toMatch(/Verification successful/);
    expect(verdict.ok).toBe(true);
    expect(Buffer.from(sealed).toString('latin1')).toContain('/ETSI.CAdES.detached');
  });

  it('fails OpenSSL when a single byte of the signed content changes', async () => {
    const sealed = await sealEnvelope(
      completed('production', [{ id: 'p1', name: 'Anna', locale: 'en-GB' }]),
      sealer,
    );
    const { byteRange } = extractSeal(sealed);
    // A byte inside the document body, well clear of the signature hole.
    const tampered = new Uint8Array(sealed);
    const target = Math.floor(byteRange[1] / 2);
    tampered[target] = tampered[target]! ^ 0x01;

    const seal = extractSeal(tampered);
    const verdict = opensslVerify(seal.signedContent, seal.cms, pair.certPem);
    expect(verdict.ok).toBe(false);
  });

  it('fails OpenSSL against a certificate that did not seal it', async () => {
    const sealed = await sealEnvelope(
      completed('production', [{ id: 'p1', name: 'Anna', locale: 'en-GB' }]),
      sealer,
    );
    const stranger = await generateDevCertificate();
    const seal = extractSeal(sealed);
    expect(opensslVerify(seal.signedContent, seal.cms, stranger.certPem).ok).toBe(false);
  });

  it('keeps the document pages and adds one audit page per language the parties read', async () => {
    const sealed = await sealEnvelope(
      completed('test', [
        { id: 'p1', name: 'Åsa', locale: 'sv-SE' },
        { id: 'p2', name: 'Anna', locale: 'en-GB' },
        // Norwegian falls back to the Swedish catalogue, so it shares Åsa's page.
        { id: 'p3', name: 'Ola', locale: 'nb-NO' },
      ]),
      sealer,
    );
    const reopened = await PDFDocument.load(sealed);
    expect(reopened.getPageCount()).toBe(2 + 2);
  });

  it('carries a trail too long for one page onto the next, still sealed', async () => {
    const parties = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Party ${index + 1}`,
      locale: 'en-GB',
    }));
    const sealed = await sealEnvelope(completed('production', parties), sealer);
    // 81 events at one line each do not fit on one A4 page under the facts table.
    expect((await PDFDocument.load(sealed)).getPageCount()).toBeGreaterThan(2 + 1);
    const seal = extractSeal(sealed);
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
  });

  it('refuses to seal anything but a completed envelope', async () => {
    const input = completed('test', [{ id: 'p1', name: 'Anna', locale: 'en-GB' }]);
    await expect(
      sealEnvelope({ ...input, envelope: { ...input.envelope, status: 'sent' } }, sealer),
    ).rejects.toThrow(/completed/);
  });

  it('draws a name the standard font cannot as its code points, never dropping it', async () => {
    const sealed = await sealEnvelope(
      completed('production', [{ id: 'p1', name: 'Ирина', locale: 'ru-RU' }]),
      sealer,
    );
    const seal = extractSeal(sealed);
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
  });
});

describe('the seal certificate', () => {
  it('refuses a key that does not belong to the certificate', async () => {
    const other = await generateDevCertificate();
    await expect(loadSealer({ keyPem: other.keyPem, certPem: pair.certPem })).rejects.toThrow(
      /does not belong/,
    );
  });

  /**
   * One certificate in 256 once had a serial OpenSSL cannot read — a first byte of 0x00 before one
   * below 0x80 is padding DER forbids — and every seal made with it failed to verify. The random
   * bytes are forced to exactly that start here, so the case is tested every run, not by chance.
   */
  it('makes a serial OpenSSL reads even when the random bytes begin as padding', async () => {
    const real = crypto.getRandomValues.bind(crypto);
    let armed = true;
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((
      array: Uint8Array<ArrayBuffer>,
    ) => {
      real(array);
      if (armed && array.byteLength === 16) {
        array[0] = 0x00;
        array[1] = 0x05;
        armed = false;
      }
      return array;
    }) as typeof crypto.getRandomValues);
    try {
      const padded = await generateDevCertificate();
      expect(armed).toBe(false);
      expect(readableCertificate(padded.certPem)).toBe(true);
      const first = Number.parseInt(
        new X509Certificate(padded.certPem).serialNumber.slice(0, 2),
        16,
      );
      expect(first).toBeGreaterThanOrEqual(0x40);
      expect(first).toBeLessThanOrEqual(0x7f);

      const sealed = await sealEnvelope(
        completed('test', [{ id: 'p1', name: 'Åsa Öberg', locale: 'sv-SE' }]),
        await loadSealer(padded),
      );
      const seal = extractSeal(sealed);
      expect(opensslVerify(seal.signedContent, seal.cms, 'embedded').ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('tells a certificate OpenSSL cannot read from one it can', () => {
    expect(readableCertificate(pair.certPem)).toBe(true);
    expect(readableCertificate(withPaddedSerial(pair.certPem))).toBe(false);
  });

  it('reads a PEM pair written on one line with literal \\n, as env files carry them', async () => {
    const oneLine = {
      keyPem: pair.keyPem.replace(/\n/g, '\\n'),
      certPem: pair.certPem.replace(/\n/g, '\\n'),
    };
    await expect(loadSealer(oneLine)).resolves.toMatchObject({ fingerprint: sealer.fingerprint });
  });
});

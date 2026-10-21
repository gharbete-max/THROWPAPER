import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { apply, draftEnvelope, type EnvelopeEvent } from '@tp/signing';
import { generateDevCertificate, loadSealer, type PemPair } from './certificate.js';
import { coversWholeFile, extractSeal, opensslVerify } from './openssl-validator.js';
import { verifySealNode } from './node-verifier.js';
import { sealEnvelope } from './seal.js';

/**
 * A sealed file is checked by two validators that share no code with the signer: OpenSSL (over the
 * CMS and the signed byte range) and `node-verifier.ts` (node:crypto and a DER walk, which also
 * insists the seal covers the whole file). Every way of changing the file after the seal must
 * fail the pair; the untouched file must pass both.
 */
const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString();

let pair: PemPair;
let sealed: Uint8Array;
let other: Uint8Array;

async function seal(name: string): Promise<Uint8Array> {
  const source = await PDFDocument.create();
  source.addPage([595.28, 841.89]).drawText(`Agreement ${name}`, { x: 72, y: 760, size: 18 });
  source.addPage([595.28, 841.89]).drawText('Second page', { x: 72, y: 760, size: 18 });
  const document = await source.save();
  const documentSha256 = createHash('sha256').update(document).digest('hex');
  let envelope = draftEnvelope({
    id: '6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11',
    documentName: name,
    documentSha256,
    routing: 'parallel',
    environment: 'production',
    expiresAt: at(59),
    parties: [{ id: 'p1', name: 'Anna', locale: 'en-GB', order: 1 }],
  });
  const events: EnvelopeEvent[] = [
    { type: 'sent', at: at(0) },
    {
      type: 'signed',
      at: at(10),
      partyId: 'p1',
      evidence: {
        method: 'typed',
        level: 'simple',
        environment: 'production',
        signedAt: at(10),
        documentSha256,
        declaration: { key: 'k', version: 1, text: '[placeholder]' },
        details: { typedName: 'Anna' },
      },
    },
  ];
  for (const event of events) {
    const result = apply(envelope, event);
    if (!result.ok) throw new Error(result.reason);
    envelope = result.envelope;
  }
  return sealEnvelope(
    {
      document,
      envelope,
      events,
      declaration: { key: 'k', version: 1 },
      trailSha256: 'd'.repeat(64),
      sealedAt: new Date(at(20)),
    },
    await loadSealer(pair),
  );
}

/** Both witnesses, and the file-coverage rule; the reason is the first that objects. */
function verdict(pdf: Uint8Array): { ok: boolean; reason: string } {
  const node = verifySealNode(pdf, pair.certPem);
  if (!node.ok) return { ok: false, reason: `node: ${node.reason}` };
  const seal = extractSeal(pdf);
  if (!coversWholeFile(pdf, seal.byteRange)) return { ok: false, reason: 'coverage' };
  const ssl = opensslVerify(seal.signedContent, seal.cms, pair.certPem);
  return ssl.ok ? { ok: true, reason: '' } : { ok: false, reason: `openssl: ${ssl.output}` };
}

beforeAll(async () => {
  pair = await generateDevCertificate();
  sealed = await seal('A');
  other = await seal('B');
});

describe('tampering with a sealed PDF', () => {
  it('passes both validators untouched', () => {
    expect(verdict(sealed)).toEqual({ ok: true, reason: '' });
  });

  it('fails a flipped byte in the first range, and in the last', () => {
    const { byteRange } = extractSeal(sealed);
    for (const target of [Math.floor(byteRange[1] / 2), sealed.length - 8]) {
      const copy = new Uint8Array(sealed);
      copy[target] = copy[target]! ^ 0x01;
      expect(verdict(copy).ok, `byte ${target}`).toBe(false);
      expect(verifySealNode(copy).ok).toBe(false);
    }
  });

  it('fails a flipped bit in the signature itself', () => {
    const { byteRange } = extractSeal(sealed);
    const copy = new Uint8Array(sealed);
    // Well inside the signature value, past the CMS header.
    copy[byteRange[1] + 200] = copy[byteRange[1] + 200]! ^ 0x10;
    expect(verdict(copy).ok).toBe(false);
  });

  it('fails an incremental update appended after the seal — which OpenSSL alone would accept', () => {
    const update = Buffer.from(
      '\n99 0 obj\n<< /Type /Annot /Subtype /FreeText /Contents (changed) >>\nendobj\ntrailer\n<< >>\n%%EOF\n',
    );
    const appended = new Uint8Array(Buffer.concat([sealed, update]));
    const seal = extractSeal(appended);
    // The proof that coverage must be checked: the signed bytes are all still there.
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
    expect(coversWholeFile(appended, seal.byteRange)).toBe(false);
    expect(verdict(appended).ok).toBe(false);
    expect(verifySealNode(appended).ok).toBe(false);
  });

  it('fails a truncated file, and one with a byte removed', () => {
    expect(verdict(sealed.subarray(0, sealed.length - 1)).ok).toBe(false);
    const removed = new Uint8Array([...sealed.subarray(0, 40), ...sealed.subarray(41)]);
    expect(verdict(removed).ok).toBe(false);
  });

  it('fails a replaced page and an altered audit page, even when the signature object survives', async () => {
    const replaced = await PDFDocument.load(sealed, { updateMetadata: false });
    replaced.removePage(0);
    replaced.insertPage(0).drawText('Another agreement', { x: 72, y: 760, size: 18 });
    const swapped = await replaced.save({ useObjectStreams: false });
    expect(Buffer.from(swapped).toString('latin1')).toContain('/ByteRange');
    expect(verdict(swapped).ok).toBe(false);

    const altered = await PDFDocument.load(sealed, { updateMetadata: false });
    const audit = altered.getPages().at(-1)!;
    audit.drawText('Signed by somebody else', {
      x: 60,
      y: 60,
      size: 12,
      font: await altered.embedFont(StandardFonts.Helvetica),
    });
    expect(verdict(await altered.save({ useObjectStreams: false })).ok).toBe(false);
  });

  it("fails another file's signature moved into this one", () => {
    const here = extractSeal(sealed);
    const there = extractSeal(other);
    const hex = Buffer.from(there.cms)
      .toString('hex')
      .padEnd(here.byteRange[2] - here.byteRange[1] - 2, '0');
    const text = Buffer.from(sealed).toString('latin1');
    const grafted = Buffer.from(
      text.slice(0, here.byteRange[1] + 1) + hex + text.slice(here.byteRange[2] - 1),
      'latin1',
    );
    expect(grafted.length).toBe(sealed.length);
    expect(verdict(new Uint8Array(grafted)).ok).toBe(false);
  });

  it('fails a second /ByteRange added to look like a second seal', () => {
    const forged = new Uint8Array(
      Buffer.concat([sealed, Buffer.from('\n% /ByteRange [0 1 2 3]\n')]),
    );
    expect(verifySealNode(forged).ok).toBe(false);
  });

  it('fails a seal checked against a certificate that did not make it', async () => {
    const stranger = await generateDevCertificate();
    expect(verifySealNode(sealed, stranger.certPem).ok).toBe(false);
    expect(verifySealNode(sealed).ok).toBe(true);
  });
});

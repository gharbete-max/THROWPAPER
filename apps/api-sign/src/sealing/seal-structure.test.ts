import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { apply, draftEnvelope, type EnvelopeEvent } from '@tp/signing';
import { generateDevCertificate, loadSealer, type PemPair } from './certificate.js';
import { coversWholeFile, extractSeal, opensslVerify } from './openssl-validator.js';
import { verifySealNode } from './node-verifier.js';
import { sealEnvelope } from './seal.js';

/**
 * A safety net for upgrading the sealing libraries (`@signpdf/*`, `asn1js`): the seal's structure
 * on a fixed input is frozen as a literal, captured from the code before the 4.x majors. The key and
 * certificate are random per run, so everything key-dependent (serial, hashes, signature bytes) is
 * left out; what is kept is what a validator reads: the signature dictionary, the byte range's
 * shape, and the CMS down to OIDs, versions and attribute order.
 */
const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString();

const names: Record<string, string> = {
  '1.2.840.113549.1.7.2': 'signedData',
  '1.2.840.113549.1.7.1': 'data',
  '1.2.840.113549.1.9.3': 'contentType',
  '1.2.840.113549.1.9.4': 'messageDigest',
  '1.2.840.113549.1.9.16.2.47': 'signingCertificateV2',
  '1.2.840.113549.1.9.5': 'signingTime',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSA',
};

interface Node {
  tag: number;
  start: number;
  body: number;
  end: number;
}
function read(buf: Uint8Array, at: number): Node {
  const first = buf[at + 1]!;
  let length = first;
  let body = at + 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + buf[at + 2 + i]!;
    body = at + 2 + count;
  }
  return { tag: buf[at]!, start: at, body, end: body + length };
}
function kids(buf: Uint8Array, node: Node): Node[] {
  const out: Node[] = [];
  for (let at = node.body; at < node.end;) {
    const child = read(buf, at);
    out.push(child);
    at = child.end;
  }
  return out;
}
function oid(buf: Uint8Array, node: Node): string {
  const bytes = buf.subarray(node.body, node.end);
  const parts = [Math.floor(bytes[0]! / 40), bytes[0]! % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  const dotted = parts.join('.');
  return names[dotted] ?? dotted;
}
const tag = (node: Node) => `0x${node.tag.toString(16)}`;

/** The CMS as the shape a validator walks: tags, OIDs, integers; no key-dependent bytes. */
function describeCms(cms: Uint8Array) {
  const info = read(cms, 0);
  const [type, wrapper] = kids(cms, info);
  const signedData = kids(cms, wrapper!)[0]!;
  const parts = kids(cms, signedData);
  const [version, digestAlgs, encap] = parts;
  const certificates = parts.find((part) => part.tag === 0xa0)!;
  const signer = kids(cms, kids(cms, parts.at(-1)!)[0]!);
  const attrsNode = signer.find((part) => part.tag === 0xa0)!;
  const attributes = kids(cms, attrsNode).map((attribute) => {
    const [t, values] = kids(cms, attribute);
    const value = kids(cms, values!)[0]!;
    return { type: oid(cms, t!), valueTag: tag(value) };
  });
  const sidNode = signer[1]!;
  return {
    contentType: oid(cms, type!),
    version: cms[version!.body],
    digestAlgorithms: kids(cms, digestAlgs!).map((alg) => oid(cms, kids(cms, alg)[0]!)),
    encapsulated: kids(cms, encap!).map((n) => (n.tag === 0x06 ? oid(cms, n) : tag(n))),
    certificateCount: kids(cms, certificates).length,
    signerInfoCount: kids(cms, parts.at(-1)!).length,
    signer: {
      version: cms[signer[0]!.body],
      sid: [tag(sidNode), ...kids(cms, sidNode).map(tag)],
      digestAlgorithm: oid(cms, kids(cms, signer[2]!)[0]!),
      signedAttributes: attributes,
      signatureAlgorithm: oid(cms, kids(cms, signer.at(-2)!)[0]!),
      signatureBytes: signer.at(-1)!.end - signer.at(-1)!.body,
      unsignedAttributes: signer.some((part) => part.tag === 0xa1),
    },
  };
}

function describePdf(pdf: Uint8Array) {
  const text = Buffer.from(pdf).toString('latin1');
  const typeAt = text.indexOf('/Type /Sig');
  const from = text.lastIndexOf('<<', typeAt);
  const dictionary = text
    .slice(from, text.indexOf('>>', text.indexOf('/Contents', typeAt) + 20) + 2)
    .replace(/<[0-9a-fA-F]+>/, '<hex>')
    .replace(/\/ByteRange\s*\[[^\]]*\]/, '/ByteRange [a b c d]')
    .replace(/\s+/g, ' ');
  const { byteRange } = extractSeal(pdf);
  return {
    dictionary,
    // Characters between the angle brackets: the placeholder reserved for the CMS.
    holeChars: byteRange[2] - byteRange[1] - 2,
    byteRangeStartsAtZero: byteRange[0] === 0,
    signatureFields: (text.match(/\/FT\s*\/Sig/g) ?? []).length,
    byteRanges: (text.match(/\/ByteRange/g) ?? []).length,
    sigFlags: /\/SigFlags\s+(\d+)/.exec(text)?.[1],
    pages: (text.match(/\/Type\s*\/Page\b/g) ?? []).length,
  };
}

let pair: PemPair;
let sealed: Uint8Array;

beforeAll(async () => {
  pair = await generateDevCertificate();
  const source = await PDFDocument.create();
  source.addPage([595.28, 841.89]).drawText('Hyresavtal', { x: 72, y: 760, size: 18 });
  const document = await source.save();
  const documentSha256 = createHash('sha256').update(document).digest('hex');
  let envelope = draftEnvelope({
    id: '6f1d7a52-3c1f-4b8e-9d7e-0a9d2c1e5b11',
    documentName: 'Hyresavtal 2026',
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
  sealed = await sealEnvelope(
    {
      document,
      envelope,
      events,
      declaration: { key: 'k', version: 1 },
      trailSha256: 'e'.repeat(64),
      sealedAt: new Date(at(20)),
    },
    await loadSealer(pair),
  );
});

describe('the seal on a fixed input', () => {
  it('verifies with both witnesses over the whole file', () => {
    expect(verifySealNode(sealed, pair.certPem)).toEqual({ ok: true });
    const seal = extractSeal(sealed);
    expect(coversWholeFile(sealed, seal.byteRange)).toBe(true);
    expect(opensslVerify(seal.signedContent, seal.cms, pair.certPem).ok).toBe(true);
  });

  it('keeps the signature dictionary exactly as the 3.x libraries wrote it', () => {
    expect(describePdf(sealed)).toMatchInlineSnapshot(`
      {
        "byteRangeStartsAtZero": true,
        "byteRanges": 1,
        "dictionary": "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [a b c d] /Contents <hex> /Reason (Sealed after signing) /M (D:20260924092000Z) /ContactInfo () /Name (Loppa Sign) /Location () /Prop_Build << /Filter << /Name /Adobe.PPKLite >>",
        "holeChars": 16384,
        "pages": 2,
        "sigFlags": "3",
        "signatureFields": 1,
      }
    `);
  });

  it('keeps the CMS structure exactly as the 3.x libraries wrote it', () => {
    expect(describeCms(extractSeal(sealed).cms)).toMatchInlineSnapshot(`
      {
        "certificateCount": 1,
        "contentType": "signedData",
        "digestAlgorithms": [
          "sha256",
        ],
        "encapsulated": [
          "data",
        ],
        "signer": {
          "digestAlgorithm": "sha256",
          "sid": [
            "0x30",
            "0x30",
            "0x2",
          ],
          "signatureAlgorithm": "sha256WithRSA",
          "signatureBytes": 384,
          "signedAttributes": [
            {
              "type": "contentType",
              "valueTag": "0x6",
            },
            {
              "type": "messageDigest",
              "valueTag": "0x4",
            },
            {
              "type": "signingCertificateV2",
              "valueTag": "0x30",
            },
          ],
          "unsignedAttributes": false,
          "version": 1,
        },
        "signerInfoCount": 1,
        "version": 1,
      }
    `);
  });

  it('still opens in pdfjs and pdf-lib, with the audit page after the document', async () => {
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2);
    const task = getDocument({ data: new Uint8Array(sealed) });
    const doc = await task.promise;
    expect(doc.numPages).toBe(2);
    const page = await doc.getPage(2);
    const content = await page.getTextContent();
    expect(content.items.map((item) => ('str' in item ? item.str : '')).join(' ')).toContain(
      'Anna',
    );
    await task.destroy();
  });
});

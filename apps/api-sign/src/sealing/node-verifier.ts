import { createHash, verify, X509Certificate } from 'node:crypto';

/**
 * A second, independent check of a sealed PDF, for tests: `node:crypto` and a few lines of DER
 * walking, sharing no code with the signer (which is pkijs and `@signpdf`). OpenSSL
 * (`openssl-validator.ts`) is the first witness; this is the second, and the stricter one about
 * what a seal must cover — OpenSSL happily verifies a file with an update appended after the seal,
 * because the signed bytes themselves are unchanged. A reader shows that as "changed since signing".
 *
 * Checks, in order: exactly one `/ByteRange`; it starts at 0 and ends at the last byte of the file
 * but for its own `<hex>` hole; the CMS is parsed down to its signed attributes; the message-digest
 * attribute equals SHA-256 of the covered bytes; the ESS signing-certificate-v2 attribute names the
 * embedded certificate; the RSA signature over the attributes verifies under that certificate; and,
 * when a trusted certificate is given, it is the one embedded.
 */
export type Verdict = { ok: true } | { ok: false; reason: string };

interface Node {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  body: number;
  end: number;
}

function read(buf: Uint8Array, at: number): Node {
  if (at + 2 > buf.length) throw new Error('truncated DER');
  const first = buf[at + 1]!;
  let length = first;
  let body = at + 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + buf[at + 2 + index]!;
    body = at + 2 + count;
  }
  if (body + length > buf.length) throw new Error('DER overruns its container');
  return { tag: buf[at]!, start: at, body, end: body + length };
}

function children(buf: Uint8Array, node: Node): Node[] {
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
  return parts.join('.');
}

const OID = {
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
} as const;

export function verifySealNode(pdf: Uint8Array, trustedCertPem?: string): Verdict {
  try {
    return check(pdf, trustedCertPem);
  } catch (error) {
    return { ok: false, reason: `unparseable: ${(error as Error).message}` };
  }
}

function check(pdf: Uint8Array, trustedCertPem?: string): Verdict {
  const text = Buffer.from(pdf).toString('latin1');
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (ranges.length !== 1) return { ok: false, reason: `${ranges.length} byte ranges` };
  const [a, b, c, d] = ranges[0]!.slice(1, 5).map(Number) as [number, number, number, number];
  if (a !== 0 || b >= c || c + d !== pdf.length) return { ok: false, reason: 'not the whole file' };
  const hole = text.slice(b, c);
  if (!/^<[0-9a-fA-F]+>$/.test(hole)) return { ok: false, reason: 'no signature hole' };

  const covered = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const cms = Buffer.from(hole.slice(1, -1), 'hex');

  const info = read(cms, 0);
  const signedData = children(cms, children(cms, info)[1]!)[0]!;
  const parts = children(cms, signedData);
  const certificates = parts.find((part) => part.tag === 0xa0);
  const signerInfos = parts.at(-1)!;
  if (!certificates || signerInfos.tag !== 0x31) return { ok: false, reason: 'no signer' };

  const certNode = children(cms, certificates)[0]!;
  const certDer = cms.subarray(certNode.start, certNode.end);
  const certificate = new X509Certificate(certDer);
  if (trustedCertPem && !certificate.raw.equals(new X509Certificate(trustedCertPem).raw)) {
    return { ok: false, reason: 'sealed by another certificate' };
  }

  const signer = children(cms, children(cms, signerInfos)[0]!);
  const attrsNode = signer.find((part) => part.tag === 0xa0);
  const signature = signer.at(-1)!;
  if (!attrsNode || signature.tag !== 0x04) return { ok: false, reason: 'no signed attributes' };

  const attributes = new Map<string, Node>();
  for (const attribute of children(cms, attrsNode)) {
    const [type, values] = children(cms, attribute);
    attributes.set(oid(cms, type!), children(cms, values!)[0]!);
  }
  const digest = attributes.get(OID.messageDigest);
  if (!attributes.has(OID.contentType) || !digest) return { ok: false, reason: 'attributes' };
  const claimed = cms.subarray(digest.body, digest.end);
  if (!createHash('sha256').update(covered).digest().equals(claimed)) {
    return { ok: false, reason: 'digest does not match the covered bytes' };
  }

  // SigningCertificateV2 ::= SEQ { SEQ OF ESSCertIDv2 { certHash OCTET STRING, ... } }
  const ess = attributes.get(OID.signingCertificateV2);
  if (!ess) return { ok: false, reason: 'no signing-certificate-v2' };
  const certId = children(cms, children(cms, ess)[0]!)[0]!;
  const certHash = children(cms, certId)[0]!;
  if (
    !createHash('sha256').update(certDer).digest().equals(cms.subarray(certHash.body, certHash.end))
  ) {
    return { ok: false, reason: 'ESS certificate hash' };
  }

  // The signature is over the attributes re-tagged from [0] IMPLICIT to SET OF (RFC 5652 §5.4).
  const signed = Buffer.from(cms.subarray(attrsNode.start, attrsNode.end));
  signed[0] = 0x31;
  const good = verify(
    'sha256',
    signed,
    certificate.publicKey,
    cms.subarray(signature.body, signature.end),
  );
  return good ? { ok: true } : { ok: false, reason: 'RSA signature' };
}

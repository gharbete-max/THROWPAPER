import { createHash, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

/**
 * The seal's key and certificate.
 *
 * **A development certificate proves one thing:** that the sealed file has not changed since it
 * was sealed. It says nothing about *who* sealed it — anybody can issue themselves one. What makes
 * a reader show a seal as trusted is an eIDAS qualified seal certificate and a qualified timestamp,
 * which are a purchase, not code (ADR 0009 § Sealing, `LAUNCH-CHECKLIST.md` §6). This module takes
 * whichever PEM pair it is given; the dev script and the tests hand it a self-issued one.
 */

// The global Web Crypto (Node's own), which pkijs also finds by itself: one engine for both, and
// one `CryptoKey` type whichever TypeScript program compiles this file.
const crypto = globalThis.crypto;

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export interface Sealer {
  key: CryptoKey;
  certificate: pkijs.Certificate;
  /** DER of the certificate, embedded in every seal and hashed into its ESS attribute. */
  certificateDer: Uint8Array;
  /** SHA-256 of the DER, lower-case hex — printed on the audit page so a reader can match it. */
  fingerprint: string;
  /** The certificate's common name. */
  name: string;
}

export interface PemPair {
  keyPem: string;
  certPem: string;
}

/**
 * A self-issued RSA certificate for development and tests. Never for a production seal: it is
 * named as a development certificate in its own subject, so nobody mistakes it for anything else.
 */
export async function generateDevCertificate(now = new Date()): Promise<PemPair> {
  const keys = (await crypto.subtle.generateKey(
    { ...ALGORITHM, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  )) as { publicKey: CryptoKey; privateKey: CryptoKey };

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({
    valueHex: randomSerial(),
  });
  const name = [
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3', // commonName
      value: new asn1js.Utf8String({ value: 'Loppa Sign development seal' }),
    }),
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.10', // organizationName
      value: new asn1js.Utf8String({ value: 'Development only — not a trusted seal' }),
    }),
  ];
  certificate.subject.typesAndValues = name;
  certificate.issuer.typesAndValues = name;
  certificate.notBefore.value = new Date(now.getTime() - 60_000);
  certificate.notAfter.value = new Date(now.getTime() + 2 * 365 * 24 * 3600 * 1000);

  // digitalSignature + nonRepudiation (contentCommitment): what a seal key is for, and no more.
  const usage = new asn1js.BitString({
    valueHex: new Uint8Array([0b1100_0000]).buffer,
    unusedBits: 6,
  });
  certificate.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.15',
      critical: true,
      extnValue: usage.toBER(false),
      parsedValue: usage,
    }),
  ];

  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, 'SHA-256');

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    keyPem: pem('PRIVATE KEY', new Uint8Array(pkcs8)),
    certPem: pem('CERTIFICATE', new Uint8Array(certificate.toSchema().toBER(false))),
  };
}

/**
 * Reads a PEM pair and proves the key belongs to the certificate before anything is sealed with
 * it: a mismatched pair would produce seals that every validator rejects, discovered only when
 * somebody finally checks one.
 */
export async function loadSealer(pair: PemPair): Promise<Sealer> {
  const certificateDer = unpem('CERTIFICATE', pair.certPem);
  const certificate = pkijs.Certificate.fromBER(certificateDer);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    unpem('PRIVATE KEY', pair.keyPem),
    ALGORITHM,
    false,
    ['sign'],
  );

  const probe = new TextEncoder().encode('loppa-sign key check');
  const signature = await crypto.subtle.sign(ALGORITHM, key, probe);
  const publicKey = await certificate.getPublicKey({
    algorithm: { algorithm: ALGORITHM, usages: ['verify'] },
  });
  if (!(await crypto.subtle.verify(ALGORITHM, publicKey, signature, probe))) {
    throw new Error('The seal key does not belong to the seal certificate');
  }

  const common = certificate.subject.typesAndValues.find((entry) => entry.type === '2.5.4.3');
  return {
    key,
    certificate,
    certificateDer,
    fingerprint: createHash('sha256').update(certificateDer).digest('hex'),
    name: common ? String(common.value.valueBlock.value) : 'seal',
  };
}

/**
 * A positive serial in minimal DER. Masking the first byte to `0x7f` alone kept it positive but
 * not minimal: a first byte of `0x00` before one below `0x80` is padding, which OpenSSL refuses
 * outright ("illegal padding"). One certificate in 256 could not be read, and every seal made with
 * it failed to verify. The top bits `01` put the first byte in `0x40`–`0x7f` — positive, never
 * padding — and leave 126 random bits.
 */
function randomSerial(): ArrayBuffer {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = (bytes[0]! & 0x3f) | 0x40;
  return bytes.buffer;
}

/**
 * Whether OpenSSL can read this certificate — which is what every validator of a seal made with it
 * uses. Node's `X509Certificate` is OpenSSL's own parser, so this is the same judgement in-process.
 */
export function readableCertificate(certPem: string): boolean {
  try {
    new X509Certificate(certPem);
    return true;
  } catch {
    return false;
  }
}

function pem(label: string, der: Uint8Array): string {
  const body = Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trim();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function unpem(label: string, text: string): Uint8Array<ArrayBuffer> {
  // Env files often carry PEMs on one line with literal "\n".
  const normalised = text.replace(/\\n/g, '\n');
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`).exec(
    normalised,
  );
  if (!match) throw new Error(`Not a PEM ${label}`);
  return new Uint8Array(Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64'));
}

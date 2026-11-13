import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { Sealer } from './certificate.js';
import type { Timestamper } from './timestamp.js';

const OID = {
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStampToken: '1.2.840.113549.1.9.16.2.14',
} as const;

/**
 * A detached CMS SignedData over `content` — the PAdES baseline (ETSI EN 319 142-1, B-B) shape.
 *
 * Signed attributes are content-type, message-digest and ESS signing-certificate-v2, which binds
 * the signature to *this* certificate so another with the same key cannot be substituted. There
 * is deliberately **no signing-time attribute**: PAdES puts the claimed time in the signature
 * dictionary's `/M` instead, and a baseline validator rejects both.
 *
 * With a `timestamper` the signature also carries an RFC 3161 token over its own value, as the
 * unsigned signature-time-stamp attribute (PAdES B-T, ADR 0028): a time the computer's clock cannot
 * fake. If none can be had, this throws `TimestampUnavailable` and the caller seals without.
 */
export async function signDetached(
  content: Uint8Array,
  sealer: Sealer,
  timestamper?: Timestamper,
): Promise<Uint8Array> {
  const digest = createHash('sha256').update(content).digest();
  const certHash = createHash('sha256').update(sealer.certificateDer).digest();

  // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
  // ESSCertIDv2 ::= SEQUENCE { certHash OCTET STRING, issuerSerial IssuerSerial }  (sha256 default)
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 4 }, // [4] directoryName
            value: [sealer.certificate.issuer.toSchema()],
          }),
        ],
      }),
      sealer.certificate.serialNumber,
    ],
  });
  const signingCertificateV2 = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [new asn1js.OctetString({ valueHex: toBuffer(certHash) }), issuerSerial],
          }),
        ],
      }),
    ],
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: sealer.certificate.issuer,
          serialNumber: sealer.certificate.serialNumber,
        }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({
              type: OID.contentType,
              values: [new asn1js.ObjectIdentifier({ value: OID.data })],
            }),
            new pkijs.Attribute({
              type: OID.messageDigest,
              values: [new asn1js.OctetString({ valueHex: toBuffer(digest) })],
            }),
            new pkijs.Attribute({ type: OID.signingCertificateV2, values: [signingCertificateV2] }),
          ],
        }),
      }),
    ],
    certificates: [sealer.certificate],
  });

  await signedData.sign(sealer.key, 0, 'SHA-256');

  if (timestamper) {
    const signerInfo = signedData.signerInfos[0]!;
    const imprint = createHash('sha256')
      .update(new Uint8Array(signerInfo.signature.valueBlock.valueHexView))
      .digest();
    const token = await timestamper.stamp(new Uint8Array(imprint));
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [
        new pkijs.Attribute({
          type: OID.signatureTimeStampToken,
          values: [asn1js.fromBER(toBuffer(token)).result],
        }),
      ],
    });
  }

  const info = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(info.toSchema().toBER(false));
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

import { randomBytes } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

const SHA256 = '2.16.840.1.101.3.4.2.1';

/** Where a seal's independent time comes from (ADR 0028). */
export interface Timestamper {
  /** Printed on the audit page: who vouches for the time. */
  name: string;
  /** A TimeStampToken (DER ContentInfo) over this SHA-256 imprint, or a throw. */
  stamp(imprint: Uint8Array): Promise<Uint8Array>;
}

/**
 * DigiCert's public timestamp service: free, no account, and run by a CA that every major
 * validator already knows. Only a hash leaves the computer, never the document (ADR 0028).
 */
export const DEFAULT_TSA = { name: 'DigiCert', url: 'http://timestamp.digicert.com' } as const;

/** Thrown when no timestamp could be had; the seal then falls back to the computer's clock. */
export class TimestampUnavailable extends Error {}

/**
 * An RFC 3161 client. It asks for a token over the imprint with a fresh nonce, and accepts the
 * answer only if it is granted and the token states that same imprint and nonce: a reply for
 * anything else is refused, never embedded. Offline, it fails fast, within `timeoutMs`.
 */
export function rfc3161(
  tsa: { name: string; url: string },
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Timestamper {
  const doFetch = options.fetch ?? fetch;
  return {
    name: tsa.name,
    async stamp(imprint) {
      const nonce = randomBytes(8);
      nonce[0] = nonce[0]! & 0x7f; // a positive INTEGER
      const request = new pkijs.TimeStampReq({
        version: 1,
        messageImprint: new pkijs.MessageImprint({
          hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256 }),
          hashedMessage: new asn1js.OctetString({ valueHex: copy(imprint) }),
        }),
        nonce: new asn1js.Integer({ valueHex: copy(nonce) }),
        certReq: true,
      });
      let body: ArrayBuffer;
      try {
        const response = await doFetch(tsa.url, {
          method: 'POST',
          headers: { 'content-type': 'application/timestamp-query' },
          body: new Uint8Array(request.toSchema().toBER(false)),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.arrayBuffer();
      } catch (error) {
        throw new TimestampUnavailable(`${tsa.url}: ${(error as Error).message}`);
      }
      return checkedToken(body, imprint, nonce);
    },
  };
}

/** The token from a TimeStampResp, once its status, imprint and nonce are what was asked. */
export function checkedToken(der: ArrayBuffer, imprint: Uint8Array, nonce: Uint8Array): Uint8Array {
  let response: pkijs.TimeStampResp;
  let info: pkijs.TSTInfo;
  try {
    response = pkijs.TimeStampResp.fromBER(der);
    const status = response.status.status;
    if ((status !== 0 && status !== 1) || !response.timeStampToken)
      throw new Error(`status ${status}`);
    const signed = new pkijs.SignedData({ schema: response.timeStampToken.content });
    const content = signed.encapContentInfo.eContent;
    if (!content) throw new Error('no TSTInfo');
    info = pkijs.TSTInfo.fromBER(content.getValue());
  } catch (error) {
    throw new TimestampUnavailable(`unreadable reply: ${(error as Error).message}`);
  }
  const stated = new Uint8Array(info.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (info.messageImprint.hashAlgorithm.algorithmId !== SHA256 || !same(stated, imprint)) {
    throw new TimestampUnavailable('the token is for another hash');
  }
  const echoed = info.nonce ? new Uint8Array(info.nonce.valueBlock.valueHexView) : null;
  if (!echoed || !same(stripZeros(echoed), stripZeros(nonce))) {
    throw new TimestampUnavailable('the token does not carry our nonce');
  }
  return new Uint8Array(response.timeStampToken!.toSchema().toBER(false));
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function stripZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  return bytes.subarray(i);
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

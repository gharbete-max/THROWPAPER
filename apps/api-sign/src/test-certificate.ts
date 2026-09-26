/**
 * For tests: a copy of a development certificate whose serial starts with a padding byte — `0x00`
 * before a byte below `0x80` — as one in 256 made before `randomSerial` kept serials minimal.
 * OpenSSL refuses to read such a certificate.
 *
 * Only the two serial bytes change, so the signature no longer matches; nothing here needs it to,
 * since OpenSSL refuses the certificate while parsing, before any signature is checked.
 */
export function withPaddedSerial(certPem: string): string {
  const der = Buffer.from(certPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  // TBSCertificate: `[0] { INTEGER 2 }` (the version), then `INTEGER` of 16 bytes (the serial).
  const at = der.indexOf(Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02, 0x02, 0x10]));
  if (at < 0) throw new Error('not a certificate with a 16-byte serial');
  der[at + 7] = 0x00;
  der[at + 8] = 0x05;
  const body = der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trim();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

/**
 * SHA-256 of a document, as lower-case hex — the value every signature in an envelope is bound to.
 *
 * Web Crypto, because it is the one digest that exists unchanged in the browser, in Node 20+ and in
 * a Capacitor WebView (ADR 0014), so the hash a signer's page shows and the hash the server seals
 * are computed by the same function. No dependency, and nothing to keep in step.
 */
interface SubtleDigest {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

export async function documentSha256(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleDigest } }).crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is not available here, so a document cannot be hashed');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

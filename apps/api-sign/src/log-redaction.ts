/**
 * Keeping signing links out of the log. The link *is* the credential: whoever holds
 * `/v1/sign/<token>` can sign as that party, and `/v1/sealed/<token>` downloads the sealed file.
 *
 * By route, not by shape (api-forms matches long alphanumeric runs). A Sign token's MAC is
 * base64url, whose `-` and `_` break such a run, so a shape rule can let one through; and Sign's
 * credential-bearing routes are few and fixed. The whole segment goes, envelope id and all.
 */
const CREDENTIAL_SEGMENT = /(\/(?:api\/)?(?:v1\/sign|v1\/sealed|s))\/[^/?#]+/g;

export function redactSigningLinks(url: string): string {
  return url.replace(CREDENTIAL_SEGMENT, '$1/[redacted]');
}

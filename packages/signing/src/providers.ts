import type { Environment, SignatureLevel, SigningMethod } from './model.js';

/**
 * The two seams, as types only (ADR 0010).
 *
 * Implementations hold client secrets and certificates, so they live in `apps/api-sign` and never
 * here — this package ships to the browser. `environment` is on every provider and every result,
 * so a test identity can never produce something that looks like production.
 */

/** A national eID, through a broker: who somebody is, and a signature over a hash they approved. */
export interface IdentityProvider {
  /** `idura`, `signicat`, `console`. Recorded verbatim. */
  readonly name: string;
  readonly environment: Environment;
  /** The schemes this provider can offer, as `eid:<scheme>` methods — `eid:bankid-se`, `eid:mitid`. */
  readonly methods: readonly SigningMethod[];
  /** Sign a document hash. `visibleText` is the human-authored declaration, shown in the eID app. */
  sign(request: SignHashRequest): Promise<IdentitySession>;
  /** Poll a session. The result carries what the scheme asserted, as it asserted it. */
  result(sessionRef: string): Promise<IdentityResult>;
}

export interface SignHashRequest {
  method: SigningMethod;
  documentSha256: string;
  visibleText: string;
  locale: string;
  /** Where the eID app sends the signer back, for a same-device flow. */
  returnUrl?: string;
  /** Retries must not start a second session against the same document. */
  idempotencyKey: string;
}

export interface IdentitySession {
  reference: string;
  /** Same-device: open this. Other-device: render it as a QR. Never both invented. */
  launchUrl?: string;
  status: 'pending' | 'complete' | 'failed' | 'cancelled';
}

export interface IdentityResult {
  reference: string;
  status: IdentitySession['status'];
  environment: Environment;
  /** Present only when complete. Capped by `maxLevelFor(method)` before it is ever stored. */
  level?: SignatureLevel;
  method?: SigningMethod;
  /** The scheme's own assertion, unnormalised — a broker swap must not lose what an auditor asks for. */
  assertion?: Record<string, string>;
}

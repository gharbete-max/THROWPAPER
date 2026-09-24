import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  CreateEnvelopeResponse,
  EnvelopeStatusResponse,
  SealedDocumentResponse,
  type CreateEnvelopeRequest,
} from '@tp/shared/contract';

/**
 * Forms' side of CONTRACT §5 — Sign is another product, reached over HTTP with a service token
 * and nothing else (CLAUDE.md rule 1). Every answer is parsed with the contract's own schema, so a
 * Sign that drifts from the contract fails here, loudly, rather than as an `undefined` downstream.
 */
export interface SignConnection {
  /** api-sign's base URL, e.g. `http://127.0.0.1:47018` on the desktop. */
  apiUrl: string;
  /** The service token Sign issued to this organisation. */
  serviceToken: string;
}

export class SignUnavailable extends Error {}

export interface SignClient {
  create(request: CreateEnvelopeRequest): Promise<CreateEnvelopeResponse>;
  status(envelopeId: string): Promise<EnvelopeStatusResponse>;
  /** The sealed PDF's bytes, fetched through the §5.3 short-lived link. */
  sealed(envelopeId: string): Promise<{ bytes: Uint8Array; sha256: string } | null>;
  /** §5.4: does this raw body carry Sign's signature for our token? */
  verifyHook(rawBody: string, header: string | undefined): boolean;
}

export function createSignClient(
  connection: SignConnection,
  fetchImpl: typeof fetch = fetch,
): SignClient {
  const base = connection.apiUrl.replace(/\/$/, '');
  const headers = {
    authorization: `Bearer ${connection.serviceToken}`,
    'content-type': 'application/json',
  };
  // Sign keeps only the token's hash, and signs hooks with it (`api-sign/src/envelopes/hooks.ts`).
  const hookKey = createHash('sha256').update(connection.serviceToken).digest('hex');

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new SignUnavailable(`Sign did not answer: ${(error as Error).message}`);
    }
  }

  async function body(response: Response): Promise<unknown> {
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (parsed as { error?: { code?: string } } | null)?.error?.code ?? 'error';
      throw new SignRefused(response.status, code);
    }
    return parsed;
  }

  return {
    async create(request) {
      const response = await call('/v1/envelopes', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return CreateEnvelopeResponse.parse(await body(response));
    },
    async status(envelopeId) {
      const response = await call(`/v1/envelopes/${encodeURIComponent(envelopeId)}`);
      return EnvelopeStatusResponse.parse(await body(response));
    },
    async sealed(envelopeId) {
      const response = await call(`/v1/envelopes/${encodeURIComponent(envelopeId)}/sealed`);
      if (response.status === 409) return null;
      const link = SealedDocumentResponse.parse(await body(response));
      const file = await fetchImpl(link.url, { signal: AbortSignal.timeout(60_000) });
      if (!file.ok) throw new SignRefused(file.status, 'sealed-download');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // The link's answer names the hash; a file that does not match it is not the sealed file.
      if (sha256 !== link.sealedSha256) throw new SignRefused(502, 'sealed-hash-mismatch');
      return { bytes, sha256 };
    },
    verifyHook(rawBody, header) {
      if (!header?.startsWith('sha256=')) return false;
      const expected = Buffer.from(
        `sha256=${createHmac('sha256', hookKey).update(rawBody).digest('hex')}`,
      );
      const given = Buffer.from(header);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}

export class SignRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Sign answered ${status} ${code}`);
  }
}

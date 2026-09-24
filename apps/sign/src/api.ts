import type { SignatureVector } from '@tp/shared/forms';

/**
 * The signer's side of api-sign (`routes/signer.ts`). The page calls `/api/...`: Vite proxies it
 * in development, and api-sign strips the prefix itself when it serves this page (rule 3 — the
 * page is a client of documented endpoints, nothing else).
 */
export interface SignerView {
  envelopeId: string;
  documentName: string;
  documentSha256: string;
  environment: 'test' | 'production';
  status: 'draft' | 'sent' | 'completed' | 'declined' | 'expired' | 'cancelled';
  party: {
    id: string;
    name: string;
    locale: string;
    status: 'waiting' | 'invited' | 'viewed' | 'signed' | 'declined';
  };
  maySign: boolean;
  declaration: { key: string; version: number; text: string };
}

export type SignBody =
  { typedName: string } | { drawn: Extract<SignatureVector, { kind: 'drawn' }> };

export type Result = { ok: true; view: SignerView } | { ok: false; status: number; code: string };

const base = (token: string) => `/api/v1/sign/${encodeURIComponent(token)}`;

async function answer(response: Response): Promise<Result> {
  if (response.ok) return { ok: true, view: (await response.json()) as SignerView };
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { ok: false, status: response.status, code: body?.error?.code ?? 'error' };
}

export function openLink(token: string): Promise<Result> {
  return fetch(base(token)).then(answer);
}

export function signWith(token: string, body: SignBody): Promise<Result> {
  return fetch(base(token), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(answer);
}

export function decline(token: string): Promise<Result> {
  return fetch(`${base(token)}/decline`, { method: 'POST' }).then(answer);
}

export function documentHref(token: string): string {
  return `${base(token)}/document`;
}

/** `/s/<token>` → the token; anything else is not a signing link. */
export function tokenFromPath(pathname: string): string | null {
  const match = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

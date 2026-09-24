import { createHmac } from 'node:crypto';
import type { SigningHookEvent } from '@tp/shared/contract';

/**
 * CONTRACT §5.4 — Sign tells the caller what happened, one POST per event, after it is committed.
 *
 * **Signed with the token's hash.** Sign keeps service tokens only as SHA-256 hashes, so it cannot
 * sign with the token itself; it signs with the hash, which only Sign and the token's holder can
 * compute. The header is `x-loppa-signature: sha256=<hex HMAC-SHA256(key = sha256hex(token), body)>`.
 * A caller recomputes it over the raw body and refuses a mismatch.
 *
 * **Best effort, and the caller must not depend on it.** A hook can be lost — the caller down, a
 * network gone. §5.2 is the truth; a hook only says "look now". So delivery retries a few times
 * and then gives up with a log line, rather than holding a queue that has to survive restarts.
 *
 * No redirects (an allowed origin must not be able to bounce Sign elsewhere), a short timeout, and
 * the URL was checked against the token's allowed origins when the envelope was created.
 */
export interface HookDelivery {
  deliver(input: { hookUrl: string; tokenSha256: string; events: SigningHookEvent[] }): void;
}

export function hookSignature(tokenSha256: string, body: string): string {
  return `sha256=${createHmac('sha256', tokenSha256).update(body).digest('hex')}`;
}

export function createHookDelivery(options: {
  fetch: typeof fetch;
  log: (message: string, detail?: Record<string, unknown>) => void;
  /** Waits between attempts, in milliseconds. Tests pass zeros. */
  backoff?: number[];
}): HookDelivery & { idle(): Promise<void> } {
  const backoff = options.backoff ?? [1_000, 5_000, 30_000];
  // One chain per hook URL, so a caller receives an envelope's events in the order they happened.
  const chains = new Map<string, Promise<void>>();

  async function post(hookUrl: string, tokenSha256: string, event: SigningHookEvent) {
    const body = JSON.stringify(event);
    for (let attempt = 0; attempt <= backoff.length; attempt += 1) {
      try {
        const response = await options.fetch(hookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-loppa-signature': hookSignature(tokenSha256, body),
          },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return;
        // A 4xx other than 408/429 will not get better by asking again.
        if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
      } catch {
        // Network error or timeout: retry below.
      }
      const wait = backoff[attempt];
      if (wait === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    options.log('signing hook not delivered', {
      envelopeId: event.envelopeId,
      event: event.event,
      origin: new URL(hookUrl).origin,
    });
  }

  return {
    deliver({ hookUrl, tokenSha256, events }) {
      const previous = chains.get(hookUrl) ?? Promise.resolve();
      const next = events.reduce(
        (chain, event) => chain.then(() => post(hookUrl, tokenSha256, event)),
        previous,
      );
      chains.set(hookUrl, next);
      void next.finally(() => {
        if (chains.get(hookUrl) === next) chains.delete(hookUrl);
      });
    },
    async idle() {
      while (chains.size) await Promise.all([...chains.values()]);
    },
  };
}

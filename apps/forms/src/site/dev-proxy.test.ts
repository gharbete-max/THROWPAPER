import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the dev server must hand to the API rather than answer itself.
 *
 * This is the third time the same shape of bug has been found by opening a page rather than by a
 * failing test, and the first two both ended with an invoice titled "Formwork":
 *
 * 1. The service worker answered `/i/` from its precache. Fixed, and guarded by
 *    `service-worker-scope.test.ts`.
 * 2. A CSP of `font-src 'self'` blocked the print font embedded as a `data:` URI.
 * 3. This one: Vite's SPA fallback answered `/i/` in development, because only `/api` was
 *    proxied. The invoice link on the Invoices screen returned the app shell.
 *
 * All three share a failure mode: `200 text/html`, no error anywhere, and a page that is simply
 * the wrong document. Nothing detects that except a person looking, so the rule is written down
 * here instead.
 *
 * Read as text rather than imported: `vite.config.ts` pulls in the PWA plugin and the React
 * plugin, and a test that has to construct those to read one object is a test that breaks for
 * reasons that have nothing to do with the proxy.
 */
const CONFIG = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

describe('the dev server proxy', () => {
  /**
   * Every path the API serves to a browser directly, rather than through the app's own fetches.
   *
   * `/api` is the app talking to its backend. `/i` is a document a tenant opens by URL — and the
   * PDF beside it, which lives under the same prefix.
   */
  it.each([
    ['/api', "the app's own API calls"],
    ['/i/', 'public invoices, and their PDFs'],
  ])('proxies %s (%s)', (prefix) => {
    expect(CONFIG).toContain(`'${prefix}':`);
  });

  /**
   * The trailing slash on `/i/`, which is the whole difference between working and not.
   *
   * Vite matches proxy keys as plain prefixes, so `/i` captures `/invoices` — the app's own
   * screen — and `/icon-192.png` with it. Writing it without the slash sent the Invoices page to
   * the API, which answered `Route GET:/invoices not found`. Asserting the absence of the bare
   * key is the only way to catch somebody "tidying" the slash away.
   */
  it('scopes the invoice proxy so it cannot swallow /invoices', () => {
    expect(CONFIG).toContain("'/i/':");
    expect(CONFIG).not.toMatch(/'\/i':/);
  });

  /**
   * Both servers, not just the one somebody was using at the time.
   *
   * `server` is `pnpm dev` and `pnpm demo`; `preview` is what the e2e suite drives. A proxy added
   * to one and not the other passes locally and fails in CI, or the reverse — which is worse,
   * because then it fails only in front of somebody being shown the product.
   */
  it('gives the dev server and the preview server the same proxy', () => {
    const uses = CONFIG.match(/proxy: DEV_PROXY/g) ?? [];
    expect(uses).toHaveLength(2);
  });

  /** The tenant's URL is the real one, so `/i/` is passed through with no rewrite. */
  it('does not rewrite the public invoice path', () => {
    expect(CONFIG).toMatch(/'\/i\/': \{ target: API_ORIGIN \}/);
  });
});

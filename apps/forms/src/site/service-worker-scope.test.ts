import { describe, expect, it } from 'vitest';
import { SERVER_RENDERED_PATHS, SITE_ROUTES } from './routes.js';

/**
 * The service worker must not answer for pages the server builds.
 *
 * Its navigation fallback serves the precached `index.html` for any URL, which is exactly what the
 * door screen needs on a venue's bad wifi and exactly wrong for the public site. It was winning
 * silently: a returning visitor to a feature page got the shell, so the server render never
 * happened, the tab said "Formwork" instead of the page's own title, and React was fetched to draw
 * a page that would otherwise have arrived complete. Only crawlers — which run no worker — ever
 * saw the server-rendered version.
 *
 * The two lists have to agree, which is the failure this file exists to prevent: adding a page to
 * `SITE_ROUTES` and not to the denylist gives it back to the precache, and nothing else notices.
 */
describe('what the service worker may serve from cache', () => {
  it('lets the network answer for every page the server renders', () => {
    for (const route of SITE_ROUTES) {
      expect(
        SERVER_RENDERED_PATHS.some((pattern) => pattern.test(route)),
        `${route} is server-rendered but the worker would answer it from the precache`,
      ).toBe(true);
    }
  });

  /**
   * Every path the server renders per URL, not only the ones somebody remembered.
   *
   * `/i/` was missed when invoices arrived, and the symptom was an invoice page titled "Formwork"
   * because the worker answered with the precached shell. Listing them here means adding a
   * server-rendered surface without adding it to the denylist fails a test rather than shipping.
   */
  it.each([
    ['/f/varmotet', 'a public form, whose preview card the server injects per slug'],
    ['/i/de120100000000000000000000000000', 'an invoice, rendered per token'],
  ])('covers %s (%s)', (path) => {
    expect(SERVER_RENDERED_PATHS.some((pattern) => pattern.test(path))).toBe(true);
  });

  /**
   * The fallback has to survive for the app, or this fix trades one bug for a worse one: the check
   * -in screen is the reason the worker exists.
   */
  it.each(['/checkin', '/forms', '/events', '/brand', '/login'])(
    'leaves %s to the precache, so it opens offline',
    (appRoute) => {
      expect(SERVER_RENDERED_PATHS.some((pattern) => pattern.test(appRoute))).toBe(false);
    },
  );
});

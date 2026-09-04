import { FEATURES } from './content.js';
import { LEGAL_DOCUMENTS } from './legal.js';

/**
 * Which URLs the public site owns.
 *
 * One list, imported by three things that must agree: the server decides whether to render, the
 * client decides whether to hydrate the site or mount the app, and the sitemap is generated from
 * it. Two of those living apart is how a page ends up server-rendered and then replaced by a
 * client-rendered blank.
 */
export const SITE_ROUTES: readonly string[] = [
  '/',
  ...FEATURES.map((feature) => `/features/${feature.slug}`),
  ...LEGAL_DOCUMENTS.map((document) => `/${document.slug}`),
];

export function isSiteRoute(path: string): boolean {
  // Trailing slashes are the same page; anything else is the app's.
  const normal = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return SITE_ROUTES.includes(normal);
}

/**
 * The URLs the service worker must fetch rather than answer from its precache.
 *
 * The worker precaches `index.html` and serves it for any navigation, which is right for the app —
 * that is how the door screen opens on a venue's bad wifi — and wrong for everything the *server*
 * builds per URL. It was quietly winning: a returning visitor to a feature page got the precached
 * shell, so the server render never happened, the page title was the generic one from the shell,
 * and React was downloaded to draw a page that would have arrived finished.
 *
 * Two kinds of URL belong here. Site pages, whose markup and `<title>` and social card are all
 * built for that path. And `/f/:slug`, where the server injects the form's own link preview — and
 * which cannot work offline regardless, because the answers it needs come from the API.
 *
 * `verify` keeps this honest against `SITE_ROUTES`, so a new page cannot be added to one and
 * forgotten in the other.
 */
export const SERVER_RENDERED_PATHS: readonly RegExp[] = [
  /*
   * Derived, not restated.
   *
   * This was a hand-written list of three patterns beside a hand-written list of routes, which is
   * the shape of every drift bug in this codebase: adding a page to one and forgetting the other
   * hands it back to the precache, and nothing anywhere says so. Building it from `SITE_ROUTES`
   * removes the possibility rather than testing for it.
   */
  ...SITE_ROUTES.map((route) => new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
  /* Not a site route: the server renders these per slug to give each form its own preview card. */
  /^\/f\//,
];

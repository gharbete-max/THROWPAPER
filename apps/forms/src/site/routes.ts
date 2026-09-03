import { FEATURES } from './content.js';

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
];

export function isSiteRoute(path: string): boolean {
  // Trailing slashes are the same page; anything else is the app's.
  const normal = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return SITE_ROUTES.includes(normal);
}

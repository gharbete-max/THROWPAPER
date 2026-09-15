/**
 * `robots.txt` and `sitemap.xml`, derived from the site's own route list.
 *
 * Neither file existed: both answered 404, as JSON, from the API's not-found handler. The comment
 * at the top of `apps/forms/src/site/routes.ts` has said "the sitemap is generated from it" since
 * that list was written — this is the half that was missing.
 *
 * Derived rather than written out, for the reason the route list itself is derived: the site
 * publishes 12 pages in 5 languages, and a hand-maintained list of 60 URLs is correct until
 * somebody adds the sixth language.
 */

/**
 * Pages that exist, work, and should not be in an index.
 *
 * `/contact/sent` is the thank-you page. It is a real address — the contact form posts and
 * redirects to it, which is what makes the no-JS contact page possible — but it says "thank you,
 * we will be in touch" and nothing else. In an index it is a result that answers no query and, if
 * somebody follows it from one, a page that implies they sent something they did not.
 */
const NOT_FOR_INDEXING = ['/contact/sent'];

export function isIndexable(route: string): boolean {
  return !NOT_FOR_INDEXING.some((suffix) => route === suffix || route.endsWith(suffix));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The sitemap, as absolute URLs against the deployment's own origin.
 *
 * A sitemap must use absolute URLs, and the origin is `APP_URL` rather than the request's `Host`
 * — the same value the canonical tags and the `hreflang` set are built from. Taking it from the
 * request would let a sitemap fetched through a preview hostname advertise that hostname as
 * canonical for every page on the site.
 *
 * **No `<xhtml:link>` alternates, deliberately.** Google accepts the translation set either in the
 * page head or in the sitemap, and `entry-server.tsx` already emits a complete reciprocal set on
 * every page including `x-default`. Repeating it here would be a second place for the same fact to
 * live, and the failure mode of the two disagreeing is worse than the benefit of stating it twice.
 *
 * No `<lastmod>` either: there is no per-page modification date to tell the truth with, and a
 * date stamped at request time would say every page changed this morning — which is worse than
 * silence, because a crawler believes it until it stops believing any of them.
 */
export function buildSitemap(routes: readonly string[], origin: string): string {
  const site = origin.replace(/\/$/, '');
  const urls = routes
    .filter(isIndexable)
    .map((route) => `  <url>\n    <loc>${escapeXml(`${site}${route}`)}</loc>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * The paths a crawler is asked to leave alone.
 *
 * Every one of these is a screen behind the sign-in. They answer 200 with the app shell, because
 * that is what a client-rendered route has to do — so to a crawler they are a dozen pages of
 * identical empty markup, and crawl budget spent on them is crawl budget not spent on the site.
 *
 * `/f/` is **not** here. A published form is a customer's public registration page, and whether it
 * should be findable is their decision and the product owner's, not a default this file gets to
 * make quietly. `/i/` is not here either: an invoice already refuses indexing through an
 * `X-Robots-Tag` header on the response, which is the stronger statement of the two — `robots.txt`
 * asks a crawler not to look, while the header tells it not to index what it has already seen.
 */
const DISALLOWED = [
  '/api/',
  '/v1/',
  '/demo/',
  '/auth/',
  '/login',
  '/events',
  '/forms',
  '/responses',
  '/users',
  '/invoices',
  '/brand',
];

/**
 * Whether a path is one of those screens, for the `X-Robots-Tag` on the response.
 *
 * The two halves say different things and are both worth saying. `robots.txt` asks a crawler not
 * to fetch these; it does not stop one indexing the URL it found on somebody else's page, because
 * a crawler that is not allowed to look is also not allowed to read the header telling it not to
 * index. Sending `noindex` on the response covers the case where it arrives anyway — a link from
 * outside, or a crawler that ignores `robots.txt` — and the two together are what actually keeps a
 * sign-in screen out of a search results page.
 *
 * Prefix matching, the same rule `robots.txt` uses, so `/events/some-id/check-in` is covered by
 * `/events`. No site route begins with any of these: the site owns `/`, `/features/…` and the
 * policy pages, and `/features/forms` starts with `/features/` rather than `/forms`.
 */
export function isPrivatePath(pathname: string): boolean {
  return DISALLOWED.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * `robots.txt`, permissive by default and pointing at the sitemap.
 *
 * Written from a list rather than kept as a file so that the `Sitemap:` line carries this
 * deployment's own origin. A checked-in file would have to name one host, and this product is
 * meant to be deployable as somebody else's.
 *
 * There is no `Disallow: /` here and there never was one to leave behind — this repository has
 * never had a `robots.txt` at all, which is the other way to get the same outcome by accident.
 */
/**
 * `llms.txt` — what this site is, for something reading it rather than indexing it.
 *
 * The convention (llmstxt.org) is a short Markdown file at the root: a heading, a summary, and the
 * pages worth reading. It is a description, not a permission — deciding whether AI crawlers may
 * read this site at all is a `robots.txt` question and the owner's to answer, and nothing here
 * grants or withholds anything.
 *
 * Built from the site's own `<title>` and `<meta name="description">` rather than a second copy of
 * them written out here. Those are already the one place the product says what it is, they are
 * already translated, and a hand-written summary beside them is a third description to keep true.
 *
 * Only the pages in the default language are listed. The file itself is English prose, and a
 * reader that wants Swedish is better served by the `hreflang` set on the page than by sixty-five
 * URLs in one list.
 */
export function buildLlmsTxt(input: {
  title: string;
  description: string;
  routes: readonly string[];
  origin: string;
}): string {
  const site = input.origin.replace(/\/$/, '');
  const pages = input.routes
    .filter(isIndexable)
    .map((route) => `- [${route}](${site}${route})`)
    .join('\n');

  return [
    `# ${input.title}`,
    '',
    `> ${input.description}`,
    '',
    '## Pages',
    '',
    pages,
    '',
    '## Notes',
    '',
    /*
     * Worth stating plainly, because both are things a reader would otherwise have to discover by
     * requesting them: the application is not public, and a form belongs to whoever published it.
     */
    '- The signed-in application is not public. Everything under /events, /forms, /responses,',
    '  /users, /invoices and /brand requires an account and is served as an empty shell.',
    '- A published form lives at /f/<slug> and belongs to the organisation that published it,',
    '  not to this site.',
    '- Machine-readable API description: ' + `${site}/openapi.json`,
    '',
  ].join('\n');
}

export function buildRobots(origin: string): string {
  const site = origin.replace(/\/$/, '');
  return [
    'User-agent: *',
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
}

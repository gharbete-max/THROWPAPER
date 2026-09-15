import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { Site } from './site/Site.js';
import { FEATURE_SLUGS, type SiteCopy } from './site/content.js';
import { SITE_PAGES } from './site/routes.js';
import { copyFor } from './site/copy/index.js';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES, localePath, splitLocale } from './site/locale.js';

/**
 * The public site, rendered to HTML on the server.
 *
 * Only this tree. The app is behind a bearer token in `localStorage`, fetches a session and a
 * brand kit before it can draw anything, and is read by one person who is already signed in —
 * there is no crawler to serve and no first paint to win, and rendering it here would mean
 * teaching the server to be signed in as somebody.
 *
 * These pages are a pure function of `content.ts`: no session, no fetch, no state. That is what
 * makes `renderToString` on them honest rather than a trick that produces a shell.
 */
export interface Rendered {
  html: string;
  /**
   * Everything for the document head: title, description, canonical, the social card, and the
   * token block.
   *
   * The palette was a third field the caller only ever wrapped in a `<style>` tag. One string of
   * head content is one thing to splice in, and the tag belongs with the tags.
   */
  head: string;
  /**
   * The BCP 47 tag for `<html lang>`, which the caller must set.
   *
   * Returned rather than left to the template because the language is now decided per URL, and a
   * German page announcing itself as English is the defect that has already been fixed twice in
   * this product — once for transactional email, once for the public form. A screen reader reads
   * German words with English phonetics and nothing on screen looks wrong.
   */
  lang: string;
  /**
   * 200, or 404 for an address the site does not have.
   *
   * The not-found page is rendered like any other — same chrome, the visitor's language — and the
   * one thing that must differ is the status, or a crawler indexes "There is no page here" as a
   * page and a monitor never learns the link on the brochure is dead.
   */
  status: 200 | 404;
}

/**
 * What each page calls itself, kept beside the routes it describes rather than in a template.
 *
 * Takes the *page* — the path with its language already stripped — so one rule serves all of them
 * rather than the match having to know about prefixes.
 */
function metaFor(page: string, copy: SiteCopy): { title: string; description: string } {
  const slug = FEATURE_SLUGS.find((entry) => page === `/features/${entry}`);
  if (slug) {
    const feature = copy.features[slug];
    return { title: `${feature.name}${copy.meta.titleSuffix}`, description: feature.summary };
  }
  if (!SITE_PAGES.includes(page)) {
    return {
      title: `${copy.notFound.title}${copy.meta.titleSuffix}`,
      description: copy.notFound.body,
    };
  }
  return { title: copy.meta.homeTitle, description: copy.meta.homeDescription };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function render(path: string, origin: string): Rendered {
  /*
   * The language comes off the front of the URL before anything else looks at it.
   *
   * `page` is what the router matches and what `metaFor` describes; `locale` decides every word on
   * it. Splitting here rather than inside `Site` keeps the head and the body reading the same two
   * values, which is what stops a German page being served with an English `<title>` — the exact
   * class of bug that already produced an invoice titled "Paloppa" twice.
   */
  const { locale, path: page } = splitLocale(path);
  const copy = copyFor(locale);
  const meta = metaFor(page, copy);
  const site = origin.replace(/\/$/, '');
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const canonical = escapeAttribute(`${site}${path}`);
  const image = escapeAttribute(`${site}/icon-512.png`);

  const html = renderToString(
    /*
     * `basename` carries the language, so every `<Route>` in `Site` is written unprefixed once.
     * Without it each route would need twelve spellings and the twelfth would be the one missed.
     */
    <StaticRouter location={path} basename={localePath(locale)}>
      <Site locale={locale} />
    </StaticRouter>,
  );

  /**
   * `hreflang` for every language this page exists in, including itself.
   *
   * Search engines treat translations as duplicates unless told otherwise, and the pair of rules
   * they want is unintuitive: each alternate must be listed on *every* version including the one
   * being served, and the set must be reciprocal. Generating all of them from `SITE_LOCALES`
   * satisfies both by construction — a hand-written list is reciprocal until somebody adds the
   * thirteenth language.
   *
   * `x-default` points at English, which is what an unprefixed URL serves and what somebody whose
   * language the site does not publish in should land on.
   */
  const alternates = SITE_LOCALES.map(
    (option) =>
      `<link rel="alternate" hrefLang="${option}" href="${escapeAttribute(
        `${site}${localePath(option, page)}`,
      )}" />`,
  ).join('\n    ');

  const head = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    alternates,
    `<link rel="alternate" hrefLang="x-default" href="${escapeAttribute(
      `${site}${localePath(SITE_DEFAULT_LOCALE, page)}`,
    )}" />`,
    `<meta property="og:type" content="website" />`,
    /*
     * The product's name, not the page's. `og:title` is already the page — for a feature page the
     * two differ, and without this a shared link is attributed to whatever that page happened to be
     * called rather than to Paloppa.
     */
    `<meta property="og:site_name" content="Paloppa" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:locale" content="${escapeAttribute(locale.replace('-', '_'))}" />`,
    `<meta name="twitter:card" content="summary" />`,
    /**
     * The palette inline, not fetched.
     *
     * `main.tsx` injects this at runtime, which is right for the app: it is replaced by the
     * organisation's own kit a moment later. A visitor to the site has no organisation, so waiting
     * for JavaScript to paint the colours would mean a flash of unstyled text on the one page
     * whose whole job is the first impression.
     */
    `<style>${toThemedCssBlock(defaultTokens)}</style>`,
  ].join('\n    ');

  return { html, head, lang: locale, status: SITE_PAGES.includes(page) ? 200 : 404 };
}

export { SITE_ROUTES, SITE_PAGES, isSiteRoute, isSiteShaped } from './site/routes.js';
export { SITE_LOCALES, SITE_DEFAULT_LOCALE, localePath, splitLocale } from './site/locale.js';

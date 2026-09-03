import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { Site } from './site/Site.js';
import { FEATURES } from './site/content.js';

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
  /** Tags for the document head — title, description, canonical, the social card. */
  head: string;
  /** The token block, so the first paint is already branded rather than flashing default. */
  styles: string;
}

interface PageMeta {
  title: string;
  description: string;
}

/** What each page calls itself, kept beside the routes it describes rather than in a template. */
function metaFor(path: string): PageMeta {
  const feature = FEATURES.find((entry) => path === `/features/${entry.slug}`);
  if (feature) {
    return { title: `${feature.name} — Formwork`, description: feature.summary };
  }
  return {
    title: 'Formwork — forms, registrations and the door',
    description:
      'A form builder for organisations that have to get it right: twelve languages, your brand on every surface, and an admission card that scans at a door.',
  };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function render(path: string, origin: string): Rendered {
  const meta = metaFor(path);
  const url = `${origin.replace(/\/$/, '')}${path}`;
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const canonical = escapeAttribute(url);
  const image = escapeAttribute(`${origin.replace(/\/$/, '')}/icon-512.png`);

  const html = renderToString(
    <StaticRouter location={path}>
      <Site />
    </StaticRouter>,
  );

  const head = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');

  /**
   * The palette inline, not fetched.
   *
   * `main.tsx` injects this at runtime, which is right for the app — it is replaced by the
   * organisation's own kit a moment later. A visitor to the site has no organisation, so waiting
   * for JavaScript to paint the colours would mean a flash of unstyled text on the one page whose
   * whole job is the first impression.
   */
  return { html, head, styles: toThemedCssBlock(defaultTokens) };
}

export { SITE_ROUTES, isSiteRoute } from './site/routes.js';

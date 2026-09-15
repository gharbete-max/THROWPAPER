import { describe, expect, it } from 'vitest';
import { buildRobots, buildSitemap, isIndexable, isPrivatePath } from './sitemap.js';

/**
 * Both files answered 404 before this — as JSON, from the API's not-found handler — which is what
 * a search engine got when it asked what it was allowed to read and what there was to read.
 */
const ROUTES = [
  '/',
  '/features/ledger',
  '/privacy',
  '/contact',
  '/contact/sent',
  '/sv',
  '/sv/features/ledger',
  '/sv/contact',
  '/sv/contact/sent',
];

describe('the sitemap', () => {
  const xml = buildSitemap(ROUTES, 'https://loppa.example');

  it('is a well-formed urlset', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  it('lists every page as an absolute URL', () => {
    expect(xml).toContain('<loc>https://loppa.example/</loc>');
    expect(xml).toContain('<loc>https://loppa.example/features/ledger</loc>');
    expect(xml).toContain('<loc>https://loppa.example/privacy</loc>');
  });

  /** A translation is a page, not a duplicate — the head already says how they relate. */
  it('includes the other languages', () => {
    expect(xml).toContain('<loc>https://loppa.example/sv</loc>');
    expect(xml).toContain('<loc>https://loppa.example/sv/features/ledger</loc>');
  });

  /**
   * The thank-you page says "we will be in touch" and nothing else. In an index it is a result
   * that answers no query, and following it from one implies you sent something you did not.
   */
  it('leaves the contact confirmation out, in every language', () => {
    expect(xml).not.toContain('/contact/sent');
    // …but the contact page itself is a real page and stays.
    expect(xml).toContain('<loc>https://loppa.example/contact</loc>');
    expect(xml).toContain('<loc>https://loppa.example/sv/contact</loc>');
  });

  it('does not invent a lastmod', () => {
    // A date stamped at request time would tell a crawler every page changed this morning.
    expect(xml).not.toContain('lastmod');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildSitemap(['/'], 'https://loppa.example/')).toContain(
      '<loc>https://loppa.example/</loc>',
    );
  });

  it('escapes a character that would otherwise break the document', () => {
    expect(buildSitemap(['/search?a=1&b=2'], 'https://loppa.example')).toContain('&amp;b=2');
  });
});

describe('deciding what belongs in an index', () => {
  it.each(['/', '/privacy', '/sv/features/ledger'])('keeps %s', (route) => {
    expect(isIndexable(route)).toBe(true);
  });

  it.each(['/contact/sent', '/sv/contact/sent', '/de/contact/sent'])('drops %s', (route) => {
    expect(isIndexable(route)).toBe(false);
  });
});

describe('robots.txt', () => {
  const robots = buildRobots('https://loppa.example');

  it('points at the sitemap on this deployment’s own origin', () => {
    expect(robots).toContain('Sitemap: https://loppa.example/sitemap.xml');
  });

  it('applies to every crawler', () => {
    expect(robots).toContain('User-agent: *');
  });

  /**
   * These are screens behind the sign-in. They answer 200 with the app shell, because that is what
   * a client-rendered route does — so to a crawler they are a dozen pages of identical empty
   * markup.
   */
  it.each(['/login', '/events', '/forms', '/responses', '/users', '/invoices', '/brand', '/v1/'])(
    'keeps a crawler out of %s',
    (path) => {
      expect(robots).toContain(`Disallow: ${path}`);
    },
  );

  /**
   * The one that must not be there. A published form is a customer's public registration page, and
   * whether it should be findable is their decision — not a default this file makes quietly.
   */
  it('does not block published forms', () => {
    expect(robots).not.toContain('Disallow: /f/');
  });

  /**
   * The leftover from a staging deployment that quietly removes a site from every search engine.
   * There has never been one here, which is worth a test rather than a memory.
   */
  it('does not disallow everything', () => {
    expect(robots).not.toMatch(/^Disallow: \/$/m);
  });
});

/**
 * The other half of the same statement. `robots.txt` asks a crawler not to fetch; this refuses
 * indexing for one that arrives anyway, via a link from outside or by ignoring `robots.txt`.
 *
 * Built from the same list, so the two cannot drift apart and say different things about a path.
 */
describe('refusing to be indexed', () => {
  it.each(['/login', '/events', '/forms', '/responses', '/users', '/invoices', '/brand'])(
    'marks %s private',
    (path) => {
      expect(isPrivatePath(path)).toBe(true);
    },
  );

  /** Prefix matching, the same rule `robots.txt` uses. */
  it.each(['/events/some-id/check-in', '/forms/abc/submissions', '/users/123'])(
    'marks the deeper path %s private too',
    (path) => {
      expect(isPrivatePath(path)).toBe(true);
    },
  );

  /**
   * The site's own pages must never pick this up. `/features/forms` is the one that would catch a
   * naive `includes` — it contains "forms" but begins with `/features/`.
   */
  it.each([
    '/',
    '/features/forms',
    '/features/ledger',
    '/privacy',
    '/contact',
    '/sv',
    '/sv/contact',
  ])('leaves the public page %s indexable', (path) => {
    expect(isPrivatePath(path)).toBe(false);
  });

  /**
   * A published form is a customer's public registration page. It is absent from the disallow
   * list on purpose, and it must be absent from this too, or the header would quietly undo that.
   */
  it('leaves a published form indexable', () => {
    expect(isPrivatePath('/f/varmotet')).toBe(false);
  });
});

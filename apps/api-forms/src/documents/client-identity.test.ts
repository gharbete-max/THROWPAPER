import { describe, expect, it } from 'vitest';
import { accentTile, withClientIdentity } from './client-identity.js';

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Loppa</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="alternate icon" href="/icon-192.png" type="image/png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
  </head>
  <body><div id="root"></div></body>
</html>`;

const IDENTITY = {
  wordmark: 'Acme Förening',
  poweredBy: true,
  logoLight: `/public/assets/${'a'.repeat(64)}.png`,
  logoDark: `/public/assets/${'b'.repeat(64)}.png`,
  palette: ':root {\n  --tp-colour-primary: #123456;\n}\n',
  favicon: `/public/assets/${'a'.repeat(64)}.png`,
  touchIcon: `/public/assets/${'a'.repeat(64)}.png`,
};

/**
 * A white-labelled app, in the first bytes rather than after a round trip.
 *
 * The sign-in screen is the case that cannot be solved anywhere else: nobody is authenticated
 * there, so there is no session to hang a brand kit off and no request that would answer the
 * question. Without this the page has no way to know whose product it is, and shows ours.
 */
describe('a white-labelled shell', () => {
  it('carries the identity the corner needs before any fetch', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    expect(html).toContain('name="tp-client-mode" content="1"');
    expect(html).toContain('Acme F&ouml;rening'.replace('&ouml;', 'ö'));
    expect(html).toContain(IDENTITY.logoLight);
    expect(html).toContain(IDENTITY.logoDark);
  });

  /**
   * The flag is separate from the name because they answer different questions.
   *
   * A customer may turn client mode on without setting a wordmark and fall back to their
   * organisation's own name. The corner has to know the mode is on before it knows what to write,
   * and inferring the mode from "is there a name" would leave it showing our mark.
   */
  it('states the mode even when the name is the organisation’s own', () => {
    const html = withClientIdentity(SHELL, { ...IDENTITY, wordmark: 'Bara Namn' });
    expect(html).toContain('name="tp-client-mode" content="1"');
    expect(html).toContain('Bara Namn');
  });

  /** The line is on by default, so only a contract that bought silence puts a tag in the page. */
  it('states only when the "Powered by" line is off', () => {
    expect(withClientIdentity(SHELL, IDENTITY)).not.toContain('tp-powered-by');
    expect(withClientIdentity(SHELL, { ...IDENTITY, poweredBy: false })).toContain(
      'name="tp-powered-by" content="0"',
    );
  });

  /** A missing dark logo emits no tag at all, rather than an empty one the client must sift. */
  it('omits a logo it does not have', () => {
    const html = withClientIdentity(SHELL, { ...IDENTITY, logoDark: null });
    expect(html).toContain('tp-logo-light');
    expect(html).not.toContain('tp-logo-dark');
  });

  /**
   * The tab, too.
   *
   * A white-labelled product whose browser tab says "Loppa" is white-labelled everywhere except
   * the one place the customer looks at all day.
   */
  it('renames the tab', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    expect(html).toContain('<title>Acme Förening</title>');
    expect(html).not.toContain('<title>Loppa</title>');
  });

  /** The palette is inlined and marked, so the client knows not to paint the defaults over it. */
  it('paints the page before React starts, and says so', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    expect(html).toContain('--tp-colour-primary: #123456');
    expect(html).toContain('<style data-tp-brand="server">');
    expect(html.indexOf('data-tp-brand')).toBeLessThan(html.indexOf('</head>'));
  });

  /**
   * A wordmark is customer text and lands in an attribute and in the title.
   *
   * `escapeAttribute` is what stops a quote closing the `content` attribute early, and the schema
   * caps the length — but nothing there refuses a quote, because a company name may legitimately
   * contain one and the right place to handle it is the escape rather than the validation.
   */
  it('escapes a name that would otherwise break out', () => {
    const html = withClientIdentity(SHELL, {
      ...IDENTITY,
      wordmark: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

/**
 * The tab, which is the one slot where a customer's own asset is often the worse answer.
 *
 * A wordmark two hundred pixels wide and sixty tall is a perfectly good logo and an illegible 32px
 * icon. The decision is made from the file's header rather than hoped about, and the fallback is a
 * field of their brand colour — which is more identifiable in a strip of tabs than a detailed mark
 * reduced to four grey pixels.
 */
describe('the icons a white-labelled tab shows', () => {
  it('replaces our icons rather than joining them', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    expect(html, 'our favicon survived').not.toContain('/favicon.svg');
    expect(html, 'our bitmap fallback survived').not.toContain('/icon-192.png');
    expect(html).toContain(`href="${IDENTITY.favicon}"`);
  });

  /**
   * Both `rel` forms, including the `alternate icon` for browsers that want a bitmap.
   *
   * A browser given two `rel="icon"` links picks by its own rules rather than ours, so leaving one
   * behind shows either brand depending on the browser — which works on the machine of whoever
   * tested it and fails somewhere else.
   */
  it('leaves no icon link of ours behind', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    const ours = [...html.matchAll(/<link rel="(?:alternate )?(?:icon|apple-touch-icon)"[^>]*>/g)];
    expect(ours).toHaveLength(2);
    for (const [tag] of ours) expect(tag).toContain('/public/assets/');
  });

  /** A tile is a data URI, so there is nothing to store and nothing to serve. */
  it('falls back to a tile in their colour', () => {
    const tile = accentTile('#ef8874');
    expect(tile.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(tile)).toContain('#ef8874');
    expect(decodeURIComponent(tile)).toContain('<svg');

    const html = withClientIdentity(SHELL, { ...IDENTITY, favicon: tile });
    expect(html).toContain('data:image/svg+xml');
  });

  /** No logo at all means no touch icon tag, rather than one pointing at nothing. */
  it('omits the home-screen icon when there is no logo', () => {
    const html = withClientIdentity(SHELL, { ...IDENTITY, touchIcon: null });
    expect(html).not.toContain('apple-touch-icon');
    // The tab still gets something: the tile does not depend on a logo existing.
    expect(html).toContain('rel="icon"');
  });
});

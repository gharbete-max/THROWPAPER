import { describe, expect, it } from 'vitest';
import { withClientIdentity } from './client-identity.js';

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Paloppa</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const IDENTITY = {
  wordmark: 'Acme Förening',
  logoLight: `/public/assets/${'a'.repeat(64)}.png`,
  logoDark: `/public/assets/${'b'.repeat(64)}.png`,
  palette: ':root {\n  --tp-colour-primary: #123456;\n}\n',
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

  /** A missing dark logo emits no tag at all, rather than an empty one the client must sift. */
  it('omits a logo it does not have', () => {
    const html = withClientIdentity(SHELL, { ...IDENTITY, logoDark: null });
    expect(html).toContain('tp-logo-light');
    expect(html).not.toContain('tp-logo-dark');
  });

  /**
   * The tab, too.
   *
   * A white-labelled product whose browser tab says "Paloppa" is white-labelled everywhere except
   * the one place the customer looks at all day.
   */
  it('renames the tab', () => {
    const html = withClientIdentity(SHELL, IDENTITY);
    expect(html).toContain('<title>Acme Förening</title>');
    expect(html).not.toContain('<title>Paloppa</title>');
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

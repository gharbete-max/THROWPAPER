import { describe, expect, it } from 'vitest';
import { escapeAttribute, withLinkPreview } from './link-preview.js';

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Loppa</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const PREVIEW = {
  title: 'Spring meeting registration',
  organisation: 'Demo AB',
  url: 'https://forms.example/f/varmotet',
  image: 'https://forms.example/icon-512.png',
  locale: 'sv-SE',
  palette: ':root {\n  --tp-colour-primary: #123456;\n}\n',
};

describe('a shared form link', () => {
  it('carries the form’s own title rather than the product name', () => {
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html).toContain('<meta property="og:title" content="Spring meeting registration" />');
    expect(html).toContain('<meta property="og:site_name" content="Demo AB" />');
    // The tab too: twelve tabs all saying "Loppa" identify nothing.
    expect(html).toContain('<title>Spring meeting registration — Demo AB</title>');
  });

  it('is in the form’s language, not the build’s', () => {
    expect(withLinkPreview(SHELL, PREVIEW)).toContain('<html lang="sv-SE"');
    expect(withLinkPreview(SHELL, PREVIEW)).not.toContain('<html lang="en"');
  });

  it('gives an absolute url and image, because a crawler has no page to resolve against', () => {
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html).toContain('content="https://forms.example/f/varmotet"');
    expect(html).toContain('content="https://forms.example/icon-512.png"');
    expect(html).toContain('<link rel="canonical" href="https://forms.example/f/varmotet" />');
  });

  it('leaves the app’s own head alone', () => {
    // The tags are added to the shipped document rather than replacing it, so the script tags,
    // icons and viewport keep coming from one place.
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('<div id="root"></div>');
  });

  /**
   * A form title is written by a customer, and goes straight into an attribute value.
   *
   * `"` is the character that matters: one in a title would close the attribute early and the rest
   * of the title would become markup. It is not a hypothetical — `Anmälan till "Vårmötet"` is an
   * ordinary way to write a name.
   */
  it('escapes a title that would otherwise break out of the attribute', () => {
    const html = withLinkPreview(SHELL, {
      ...PREVIEW,
      title: 'Anmälan till "Vårmötet" <script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;Vårmötet&quot;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the five characters that matter and nothing else', () => {
    expect(escapeAttribute('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
    // Ampersand first, or the escapes escape each other.
    expect(escapeAttribute('&lt;')).toBe('&amp;lt;');
  });
});

/**
 * The organisation's colours are in the bytes, which is the whole point of rendering this here.
 *
 * A form wears the brand of whoever published it. Until the palette was inlined it arrived only
 * after the page had fetched itself, so a respondent opening somebody's registration page saw
 * *our* colours first and theirs a moment later — the most visible way a white-label promise
 * fails, and invisible in every screenshot taken after the load.
 */
describe('the palette a form arrives in', () => {
  it('is inlined, so the first paint is already the organisation’s', () => {
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html).toContain('--tp-colour-primary: #123456');
    expect(html).toContain('data-tp-brand="server"');
  });

  /**
   * Last in the head, because the app's stylesheet ships the defaults compiled into it.
   *
   * A block placed before that one loses to it and the page paints in the product's colours with
   * the organisation's sitting inert above — which looks exactly like having done nothing.
   */
  it('comes after the tags, so it decides the first paint', () => {
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html.indexOf('data-tp-brand')).toBeGreaterThan(html.indexOf('og:title'));
    expect(html.indexOf('data-tp-brand')).toBeLessThan(html.indexOf('</head>'));
  });

  /**
   * The marker is load-bearing, not decoration.
   *
   * `PublicForm` reads it to decide whether to paint the defaults while it waits for the form.
   * Without the attribute it paints them, and the page blinks from the organisation's colours to
   * ours and back — the flash this change removes, reintroduced by the half of it that is missing.
   */
  it('marks itself so the client knows not to paint over it', () => {
    expect(withLinkPreview(SHELL, PREVIEW)).toMatch(/<style data-tp-brand="server">/);
  });
});

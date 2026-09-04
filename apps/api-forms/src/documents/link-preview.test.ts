import { describe, expect, it } from 'vitest';
import { escapeAttribute, withLinkPreview } from './link-preview.js';

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Formwork</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const PREVIEW = {
  title: 'Spring meeting registration',
  organisation: 'Demo AB',
  url: 'https://forms.example/f/varmotet',
  image: 'https://forms.example/icon-512.png',
  locale: 'sv-SE',
};

describe('a shared form link', () => {
  it('carries the form’s own title rather than the product name', () => {
    const html = withLinkPreview(SHELL, PREVIEW);
    expect(html).toContain('<meta property="og:title" content="Spring meeting registration" />');
    expect(html).toContain('<meta property="og:site_name" content="Demo AB" />');
    // The tab too: twelve tabs all saying "Formwork" identify nothing.
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

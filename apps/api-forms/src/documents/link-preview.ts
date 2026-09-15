/**
 * What a form's link looks like when somebody pastes it somewhere.
 *
 * The whole distribution model of this product is "send people a link". That link went into Slack,
 * WhatsApp, iMessage, Teams and LinkedIn and previewed as **"Loppa"** with no title, no
 * organisation and no picture — because the container serves the built `index.html` for every
 * client route, and that file is written once at build time and says the same thing for every URL.
 *
 * The people this matters to never see the app. They see a card in a chat window and decide from
 * it whether the link is worth opening, or whether it is a phishing attempt: an unlabelled link to
 * a domain they do not recognise, asking for their name and email, is a reasonable thing to
 * distrust.
 *
 * ## Why this is server-side and cannot be done in React
 *
 * None of those crawlers run JavaScript. Meta tags added after hydration are added after the
 * crawler has already read the document and gone. The tags have to be in the bytes the server
 * sends, which is why this rewrites the HTML rather than living in `PublicForm.tsx`.
 *
 * ## What it deliberately does not say
 *
 * No description. A form has a title and nothing else written by a person that would serve as one,
 * and inventing a sentence — "Fill in this form" — would be putting words in an organisation's
 * mouth in a language nobody chose. The organisation's name goes in `og:site_name`, which is what
 * that property is for, and the card is complete without a paragraph.
 */

export interface LinkPreview {
  /** The form's title, in the form's own default language. */
  title: string;
  organisation: string;
  /** Canonical, absolute — a relative URL in `og:url` is ignored by most crawlers. */
  url: string;
  /** Absolute too, and optional: an organisation with no logo gets the product's own mark. */
  image: string;
  /** BCP-47, for the `lang` attribute on the served document. */
  locale: string;
  /**
   * The organisation's palette, compiled, for the first paint.
   *
   * A form wears the brand of the organisation that published it, and until this existed that
   * brand arrived only after the page had fetched itself: the document painted in *our* colours
   * and swapped to theirs a moment later. `PublicForm.tsx` said so out loud — "the worst case is a
   * brief flash of the wrong palette rather than of no palette" — which was the right call given
   * the choice, and the point of putting the palette in the bytes is that there is no longer a
   * choice to make.
   *
   * Safe to interpolate into a `<style>` element because the token schema is the boundary that
   * makes it safe: colours are hex-validated and `FontStack` rejects quotes, angle brackets,
   * semicolons and braces, so no value here can close the element. `resolveTokens` re-parses the
   * stored row rather than trusting it, so that holds for kits written by older versions too.
   */
  palette: string;
}

/** `&`, `<`, `>` and both quotes — this text goes into attribute values written by customers. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The built `index.html`, with a real preview for this one form.
 *
 * Written as a string rewrite of the shipped file rather than a template of its own, so the app's
 * script tags, icons and viewport keep coming from one place. A second copy of the document shell
 * is a second thing to forget when the first one changes.
 */
export function withLinkPreview(html: string, preview: LinkPreview): string {
  const title = escapeAttribute(preview.title);
  const organisation = escapeAttribute(preview.organisation);
  const url = escapeAttribute(preview.url);
  const image = escapeAttribute(preview.image);
  const locale = escapeAttribute(preview.locale);

  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:site_name" content="${organisation}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    // `summary` rather than `summary_large_image`: the picture is a logo or a product mark, and a
    // small square logo blown across a wide card looks like a mistake.
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<link rel="canonical" href="${url}" />`,
  ].join('\n    ');

  /*
   * Last in the head, so it wins.
   *
   * `index.html` carries no palette of its own, but the app's stylesheet does arrive with the
   * defaults compiled in; a block appended at the end of the head is the one that decides the
   * first paint. The marker attribute is what `PublicForm` looks for to know the page is already
   * wearing the right colours and that it must not paint the defaults over them.
   */
  const palette = `<style data-tp-brand="server">${preview.palette}</style>`;

  return (
    html
      // The document is in the form's language, not the build's.
      .replace(/<html lang="[^"]*"/, `<html lang="${locale}"`)
      /**
       * The tab title too, not only the card.
       *
       * Somebody who opens the link and leaves it in a background tab has the same problem as
       * somebody reading the preview: twelve tabs all saying "Loppa" identify nothing.
       */
      .replace(/<title>[^<]*<\/title>/, `<title>${title} — ${organisation}</title>`)
      .replace(/<\/head>/, `  ${tags}\n    ${palette}\n  </head>`)
  );
}

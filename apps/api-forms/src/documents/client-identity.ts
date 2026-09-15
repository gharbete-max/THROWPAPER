import { escapeAttribute } from './link-preview.js';

/**
 * A white-labelled app, in the bytes the server sends.
 *
 * Client mode replaces our mark and our name with the customer's, and until this existed it did so
 * *after* the page had fetched its brand kit. So the one thing white-label is bought to prevent was
 * exactly what happened on every load: Loppa's mark and Loppa's name in the corner of somebody
 * else's product, for as long as a round trip takes, on a connection nobody controls.
 *
 * The sign-in screen is worse than the shell, and it is why this cannot be solved on the client at
 * all. Nobody is authenticated there, so there is no session to hang a brand kit off and no fetch
 * that would answer the question — the page has no way to know whose product it is. Only the server
 * does.
 *
 * ## Meta tags rather than a script
 *
 * The obvious shape is `<script>window.__brand = {…}</script>`, and it would be blocked. The CSP
 * here is a real `script-src 'self'` rather than the aspiration it usually is — the app has no CDN
 * and no external origins, which is what makes it achievable — so an inline script is refused by
 * the browser and the page silently keeps its default branding. Meta tags need no exception.
 *
 * ## Which organisation
 *
 * `organisations.first()`, because `OrganisationRepository` says in its own comment that v0.1 is
 * single-organisation and that this is how a request finds "the" org. The same call already backs
 * the public form's preview card. When a second customer is onboarded this becomes a host lookup —
 * a white-label customer arrives on their own domain, which is the identifier this needs and does
 * not yet have. Recorded as audit item 17 rather than invented here.
 */
export interface ClientIdentity {
  /** What the corner and the tab say. Never empty: the caller falls back to the org's own name. */
  wordmark: string;
  /** Whether the sign-in screen carries the "Powered by" line. A contract can buy its absence. */
  poweredBy: boolean;
  logoLight: string | null;
  logoDark: string | null;
  /** The organisation's compiled palette, light and dark, for the first paint. */
  palette: string;
  /**
   * What goes in the browser tab.
   *
   * A logo when it is square enough to survive being 32 pixels wide, and a tile in the accent when
   * it is not. See `logoSuitsAFavicon`: this is the one slot where a customer's own asset is often the
   * worse answer, and the decision is made from the file's own header rather than hoped about.
   */
  favicon: string;
  /**
   * The home-screen icon, which is always their logo when they have one.
   *
   * **A known limitation, raised rather than hidden.** iOS does not letterbox an apple-touch-icon;
   * it fills the square. A logo that is not square is therefore stretched on somebody's home
   * screen, and there is no markup that prevents it — the fix is compositing the logo onto a tile
   * server-side, which needs an image library this product does not have and should not grow for
   * one icon. Until then a wide wordmark is distorted here, and the customer can see that the
   * moment they add it.
   */
  touchIcon: string | null;
}

/**
 * A tile in the customer's accent, as an SVG data URI.
 *
 * The fallback when a logo cannot be a favicon, and it is a real answer rather than a shrug: at 16
 * pixels a solid field of somebody's brand colour is more identifiable in a strip of tabs than a
 * detailed mark reduced to four grey pixels. It is the same reasoning that gives our own mark a
 * separately drawn reduced version.
 *
 * Inline rather than a file because there is nothing to store — it is nine elements of markup — and
 * `imgSrc` already permits `data:` for the admission card's QR code. The rounded corner matches the
 * one the icon script gives our own tile, so the two look like they came from the same product.
 */
export function accentTile(accent: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${accent}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The built `index.html`, wearing the customer's identity.
 *
 * A string rewrite of the shipped file for the same reason `withLinkPreview` is one: the app's
 * script tags, icons and viewport keep coming from one place, and a second copy of the document
 * shell is a second thing to forget when the first one changes.
 */
export function withClientIdentity(html: string, identity: ClientIdentity): string {
  const wordmark = escapeAttribute(identity.wordmark);

  const tags = [
    /*
     * `1` rather than the name, because the flag and the name answer different questions. A
     * customer may set client mode with no wordmark of their own and fall back to the organisation
     * name, and the corner has to know the mode is on before it knows what to write.
     */
    `<meta name="tp-client-mode" content="1" />`,
    `<meta name="tp-wordmark" content="${wordmark}" />`,
    // Only its absence is stated: the default is on, and a page with no tag behaves as default.
    identity.poweredBy ? '' : `<meta name="tp-powered-by" content="0" />`,
    identity.logoLight
      ? `<meta name="tp-logo-light" content="${escapeAttribute(identity.logoLight)}" />`
      : '',
    identity.logoDark
      ? `<meta name="tp-logo-dark" content="${escapeAttribute(identity.logoDark)}" />`
      : '',
    /*
     * The icons, replacing the shipped ones rather than joining them.
     *
     * `index.html` already links our favicon and our touch icon. A browser presented with two
     * `rel="icon"` links picks by its own rules, not by ours, so appending would make the tab show
     * either brand depending on the browser — the worst kind of white-label bug, because it works
     * on the machine of whoever tested it. The links below are inserted after the originals are
     * stripped.
     */
    `<link rel="icon" href="${escapeAttribute(identity.favicon)}" />`,
    identity.touchIcon
      ? `<link rel="apple-touch-icon" href="${escapeAttribute(identity.touchIcon)}" />`
      : '',
    /*
     * Marked the same way the form's palette is, and read the same way: it tells the client that
     * the page is already painted, so it must not put the defaults up while it waits for the kit.
     */
    `<style data-tp-brand="server">${identity.palette}</style>`,
  ].filter(Boolean);

  return (
    html
      /*
       * Our own icons out first, so the customer's are the only ones offered.
       *
       * Both `rel="icon"` and `rel="apple-touch-icon"` are stripped, including the `alternate icon`
       * the shell carries for browsers that want a bitmap — leaving that one behind would hand a
       * white-labelled tab our mark on exactly the browsers least likely to be the one anybody
       * checked.
       */
      .replace(/\s*<link rel="(?:alternate )?(?:icon|apple-touch-icon)"[^>]*>/g, '')
      /*
       * The tab, too.
       *
       * A white-labelled product whose browser tab says "Loppa" is white-labelled everywhere
       * except the one place the customer looks at all day.
       */
      .replace(/<title>[^<]*<\/title>/, `<title>${wordmark}</title>`)
      .replace(/<\/head>/, `  ${tags.join('\n    ')}\n  </head>`)
  );
}

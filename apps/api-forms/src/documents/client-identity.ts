import { escapeAttribute } from './link-preview.js';

/**
 * A white-labelled app, in the bytes the server sends.
 *
 * Client mode replaces our mark and our name with the customer's, and until this existed it did so
 * *after* the page had fetched its brand kit. So the one thing white-label is bought to prevent was
 * exactly what happened on every load: Paloppa's mark and Paloppa's name in the corner of somebody
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
  logoLight: string | null;
  logoDark: string | null;
  /** The organisation's compiled palette, light and dark, for the first paint. */
  palette: string;
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
    identity.logoLight
      ? `<meta name="tp-logo-light" content="${escapeAttribute(identity.logoLight)}" />`
      : '',
    identity.logoDark
      ? `<meta name="tp-logo-dark" content="${escapeAttribute(identity.logoDark)}" />`
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
       * The tab, too.
       *
       * A white-labelled product whose browser tab says "Paloppa" is white-labelled everywhere
       * except the one place the customer looks at all day.
       */
      .replace(/<title>[^<]*<\/title>/, `<title>${wordmark}</title>`)
      .replace(/<\/head>/, `  ${tags.join('\n    ')}\n  </head>`)
  );
}

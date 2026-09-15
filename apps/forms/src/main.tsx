import { isSiteRoute, isSiteShaped } from './site/routes.js';
import { initTheme } from './lib/theme.js';
/**
 * The typeface the product has always claimed and never delivered.
 *
 * `Inter` has been the first family in the default stack since phase 0, is what `DESIGN.md`'s type
 * scale was measured against, and is embedded in every PDF this product generates — and no page
 * ever loaded it. There was no `@font-face` anywhere in this app, so the web fell through to
 * `ui-sans-serif` and rendered in Segoe UI, SF Pro or Roboto depending on who was looking. An
 * invoice and the page that produced it were set in different typefaces.
 *
 * Three weights, because three are used: `weightRegular` 400, `labelWeight` 500, `weightBold` 600.
 * Nothing imports the italics; Inter's are synthesised well enough for the two places this design
 * uses slant, and 24 KB per weight per subset is not worth spending on a fallback.
 *
 * Each file is `unicode-range`-gated by fontsource, so the bytes follow the language rather than
 * the visitor: an English page fetches `latin` only, a Swedish one the same (å ä ö æ ø live in
 * `latin`), and a Russian one fetches `cyrillic` instead. Nothing downloads all of it.
 *
 * Self-hosted and bundled, never a CDN link — the CSP permits no external origins, and that is also
 * what keeps the Phase 2 third-country-transfer answer at "none".
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles.css';

/**
 * What the browser has to run before the page works, which for most visitors is nothing.
 *
 * This file used to import React, the router and both application trees at the top, so every
 * visitor downloaded the signed-in app and the marketing site whichever one they had asked for.
 * The two who paid for that were the two who are not signed in: somebody reading the landing page,
 * and somebody filling a form on a phone at a venue.
 *
 * The site is server-rendered, has no state, no effects and no handlers, and moves with CSS. Its
 * links are already `<a href>` pointing at pages the server also renders. Hydrating it would
 * download React in order to replace working anchors with working anchors, so it does not: on a
 * server-rendered site route this file sets the theme and stops.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

// Shaped counts too: `/features/nothing` is the site's not-found page, not the app's sign-in.
const isSite = isSiteRoute(window.location.pathname) || isSiteShaped(window.location.pathname);

/**
 * Whether the server actually drew this page, asked of the document rather than assumed.
 *
 * Assuming "site route means server-rendered" is wrong in development, where Vite serves the shell
 * and nothing renders into it — the page would then stay empty forever, because the branch below
 * would decide there was nothing to do. Markup in the container is a fact rather than an inference.
 */
const serverRendered = container.firstElementChild !== null;

// Before the first paint, or the page comes up light and then flips. Small enough to stay here.
initTheme();

if (!isSite || !serverRendered) {
  void import('./mount.js').then(({ mount }) => mount(container, isSite));
}

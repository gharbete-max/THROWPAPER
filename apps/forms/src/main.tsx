import { isSiteRoute } from './site/routes.js';
import { initTheme } from './lib/theme.js';
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

const isSite = isSiteRoute(window.location.pathname);

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

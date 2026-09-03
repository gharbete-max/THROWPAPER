import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';
import { App } from './App.js';
import { Site } from './site/Site.js';
import { isSiteRoute } from './site/routes.js';
import { initTheme } from './lib/theme.js';
import './styles.css';

/**
 * Two trees, and this decides which one the page is.
 *
 * The public site is rendered on the server, so its markup is already in the document and the job
 * here is to **hydrate** it — attach behaviour to what is there. Calling `createRoot` on
 * server-rendered markup throws it away and draws it again, which is a blank flash on the one page
 * whose entire purpose is the first impression.
 *
 * Everything else is the app, which the server does not render and cannot: it is behind a bearer
 * token, and the server is not signed in as anybody.
 *
 * `isSiteRoute` is the same list the server used to decide whether to render. One list, because
 * the two decisions disagreeing is exactly how a page arrives server-rendered and is then replaced
 * by a client-rendered blank.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

const isSite = isSiteRoute(window.location.pathname);

/**
 * Whether the server actually drew this page, asked of the document rather than assumed.
 *
 * Assuming "site route means server-rendered" is wrong in development, where Vite serves the shell
 * and nothing renders into it: `hydrateRoot` then found an empty container, reported a hydration
 * mismatch and threw the tree away, and the palette — skipped on the grounds that the server had
 * already inlined it — was never injected at all. The landing page came up unstyled, in a serif
 * fallback, with an error in the console.
 *
 * Markup in the container is the fact that matters, and it is a fact rather than an inference.
 */
const serverRendered = container.firstElementChild !== null;

/**
 * The server inlines the palette when it renders, so injecting it again would be a second copy of
 * the same rules. Everywhere else — the app, and the site in development — this is what puts the
 * colours up before the first paint.
 */
if (!serverRendered) {
  // Rule 4: no hard-coded colours, fonts or spacing. Everything below reads these variables.
  // `toThemedCssBlock` emits the light palette and the derived dark one together, so the app has a
  // dark mode before it has a session.
  const style = document.createElement('style');
  style.textContent = toThemedCssBlock(defaultTokens);
  document.head.appendChild(style);
}

// Before the first render, or the page paints light and then flips.
initTheme();

if (isSite && serverRendered) {
  hydrateRoot(
    container,
    <StrictMode>
      <BrowserRouter>
        <Site />
      </BrowserRouter>
    </StrictMode>,
  );
} else if (isSite) {
  // A site route with nothing to hydrate: development, or a shell served without a render.
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <Site />
      </BrowserRouter>
    </StrictMode>,
  );
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { defaultTokens, toThemedCssBlock } from '@tp/tokens';

/**
 * Everything that needs React, kept out of the entry so the entry does not need React.
 *
 * The public site is server-rendered and has no state, no effects and no handlers — its links are
 * links and its motion is CSS — so in production nothing here is ever loaded for it. This module is
 * reached on two paths: the signed-in app, and the site in development, where Vite serves the shell
 * without rendering into it and somebody has to draw the page.
 */
export function mount(container: HTMLElement, isSite: boolean): void {
  /**
   * The palette, for the paths the server did not render.
   *
   * A server-rendered page already carries it inline in the head; these two do not, and without it
   * the first paint is a serif fallback on white.
   */
  // Rule 4: no hard-coded colours, fonts or spacing. Everything downstream reads these variables.
  // `toThemedCssBlock` emits the light palette and the derived dark one together, so the app has a
  // dark mode before it has a session.
  const style = document.createElement('style');
  style.textContent = toThemedCssBlock(defaultTokens);
  document.head.appendChild(style);

  if (isSite) {
    void import('./site/Site.js').then(({ Site }) => {
      createRoot(container).render(
        <StrictMode>
          <BrowserRouter>
            <Site />
          </BrowserRouter>
        </StrictMode>,
      );
    });
    return;
  }

  void import('./App.js').then(({ App }) => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}

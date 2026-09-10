import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { defaultTokens, toThemedCssBlock, type TokenSet } from '@tp/tokens';
import { client } from './api.js';
import { useSession } from './session.js';
import { syncThemeColour } from './theme.js';

/**
 * The signed-in app painted with the organisation's brand.
 *
 * `main.tsx` puts the shipped defaults up before React starts, so the page is never unstyled. This
 * replaces them once the session exists and the kit has been fetched. The order matters: an
 * unstyled flash looks broken, a brief flash of the default palette only looks like a load.
 *
 * The public form does **not** use this — it has no session, and its brand arrives with the form
 * itself in one request. See `screens/PublicForm.tsx`.
 */
interface BrandValue {
  tokens: TokenSet;
  /** Called by the editor after a save, so the chrome updates without a reload. */
  refresh: () => void;
}

const BrandContext = createContext<BrandValue>({ tokens: defaultTokens, refresh: () => {} });

/**
 * The customer's identity as the server left it in the document, or the defaults.
 *
 * A white-labelled deployment has the corner's answer in the bytes before any of this runs — see
 * `client-identity.ts` on the server. Reading it here is what removes the flash: without it the
 * first render is `defaultTokens`, which means our mark and our name in the corner of somebody
 * else's product until a fetch comes back.
 *
 * Meta tags rather than a script because the CSP is `script-src 'self'` and an inline one would be
 * refused by the browser — silently, leaving the default branding and no error to find.
 *
 * Only the identity is read. The palette is already applied: the server inlined it as a `<style>`
 * and the effect below leaves that alone until the real kit arrives.
 */
function identityFromDocument(): TokenSet {
  if (typeof document === 'undefined') return defaultTokens;
  const meta = (name: string) =>
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || null;

  if (meta('tp-client-mode') !== '1') return defaultTokens;

  return {
    ...defaultTokens,
    clientMode: true,
    wordmark: meta('tp-wordmark'),
    logoLight: meta('tp-logo-light'),
    logoDark: meta('tp-logo-dark'),
  };
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  /* Lazily, so the document is read once rather than on every render. */
  const [tokens, setTokens] = useState<TokenSet>(identityFromDocument);
  const [nonce, setNonce] = useState(0);
  /** Whether the kit itself has arrived, as opposed to what the document was seeded with. */
  const [resolved, setResolved] = useState(false);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!user) {
      /*
       * Signed out: back to what the document says, so one organisation's *colours* cannot outlive
       * its session while the deployment's identity survives.
       *
       * `defaultTokens` here was right when the only thing a kit carried was a palette and wrong
       * the moment it carried white-label: it put our mark and our name back on the sign-in screen
       * of a customer's own product, which is the single page where the branding matters most and
       * the only one nobody is authenticated on.
       */
      setTokens(identityFromDocument());
      setResolved(false);
      return;
    }

    let cancelled = false;
    client
      .brandKit()
      .then((response) => {
        if (!cancelled) {
          setTokens(response.tokens);
          setResolved(true);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user, nonce]);

  useEffect(() => {
    /*
     * Do not paint over a page the server already painted.
     *
     * On a white-labelled deployment the customer's compiled palette is inlined in the head, so
     * putting `defaultTokens` up here while the kit is still in flight would *create* the flash
     * this all exists to remove: their colours, a blink to ours, and a blink back. Once the real
     * kit has arrived `resolved` is true and this block is the authority again — it carries the
     * live edits from the brand editor, which the server's snapshot cannot.
     *
     * `PublicForm` makes the same check for the same reason.
     */
    if (!resolved && document.querySelector('style[data-tp-brand="server"]')) return;

    // A dedicated element, so this replaces its own block rather than fighting main.tsx's.
    const style = document.createElement('style');
    style.dataset['brand'] = 'organisation';
    style.textContent = toThemedCssBlock(tokens);
    document.head.appendChild(style);
    // The page has just been repainted in this organisation's colours; the browser chrome above it
    // reads its colour from a meta tag that has no idea any of this happened.
    syncThemeColour();
    return () => style.remove();
  }, [tokens, resolved]);

  const value = useMemo<BrandValue>(() => ({ tokens, refresh }), [tokens, refresh]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandValue {
  return useContext(BrandContext);
}

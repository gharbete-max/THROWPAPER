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

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [tokens, setTokens] = useState<TokenSet>(defaultTokens);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!user) {
      // Signed out: back to the defaults, so one organisation's brand cannot outlive its session.
      setTokens(defaultTokens);
      return;
    }

    let cancelled = false;
    client
      .brandKit()
      .then((response) => {
        if (!cancelled) setTokens(response.tokens);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user, nonce]);

  useEffect(() => {
    // A dedicated element, so this replaces its own block rather than fighting main.tsx's.
    const style = document.createElement('style');
    style.dataset['brand'] = 'organisation';
    style.textContent = toThemedCssBlock(tokens);
    document.head.appendChild(style);
    // The page has just been repainted in this organisation's colours; the browser chrome above it
    // reads its colour from a meta tag that has no idea any of this happened.
    syncThemeColour();
    return () => style.remove();
  }, [tokens]);

  const value = useMemo<BrandValue>(() => ({ tokens, refresh }), [tokens, refresh]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandValue {
  return useContext(BrandContext);
}
